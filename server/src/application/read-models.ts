import { calculateExpectedInvestorDividend } from "../domain/dividend-allocation.js";
import {
  candlesFromSnapshots,
  changeRateFromCandles,
  holdingDividendYieldCandles,
  holdingReturnCandles,
  monthlyDividendYieldCandlesFromSnapshots,
  pointsFromCandles,
  pointsFromSnapshots,
  portfolioChangeRateFromMarketValue,
  returnCandlesFromSnapshots,
  samplePoints
} from "../domain/chart-metrics.js";
import { dividendEligibleFromMonth } from "../domain/dividend-eligibility.js";
import { investmentIntentAvailabilityFromAmounts } from "../domain/investment-intent-availability.js";
import { investorBalances } from "../domain/investor-balances.js";
import {
  eligiblePayoutPrincipals,
  isTotalReturnPrincipalEntryId,
  totalReturnAccrualsFromRows
} from "../domain/monthly-investor-payouts.js";
import { DEFAULT_PAYOUT_MODE } from "../domain/payout-mode.js";
import {
  PRODUCT_MAX_INVESTMENT_KRW,
  PRODUCT_MIN_INVESTMENT_KRW,
  productPolicyDto
} from "../domain/product-policy.js";
import { withdrawalIntentReferenceForUser } from "../domain/withdrawal-limit.js";
import { readDisclosure, readDisclosures } from "../infrastructure/disclosures.js";
import {
  forecastDividend,
  getDividendRecord,
  readDividendRecords,
  readMonthlyDividendRecords,
  summarizePortfolioDividend
} from "../infrastructure/dividends.js";
import { mapWithConcurrency } from "../infrastructure/concurrency.js";
import { fetchMarketCandles, type MarketChart } from "../infrastructure/market-data.js";
import {
  readMonthlyInvestorPayouts,
  readPayoutMode,
  readPayoutModes,
  readTotalReturnAccruedKrw
} from "../infrastructure/payouts.js";
import {
  getManualPortfolioOverview,
  readPortfolioMarketValueKrw,
  readRealizedProfitLoss
} from "../infrastructure/portfolio-store.js";
import {
  kstDateKey,
  readRoadmapEvents,
  roadmapHorizonEndDate,
  roadmapInitialStartDate
} from "../infrastructure/roadmap.js";
import {
  readCompletedInvestmentIntentAmount,
  readCompletedNetInvestmentIntentAmount,
  readStore,
  readStoreForUser
} from "../infrastructure/store.js";

function chartRecord(entries: Array<readonly [string, MarketChart | null]>) {
  return Object.fromEntries(entries) as Record<string, MarketChart | null>;
}

async function chartsFor(
  symbols: readonly string[],
  options: Parameters<typeof fetchMarketCandles>[1]
) {
  const deadlineAt = Date.now() + 7_000;
  const entries = await mapWithConcurrency(symbols, 4, async (symbol) => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return [symbol, null] as const;
    return [
      symbol,
      await settleBefore(fetchMarketCandles(symbol, options).catch(() => null), remainingMs, null)
    ] as const;
  });
  return chartRecord(entries);
}

async function settleBefore<T>(promise: Promise<T>, milliseconds: number, fallback: T): Promise<T> {
  if (milliseconds <= 0) return fallback;
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => { timeout = setTimeout(() => resolve(fallback), milliseconds); })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function publicHomeReadModel() {
  const portfolio = await getManualPortfolioOverview();
  const [
    scheduledDividend,
    portfolioDividend,
    monthlyDividendRecords,
    disclosures,
    dailyChartRecord,
    dailyChangeChartRecord
  ] =
    await Promise.all([
      forecastDividend(portfolio, portfolio.totalMarketValueKrw),
      summarizePortfolioDividend(portfolio),
      readMonthlyDividendRecords(),
      readDisclosures({ take: 3 }),
      chartsFor(portfolio.holdings.map((holding) => holding.symbol), { range: "1y", interval: "1d", limit: 252 }),
      chartsFor(portfolio.holdings.map((holding) => holding.symbol), { range: "1d", interval: "1d", limit: 1 })
    ]);
  const dailyCharts = new Map<string, MarketChart | null>(Object.entries(dailyChartRecord));
  const dailyChangeCharts = new Map<string, MarketChart | null>(Object.entries(dailyChangeChartRecord));
  const { dailySnapshots, ...portfolioWithoutDailySnapshots } = portfolio;
  const portfolioDailyChangeRate = portfolioChangeRateFromMarketValue({
    holdings: portfolio.holdings,
    charts: dailyChangeCharts,
    exchangeRate: portfolio.exchangeRate
  });
  const portfolioDailyPoints = samplePoints(pointsFromSnapshots(dailySnapshots));
  const holdingReturnPoints = samplePoints(pointsFromCandles(returnCandlesFromSnapshots(dailySnapshots)));
  const dividendYieldPoints = samplePoints(pointsFromCandles(
    monthlyDividendYieldCandlesFromSnapshots(
      dailySnapshots,
      monthlyDividendRecords,
      portfolioDividend.annualDividendKrw,
      portfolio.totalMarketValueKrw
    )
  ));
  const holdingCharts = Object.fromEntries(
    portfolio.holdings.map((holding) => {
      const chart = dailyCharts.get(holding.symbol);
      return [
        holding.symbol,
        {
          dailyChangeRate: changeRateFromCandles(chart?.candles ?? []),
          points: samplePoints(pointsFromCandles(chart?.candles ?? []))
        }
      ] as const;
    })
  );

  return {
    portfolio: portfolioWithoutDailySnapshots,
    scheduledDividend,
    portfolioDividend,
    disclosures,
    portfolioDailyChangeRate,
    portfolioDailyPoints,
    holdingReturnPoints,
    dividendYieldPoints,
    holdingCharts
  };
}

export async function disclosuresReadModel() {
  const roadmapToday = kstDateKey();
  const roadmapStart = roadmapInitialStartDate(roadmapToday);
  const roadmapHorizon = roadmapHorizonEndDate(roadmapToday);
  const [items, roadmapEvents] = await Promise.all([
    readDisclosures(),
    readRoadmapEvents({ from: roadmapStart, through: roadmapHorizon })
  ]);
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: items.length,
    roadmapEvents,
    roadmapToday,
    roadmapStart,
    roadmapHorizon
  };
}

export async function roadmapEventsReadModel(from: string, through: string) {
  return { events: await readRoadmapEvents({ from, through }) };
}

export async function disclosureReadModel(id: string) {
  return readDisclosure(id);
}

export async function stockReadModel(symbol: string) {
  const portfolio = await getManualPortfolioOverview();
  const normalized = symbol.trim().toUpperCase();
  const holding = portfolio.holdings.find((item) => item.symbol.toUpperCase() === normalized);
  if (!holding) return null;
  const [dividendRecord, dailyChart, weeklyChart, monthlyChart, realized] = await Promise.all([
    getDividendRecord(holding.symbol),
    fetchMarketCandles(holding.symbol, { range: "1mo", interval: "1d", limit: 2 }).catch(() => null),
    fetchMarketCandles(holding.symbol, { range: "1y", interval: "1wk", limit: 52 }).catch(() => null),
    fetchMarketCandles(holding.symbol, { range: "5y", interval: "1mo", limit: 60 }).catch(() => null),
    readRealizedProfitLoss(holding.symbol)
  ]);
  const annualDividendKrw = dividendRecord
    ? holding.quantity * (
        dividendRecord.currency === "USD"
          ? dividendRecord.annualDividendPerShare * portfolio.exchangeRate
          : dividendRecord.annualDividendPerShare
      )
    : undefined;
  const holdingDividendYield =
    typeof annualDividendKrw === "number" && holding.marketValueKrw > 0
      ? annualDividendKrw / holding.marketValueKrw
      : undefined;

  return {
    holding,
    dividendRecord: dividendRecord ?? null,
    dailyChangeRate: changeRateFromCandles(dailyChart?.candles ?? []),
    realized,
    annualDividendKrw,
    holdingDividendYield,
    returnCandles: holdingReturnCandles(
      monthlyChart?.candles ?? [],
      holding,
      portfolio.exchangeRate,
      portfolio.dailySnapshots.map((snapshot) => ({
        date: snapshot.date,
        exchangeRate: snapshot.closeExchangeRate ?? snapshot.exchangeRate
      }))
    ),
    yieldCandles: holdingDividendYieldCandles(
      monthlyChart?.candles ?? [],
      annualDividendKrw ?? 0,
      holding,
      portfolio.exchangeRate
    ),
    weeklyCandles: weeklyChart?.candles ?? []
  };
}

export const METRIC_SLUGS = ["daily-change", "holding-return", "dividend-yield"] as const;
export type MetricSlug = typeof METRIC_SLUGS[number];

export async function metricReadModel(metric: MetricSlug) {
  const portfolio = await getManualPortfolioOverview();
  const [portfolioDividend, monthlyDividendRecords, dailyCharts] = await Promise.all([
    summarizePortfolioDividend(portfolio),
    metric === "dividend-yield" ? readMonthlyDividendRecords() : Promise.resolve([]),
    metric === "daily-change"
      ? chartsFor(portfolio.holdings.map((holding) => holding.symbol), { range: "1d", interval: "1d", limit: 1 })
      : Promise.resolve({})
  ]);
  const dailyChartMap = new Map<string, MarketChart | null>(Object.entries(dailyCharts));
  const candles = metric === "holding-return"
    ? returnCandlesFromSnapshots(portfolio.dailySnapshots)
    : metric === "dividend-yield"
      ? monthlyDividendYieldCandlesFromSnapshots(
          portfolio.dailySnapshots,
          monthlyDividendRecords,
          portfolioDividend.annualDividendKrw,
          portfolio.totalMarketValueKrw
        )
      : candlesFromSnapshots(portfolio.dailySnapshots);
  const currentRate = metric === "holding-return"
    ? portfolioDividend.totalReturnRate
    : metric === "dividend-yield"
      ? portfolioDividend.dividendYield
      : portfolioChangeRateFromMarketValue({
          holdings: portfolio.holdings,
          charts: dailyChartMap,
          exchangeRate: portfolio.exchangeRate
        });

  return {
    metric,
    totalMarketValueKrw: portfolio.totalMarketValueKrw,
    portfolioDividend,
    candles,
    currentRate
  };
}

export async function simulationReadModel(requestedAmount: number) {
  const amount = Math.min(
    PRODUCT_MAX_INVESTMENT_KRW,
    Math.max(PRODUCT_MIN_INVESTMENT_KRW, Number.isFinite(requestedAmount) ? requestedAmount : 100_000)
  );
  const [portfolio, completedNetInvestmentIntentKrw] = await Promise.all([
    getManualPortfolioOverview(),
    readCompletedNetInvestmentIntentAmount()
  ]);
  const forecast = await forecastDividend(portfolio, amount);
  const annualPortfolioDividendYield =
    forecast.amountKrw > 0 && typeof forecast.annualDividendKrw === "number"
      ? forecast.annualDividendKrw / forecast.amountKrw
      : undefined;
  const expectedPayoutProjection = typeof annualPortfolioDividendYield === "number"
    ? calculateExpectedInvestorDividend({
        investmentKrw: amount,
        currentPortfolioMarketValueKrw: portfolio.totalMarketValueKrw,
        currentInvestorPrincipalKrw: completedNetInvestmentIntentKrw,
        annualPortfolioDividendYield
      })
    : undefined;
  const expectedPayout = expectedPayoutProjection
    ? {
        annualExpectedDividendKrw: expectedPayoutProjection.annualExpectedDividendKrw,
        monthlyExpectedDividendKrw: expectedPayoutProjection.monthlyExpectedDividendKrw,
        expectedAnnualPayoutRate: expectedPayoutProjection.expectedAnnualPayoutRate
      }
    : undefined;
  return {
    amount,
    forecast,
    annualPortfolioDividendYield,
    expectedPayout,
    policy: productPolicyDto()
  };
}

export async function intentsReadModel(userId: string) {
  const [store, completedInvestmentIntentKrw, portfolioMarketValueKrw, payoutMode, totalReturnAccruedKrw] = await Promise.all([
    readStoreForUser(userId),
    readCompletedInvestmentIntentAmount(),
    readPortfolioMarketValueKrw(),
    readPayoutMode(userId),
    readTotalReturnAccruedKrw(userId)
  ]);
  return {
    store,
    payoutMode,
    totalReturnAccruedKrw,
    withdrawalReference: withdrawalIntentReferenceForUser(store, userId, totalReturnAccruedKrw),
    investmentAvailability: investmentIntentAvailabilityFromAmounts(
      completedInvestmentIntentKrw,
      portfolioMarketValueKrw
    ),
    policy: productPolicyDto()
  };
}

export async function adminDashboardReadModel() {
  const roadmapToday = kstDateKey();
  const roadmapHorizon = roadmapHorizonEndDate(roadmapToday);
  const [store, portfolio, dividendRecords, monthlyDividendRecords, disclosures, roadmapEvents, payoutRows, payoutModes] = await Promise.all([
    readStore(),
    getManualPortfolioOverview(),
    readDividendRecords(),
    readMonthlyDividendRecords(),
    readDisclosures(),
    readRoadmapEvents(),
    readMonthlyInvestorPayouts(),
    readPayoutModes()
  ]);
  const completedInvestments = store.investmentIntents.filter((intent) => intent.status === "COMPLETED");
  const completedWithdrawals = store.withdrawalIntents.filter((intent) => intent.status === "COMPLETED");
  const investmentById = new Map(completedInvestments.map((intent) => [intent.id, intent]));
  const investorByUserId = new Map(completedInvestments.map((intent) => [intent.userId, intent]));
  const totalReturnAccruals = totalReturnAccrualsFromRows(payoutRows);
  const bookedModes = new Map(payoutRows.map((row) => [`${row.dividendMonth}:${row.userId}`, row.payoutMode]));
  const dividendPrincipalsByMonth = Object.fromEntries(
    monthlyDividendRecords.map((record) => {
      const principals = eligiblePayoutPrincipals({
        dividendMonth: record.dividendMonth,
        investments: completedInvestments.map((intent) => ({
          id: intent.id,
          userId: intent.userId,
          amountKrw: intent.amountKrw,
          completedAt: intent.updatedAt
        })),
        withdrawals: completedWithdrawals.map((intent) => ({
          id: intent.id,
          userId: intent.userId,
          amountKrw: intent.amountKrw,
          completedAt: intent.updatedAt
        })),
        totalReturnAccruals
      }).map((principal) => {
        const isTotalReturnAccrual = isTotalReturnPrincipalEntryId(principal.id);
        const intent = isTotalReturnAccrual ? investorByUserId.get(principal.userId) : investmentById.get(principal.id);
        if (!intent && !isTotalReturnAccrual) throw new Error(`Completed investment intent ${principal.id} was not found`);
        const eligibleFromMonth = dividendEligibleFromMonth(principal.completedAt);
        if (!eligibleFromMonth) {
          throw new Error(`Completed investment intent ${principal.id} has an invalid updatedAt timestamp`);
        }
        return {
          id: principal.id,
          userId: principal.userId,
          userName: intent?.userName ?? "투자자",
          userEmail: intent?.userEmail ?? "",
          amountKrw: principal.amountKrw,
          createdAt: isTotalReturnAccrual ? principal.completedAt : intent!.createdAt,
          updatedAt: principal.completedAt,
          eligibleFromMonth,
          source: isTotalReturnAccrual ? "TOTAL_RETURN_ACCRUAL" as const : "INVESTMENT_INTENT" as const,
          payoutMode: bookedModes.get(`${record.dividendMonth}:${principal.userId}`) ??
            payoutModes.get(principal.userId) ??
            DEFAULT_PAYOUT_MODE
        };
      });
      return [record.dividendMonth, principals];
    })
  );
  return {
    store,
    portfolio,
    dividendRecords,
    monthlyDividendRecords,
    disclosures,
    roadmapEvents,
    roadmapToday,
    roadmapHorizon,
    dividendPrincipalsByMonth,
    investorBalances: investorBalances(store, payoutRows, payoutModes),
    policy: productPolicyDto()
  };
}
