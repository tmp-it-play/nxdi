import type { Prisma } from "@prisma/client";
import type { Holding, ManualPortfolioStore, MarketCode, PortfolioDailySnapshot, PortfolioOverview } from "../domain/types.js";
import {
  ApplyHoldingTradeService,
  type HoldingAdjustmentType,
  type HoldingTradeExecution
} from "../application/apply-holding-trade-service.js";
import { UpdateCashBalanceService, type CashBalanceInput } from "../application/update-cash-balance-service.js";
import { portfolioAssetValues, valueCashAsset } from "../domain/cash-assets.js";
import { PortfolioSnapshotService } from "../application/portfolio-snapshot-service.js";
import { holdingInitialState } from "../domain/holding-initial-state.js";
import {
  confirmedMonthEndPortfolioMarketValueKrw,
  monthEndReferencePeriod
} from "../domain/month-end-portfolio-market-value.js";
import { holdingCostBasisKrw } from "../domain/portfolio-math.js";
import { mapWithConcurrency } from "./concurrency.js";
import { summarizePortfolioDividend } from "./dividends.js";
import { fetchUsdKrwExchangeRate, type ExchangeRateSnapshot } from "./exchange-rate.js";
import { fetchMarketQuote } from "./market-data.js";
import { withMysqlNamedLock } from "./mysql-named-lock.js";
import { prisma } from "./prisma.js";

const SNAPSHOT_TIMEZONE_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_SNAPSHOT_LIMIT = 370;
const VALUATION_LOCK = "nxdi:portfolio-valuation";

async function recordPortfolioTradeExecution(
  transaction: Prisma.TransactionClient,
  execution: HoldingTradeExecution
) {
  const executedAt = new Date(execution.executedAt);
  if (Number.isNaN(executedAt.getTime())) throw new Error("Invalid portfolio trade date");
  await transaction.portfolioTradeExecution.create({
    data: {
      ...execution,
      exchangeRate: execution.exchangeRate,
      executedAt
    }
  });
}

export function normalizeManualPortfolioStore(store: ManualPortfolioStore): ManualPortfolioStore {
  const exchangeRate = Number(store.exchangeRate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error("Portfolio exchange rate is unavailable");
  }
  const holdings = store.holdings.map((holding) => {
    const marketValue = holding.quantity * holding.lastPrice;
    const priceProfitLossRate =
      holding.averagePurchasePrice && holding.averagePurchasePrice > 0
        ? (holding.lastPrice - holding.averagePurchasePrice) / holding.averagePurchasePrice
        : undefined;
    const purchaseExchangeRate =
      holding.currency === "USD"
        ? Number(holding.purchaseExchangeRate) || undefined
        : undefined;
    const costBasisKrw = holdingCostBasisKrw({
      ...holding,
      purchaseExchangeRate
    });
    const marketValueKrw = holding.currency === "USD" ? marketValue * exchangeRate : marketValue;
    const profitLossKrw =
      costBasisKrw !== undefined ? marketValueKrw - costBasisKrw : undefined;
    const fxGainLossKrw =
      holding.currency === "USD" && purchaseExchangeRate !== undefined
        ? marketValue * (exchangeRate - purchaseExchangeRate)
        : 0;
    const profitLossRate =
      costBasisKrw && costBasisKrw > 0 ? (marketValueKrw - costBasisKrw) / costBasisKrw : undefined;

    return {
      ...holding,
      purchaseExchangeRate,
      marketValue,
      marketValueKrw,
      costBasisKrw,
      priceProfitLossRate,
      fxGainLossKrw,
      profitLossKrw,
      profitLossRate
    };
  });

  return {
    exchangeRate,
    exchangeRateFetchedAt: store.exchangeRateFetchedAt,
    exchangeRateSource: store.exchangeRateSource,
    updatedAt: store.updatedAt,
    cashAssets: (store.cashAssets ?? []).map((cash) => valueCashAsset(cash, exchangeRate)),
    holdings: holdings.sort((a, b) => b.marketValueKrw - a.marketValueKrw || a.symbol.localeCompare(b.symbol))
  };
}

function normalizeStoredMarketCode(value: string, currency: "KRW" | "USD", symbol: string): MarketCode {
  if (value === "NASDAQ" || value === "NYSE" || value === "AMEX" || value === "KOSPI" || value === "KOSDAQ") {
    return value;
  }
  if (currency === "KRW") return symbol.toUpperCase().endsWith(".KQ") ? "KOSDAQ" : "KOSPI";
  return "NASDAQ";
}

export function portfolioSnapshotDate(date = new Date()) {
  return new Date(date.getTime() + SNAPSHOT_TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
}

export function previousPortfolioSnapshotDate(date = new Date()) {
  return new Date(date.getTime() + SNAPSHOT_TIMEZONE_OFFSET_MS - DAY_MS).toISOString().slice(0, 10);
}

function toPortfolioDailySnapshot(row: {
  cashBalanceKrw?: number | null;
  closeCashBalanceKrw?: number | null;
  cashBalanceUsd?: number | null;
  closeCashBalanceUsd?: number | null;
  cashMarketValueKrw?: number | null;
  closeCashMarketValueKrw?: number | null;
  cashCostBasisKrw?: number | null;
  closeCashCostBasisKrw?: number | null;

  snapshotDate: string;
  totalMarketValueKrw: number;
  exchangeRate: number;
  costBasisKrw: number | null;
  annualDividendKrw: number | null;
  closeTotalMarketValueKrw: number | null;
  closeExchangeRate: number | null;
  closeCostBasisKrw: number | null;
  closeAnnualDividendKrw: number | null;
  observations?: {
    observedAt: Date;
    exchangeRate?: number | null;
    cashBalanceKrw?: number | null;
    cashBalanceUsd?: number | null;
    cashMarketValueKrw?: number | null;
    cashCostBasisKrw?: number | null;

    totalMarketValueKrw: number;
    costBasisKrw: number | null;
    annualDividendKrw: number | null;
  }[];
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): PortfolioDailySnapshot {
  return {
    date: row.snapshotDate,
    cashBalanceKrw: row.cashBalanceKrw ?? undefined,
    closeCashBalanceKrw: row.closeCashBalanceKrw ?? undefined,
    cashBalanceUsd: row.cashBalanceUsd ?? undefined,
    closeCashBalanceUsd: row.closeCashBalanceUsd ?? undefined,
    cashMarketValueKrw: row.cashMarketValueKrw ?? undefined,
    closeCashMarketValueKrw: row.closeCashMarketValueKrw ?? undefined,
    cashCostBasisKrw: row.cashCostBasisKrw ?? undefined,
    closeCashCostBasisKrw: row.closeCashCostBasisKrw ?? undefined,
    totalMarketValueKrw: row.totalMarketValueKrw,
    exchangeRate: row.exchangeRate,
    costBasisKrw: row.costBasisKrw ?? undefined,
    annualDividendKrw: row.annualDividendKrw ?? undefined,
    closeTotalMarketValueKrw: row.closeTotalMarketValueKrw ?? undefined,
    closeExchangeRate: row.closeExchangeRate ?? undefined,
    closeCostBasisKrw: row.closeCostBasisKrw ?? undefined,
    closeAnnualDividendKrw: row.closeAnnualDividendKrw ?? undefined,
    observations: row.observations?.map((observation) => ({
      observedAt: observation.observedAt.toISOString(),
      exchangeRate: observation.exchangeRate ?? undefined,
      cashBalanceKrw: observation.cashBalanceKrw ?? undefined,
      cashBalanceUsd: observation.cashBalanceUsd ?? undefined,
      cashMarketValueKrw: observation.cashMarketValueKrw ?? undefined,
      cashCostBasisKrw: observation.cashCostBasisKrw ?? undefined,
      totalMarketValueKrw: observation.totalMarketValueKrw,
      costBasisKrw: observation.costBasisKrw ?? undefined,
      annualDividendKrw: observation.annualDividendKrw ?? undefined
    })),
    closedAt: row.closedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function writePortfolioDailySnapshot(
  db: Prisma.TransactionClient,
  store: ManualPortfolioStore,
  observedAt: Date
) {
  const portfolio = overviewFromStore(store);
  const summary = await summarizePortfolioDividend(portfolio, db);
  const { totalMarketValueKrw, cashBalanceKrw, cashBalanceUsd, cashMarketValueKrw, cashCostBasisKrw } =
    portfolioAssetValues(store.holdings, store.cashAssets);
  const valuation = {
    totalMarketValueKrw, cashBalanceKrw, cashBalanceUsd, cashMarketValueKrw, cashCostBasisKrw,
    exchangeRate: store.exchangeRate,
    costBasisKrw: summary.costBasisKrw ?? null,
    annualDividendKrw: summary.annualDividendKrw ?? null
  };
  const snapshotDate = portfolioSnapshotDate(observedAt);
  const values = { ...valuation, observations: { create: { ...valuation, observedAt } } };
  await db.portfolioDailySnapshot.upsert({
    where: { snapshotDate }, create: { snapshotDate, ...values }, update: values
  });
  return portfolio;
}

export async function finalizePortfolioDailySnapshot(snapshotDate = portfolioSnapshotDate()) {
  const service = new PortfolioSnapshotService({
    find: (date) => prisma.portfolioDailySnapshot.findUnique({ where: { snapshotDate: date } }),
    close: async (date, values) => {
      const result = await prisma.portfolioDailySnapshot.updateMany({
        where: { snapshotDate: date, closedAt: null },
        data: {
          closeTotalMarketValueKrw: values.totalMarketValueKrw,
          closeExchangeRate: values.exchangeRate,
          closeCostBasisKrw: values.costBasisKrw,
          closeAnnualDividendKrw: values.annualDividendKrw,
          closeCashBalanceKrw: values.cashBalanceKrw,
          closeCashBalanceUsd: values.cashBalanceUsd,
          closeCashMarketValueKrw: values.cashMarketValueKrw,
          closeCashCostBasisKrw: values.cashCostBasisKrw,
          closedAt: values.closedAt
        }
      });
      return result.count === 1;
    }
  });
  const locked = await withMysqlNamedLock(
    VALUATION_LOCK,
    () => service.finalize(snapshotDate),
    5
  );
  if (!locked.acquired) throw new Error(`Could not acquire snapshot lock: ${snapshotDate}`);
  return locked.value;
}

async function readPortfolioDailySnapshots(includeObservations: boolean, db: Prisma.TransactionClient = prisma) {
  const rows = await db.portfolioDailySnapshot.findMany({
    orderBy: { snapshotDate: "desc" },
    take: DAILY_SNAPSHOT_LIMIT,
    include: { observations: includeObservations && { orderBy: { id: "asc" } } }
  });

  return rows
    .map((row) => toPortfolioDailySnapshot(row))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function readManualPortfolioStore(
  db: Prisma.TransactionClient = prisma,
  rate?: ExchangeRateSnapshot
): Promise<ManualPortfolioStore> {
  const [exchangeRateSnapshot, holdings, cashRows] = await Promise.all([
    rate ?? fetchUsdKrwExchangeRate(),
    db.portfolioHolding.findMany({ orderBy: { symbol: "asc" } }),
    db.portfolioCashAsset.findMany({ orderBy: { currency: "asc" } })
  ]);
  const latestUpdatedAt =
    [...holdings, ...cashRows].reduce<Date | null>(
      (latest, holding) => (!latest || holding.updatedAt > latest ? holding.updatedAt : latest),
      null
    ) ?? new Date();

  return normalizeManualPortfolioStore({
    exchangeRate: exchangeRateSnapshot.rate,
    exchangeRateFetchedAt: exchangeRateSnapshot.fetchedAt,
    exchangeRateSource: exchangeRateSnapshot.source,
    updatedAt: latestUpdatedAt.toISOString(),
    cashAssets: cashRows.map((cash) => valueCashAsset({
      currency: cash.currency as "KRW" | "USD",
      balance: Number(cash.balance),
      initialBalance: Number(cash.initialBalance),
      initialCostBasisKrw: Number(cash.initialCostBasisKrw),
      version: cash.version,
      updatedAt: cash.updatedAt.toISOString()
    }, exchangeRateSnapshot.rate)),
    holdings: holdings.map((holding) => ({
      symbol: holding.symbol,
      name: holding.name,
      alias: holding.alias ?? undefined,
      currency: holding.currency as "KRW" | "USD",
      marketCountry: normalizeStoredMarketCode(holding.marketCountry, holding.currency as "KRW" | "USD", holding.symbol),
      quantity: holding.quantity,
      lastPrice: holding.lastPrice,
      averagePurchasePrice: holding.averagePurchasePrice ?? undefined,
      purchaseExchangeRate: holding.purchaseExchangeRate ?? undefined,
      riskLevel: holding.riskLevel ?? undefined,
      marketValue: 0,
      marketValueKrw: 0,
      profitLossRate: holding.profitLossRate ?? undefined
    }))
  });
}

export type PortfolioMarketPriceRefresh = {
  attempted: number;
  updated: string[];
  skipped: Array<{
    symbol: string;
    reason: "quote_not_found" | "invalid_price" | "quote_error";
  }>;
};

export class PortfolioValuationUnavailableError extends Error {
  readonly statusCode = 503;

  constructor(readonly symbols: string[]) {
    super(`Verified market prices unavailable: ${symbols.join(", ")}`);
    this.name = "PortfolioValuationUnavailableError";
  }
}

export async function refreshManualPortfolioMarketPrices(): Promise<PortfolioMarketPriceRefresh> {
  const holdings = await prisma.portfolioHolding.findMany({ orderBy: { symbol: "asc" } });
  const results = await mapWithConcurrency(
    holdings,
    4,
    async (holding) => {
      try {
        const quote = await fetchMarketQuote(holding.symbol);
        if (!quote) {
          return {
            status: "skipped" as const,
            symbol: holding.symbol,
            reason: "quote_not_found" as const
          };
        }

        const lastPrice = quote.lastPrice;
        if (typeof lastPrice !== "number" || !Number.isFinite(lastPrice) || lastPrice <= 0) {
          return {
            status: "skipped" as const,
            symbol: holding.symbol,
            reason: "invalid_price" as const
          };
        }

        const locked = await withMysqlNamedLock(`nxdi:holding:${holding.symbol}`, async () => {
          const current = await prisma.portfolioHolding.findUnique({ where: { symbol: holding.symbol } });
          if (!current) return false;
          const profitLossRate = current.averagePurchasePrice && current.averagePurchasePrice > 0
            ? (lastPrice - current.averagePurchasePrice) / current.averagePurchasePrice
            : null;
          await prisma.portfolioHolding.update({
            where: { symbol: holding.symbol },
            data: { lastPrice, profitLossRate }
          });
          return true;
        }, 5);
        if (!locked.acquired || !locked.value) throw new Error("holding_changed_during_refresh");

        return {
          status: "updated" as const,
          symbol: holding.symbol
        };
      } catch (error) {
        console.error(`Portfolio market price refresh failed: ${holding.symbol}`, error instanceof Error ? error.message : "unknown");
        return {
          status: "skipped" as const,
          symbol: holding.symbol,
          reason: "quote_error" as const
        };
      }
    }
  );

  return {
    attempted: holdings.length,
    updated: results.flatMap((result) => (result.status === "updated" ? [result.symbol] : [])),
    skipped: results.flatMap((result) =>
      result.status === "skipped" ? [{ symbol: result.symbol, reason: result.reason }] : []
    )
  };
}

export async function refreshPortfolioMarketSnapshot() {
  const marketPriceRefresh = await refreshManualPortfolioMarketPrices();
  if (marketPriceRefresh.skipped.length > 0) {
    throw new PortfolioValuationUnavailableError(
      marketPriceRefresh.skipped.map((item) => item.symbol)
    );
  }
  const rate = await fetchUsdKrwExchangeRate();
  const locked = await withMysqlNamedLock(VALUATION_LOCK, () => prisma.$transaction(async (db) => {
    const observedAt = new Date();
    const store = await readManualPortfolioStore(db, rate);
    const portfolio = await writePortfolioDailySnapshot(db, store, observedAt);
    return { portfolio, snapshotDate: portfolioSnapshotDate(observedAt) };
  }, { isolationLevel: "RepeatableRead" }), 5);
  if (!locked.acquired) throw new Error("Could not acquire portfolio valuation lock");
  const { portfolio, snapshotDate } = locked.value;

  return {
    status: "refreshed" as const,
    snapshotDate,
    totalMarketValueKrw: portfolio.totalMarketValueKrw,
    exchangeRate: portfolio.exchangeRate,
    marketPriceRefresh
  };
}

export async function finalizePreviousPortfolioDailySnapshot(date = new Date()) {
  const snapshotDate = previousPortfolioSnapshotDate(date);
  const result = await finalizePortfolioDailySnapshot(snapshotDate);
  const portfolio = await getManualPortfolioOverview();

  return {
    status: result.status,
    snapshotDate,
    currentSnapshotDate: portfolioSnapshotDate(date),
    totalMarketValueKrw: portfolio.totalMarketValueKrw,
    exchangeRate: portfolio.exchangeRate
  };
}

function overviewFromStore(store: ManualPortfolioStore, dailySnapshots: PortfolioDailySnapshot[] = []): PortfolioOverview {
  return {
    source: "manual",
    fetchedAt: store.updatedAt,
    exchangeRate: store.exchangeRate,
    exchangeRateFetchedAt: store.exchangeRateFetchedAt ?? new Date(0).toISOString(),
    exchangeRateSource: store.exchangeRateSource ?? "unavailable",
    ...portfolioAssetValues(store.holdings, store.cashAssets),
    dailySnapshots,
    holdings: store.holdings,
    cashAssets: store.cashAssets ?? []
  };
}

export async function getManualPortfolioOverview({ includeObservations = false } = {}): Promise<PortfolioOverview> {
  const rate = await fetchUsdKrwExchangeRate();
  return prisma.$transaction(async (db) => {
    const [store, snapshots] = await Promise.all([
      readManualPortfolioStore(db, rate), readPortfolioDailySnapshots(includeObservations, db)
    ]);
    return overviewFromStore(store, snapshots);
  }, { isolationLevel: "RepeatableRead" });
}

export async function updateCashBalance(input: CashBalanceInput) {
  const service = new UpdateCashBalanceService({
    withTransaction: async (work) => {
      const rate = await fetchUsdKrwExchangeRate();
      const locked = await withMysqlNamedLock(VALUATION_LOCK, () => prisma.$transaction(async (db) => {
        const observedAt = new Date();
        return work({
          find: async (currency) => {
            const row = await db.portfolioCashAsset.findUnique({ where: { currency } });
            return row ? { balance: Number(row.balance), version: row.version } : null;
          },
          update: async (currency, balance, version) => {
            const result = await db.portfolioCashAsset.updateMany({
              where: { currency, version }, data: { balance, version: { increment: 1 } }
            });
            return result.count === 1;
          },
          recordSnapshot: async () => {
            await writePortfolioDailySnapshot(db, await readManualPortfolioStore(db, rate), observedAt);
          }
        });
      }, { isolationLevel: "Serializable" }), 5);
      if (!locked.acquired) throw new Error("Could not acquire portfolio valuation lock");
      return locked.value;
    }
  });
  return service.execute(input);
}

export async function readMonthEndPortfolioMarketValueKrw(dividendMonth: string) {
  const period = monthEndReferencePeriod(dividendMonth);
  if (!period) return undefined;

  const [snapshot, latestTradeRecord] = await Promise.all([
    prisma.portfolioDailySnapshot.findUnique({
      where: { snapshotDate: period.snapshotDate }
    }),
    prisma.portfolioTradeExecution.findFirst({
      where: { executedAt: { lt: period.closedAfter } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true }
    })
  ]);

  return confirmedMonthEndPortfolioMarketValueKrw({
    period,
    snapshot,
    latestTradeCreatedAt: latestTradeRecord?.createdAt
  });
}

export type RealizedProfitLossSummary = {
  realizedProfitLossKrw: number;
  realizedFxGainLossKrw: number;
  unrecordedSaleCount: number;
};

/** Sums realized results booked on sell executions; legacy sells without a booked result are counted separately. */
export async function readRealizedProfitLoss(symbol?: string): Promise<RealizedProfitLossSummary> {
  const where = { side: "SELL", ...(symbol ? { symbol: symbol.toUpperCase() } : {}) };
  const [booked, unrecordedSaleCount] = await Promise.all([
    prisma.portfolioTradeExecution.aggregate({
      where: { ...where, realizedProfitLossKrw: { not: null } },
      _sum: { realizedProfitLossKrw: true, realizedFxGainLossKrw: true }
    }),
    prisma.portfolioTradeExecution.count({ where: { ...where, realizedProfitLossKrw: null } })
  ]);
  return {
    realizedProfitLossKrw: booked._sum.realizedProfitLossKrw ?? 0,
    realizedFxGainLossKrw: booked._sum.realizedFxGainLossKrw ?? 0,
    unrecordedSaleCount
  };
}

export async function readPortfolioMarketValueKrw() {
  const store = await readManualPortfolioStore();
  return portfolioAssetValues(store.holdings, store.cashAssets).totalMarketValueKrw;
}

export async function upsertManualHolding(input: Omit<Holding, "marketValue" | "marketValueKrw">) {
  const symbol = input.symbol.toUpperCase();
  const alias = input.alias?.trim();
  const locked = await withMysqlNamedLock(`nxdi:holding:${symbol}`, async () => {
    const existing = await prisma.portfolioHolding.findUnique({ where: { symbol } });
    if (existing) {
      const profitLossRate = existing.averagePurchasePrice && existing.averagePurchasePrice > 0
        ? (input.lastPrice - existing.averagePurchasePrice) / existing.averagePurchasePrice
        : null;
      await prisma.portfolioHolding.update({
        where: { symbol },
        data: {
          name: input.name,
          alias,
          lastPrice: input.lastPrice,
          profitLossRate,
          riskLevel: input.riskLevel ?? null
        }
      });
      return { status: "updated" as const };
    }
    await prisma.portfolioHolding.create({
      data: holdingInitialState({ ...input, symbol, alias })
    });
    return { status: "created" as const };
  }, 5);
  if (!locked.acquired) throw new Error(`Could not acquire holding lock: ${symbol}`);
  return locked.value;
}

export async function applyManualHoldingTrade(input: {
  symbol: string;
  side: HoldingAdjustmentType;
  quantity: number;
  orderPrice: number;
  exchangeRate?: number;
  feeKrw?: number;
  taxKrw?: number;
}) {
  const symbol = input.symbol.toUpperCase();
  const service = new ApplyHoldingTradeService({
    withSymbolTransaction: (_lockedSymbol, work) => prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT symbol FROM tb_portfolio_holdings WHERE symbol = ${symbol} FOR UPDATE`;
      return work({
        find: () => transaction.portfolioHolding.findUnique({ where: { symbol } }),
        update: async (data) => {
          await transaction.portfolioHolding.update({ where: { symbol }, data });
        },
        delete: async () => {
          await transaction.portfolioHolding.delete({ where: { symbol } });
        },
        recordExecution: async (execution) => {
          await recordPortfolioTradeExecution(transaction, execution);
        }
      });
    }, { isolationLevel: "Serializable" })
  });
  const locked = await withMysqlNamedLock(`nxdi:holding:${symbol}`, () => service.execute(input), 5);
  if (!locked.acquired) throw new Error(`Could not acquire holding lock: ${symbol}`);
  return locked.value;
}

export async function deleteManualHolding(symbol: string) {
  const normalized = symbol.toUpperCase();
  const locked = await withMysqlNamedLock(`nxdi:holding:${normalized}`, async () => {
    await prisma.portfolioHolding.deleteMany({ where: { symbol: normalized } });
  }, 5);
  if (!locked.acquired) throw new Error(`Could not acquire holding lock: ${normalized}`);
}
