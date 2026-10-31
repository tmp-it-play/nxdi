import type {
  Holding,
  MarketCode,
  MonthlyDividendRecord,
  PortfolioDailySnapshot,
  PortfolioValuation
} from "./types.js";
import { candleExchangeRates, type ExchangeRatePoint } from "./holding-cost.js";

export type MarketCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MarketChart = {
  symbol?: string;
  currency?: "KRW" | "USD";
  marketCountry?: MarketCode;
  candles: MarketCandle[];
  previousClose?: number;
};

export type ChartPoint = {
  date: string;
  value: number;
};

export function changeRateFromCandles(candles: MarketCandle[]) {
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  if (!latest || !previous || previous.close <= 0) return undefined;
  return (latest.close - previous.close) / previous.close;
}

export function changeRateFromSnapshots(snapshots: PortfolioDailySnapshot[]) {
  const latest = snapshots.at(-1);
  const previous = snapshots.at(-2);
  const previousClose = previous?.closeTotalMarketValueKrw;
  if (!latest || !previous || !previousClose || previousClose <= 0) return undefined;
  return (latest.totalMarketValueKrw - previousClose) / previousClose;
}

function previousCloseFromChart(chart?: MarketChart | null) {
  const previousCandleClose = chart?.candles.at(-2)?.close;
  if (typeof previousCandleClose === "number" && previousCandleClose > 0) {
    return previousCandleClose;
  }

  return typeof chart?.previousClose === "number" && chart.previousClose > 0 ? chart.previousClose : undefined;
}

export function portfolioChangeRateFromMarketValue({
  holdings,
  charts,
  exchangeRate
}: {
  holdings: Holding[];
  charts: Map<string, MarketChart | null>;
  exchangeRate: number;
}) {
  let currentMarketValue = 0;
  let previousMarketValue = 0;
  let coveredHoldingCount = 0;
  let eligibleHoldingCount = 0;

  for (const holding of holdings) {
    if (holding.quantity <= 0 || holding.marketValueKrw <= 0) continue;
    eligibleHoldingCount += 1;

    const previousClose = previousCloseFromChart(charts.get(holding.symbol));
    if (previousClose === undefined) return undefined;

    const multiplier = holding.quantity * (holding.currency === "USD" ? exchangeRate : 1);
    const previousHoldingValue = previousClose * multiplier;
    if (previousHoldingValue <= 0) return undefined;

    currentMarketValue += holding.marketValueKrw;
    previousMarketValue += previousHoldingValue;
    coveredHoldingCount += 1;
  }

  if (eligibleHoldingCount === 0 || coveredHoldingCount !== eligibleHoldingCount) return undefined;

  return previousMarketValue > 0 ? (currentMarketValue - previousMarketValue) / previousMarketValue : undefined;
}

export function samplePoints(points: ChartPoint[], maxPoints = 72) {
  const limit = Math.max(0, Math.floor(maxPoints));
  if (limit === 0) return [];
  if (points.length <= limit) return points;
  if (limit === 1) return [points.at(-1)!];

  return Array.from({ length: limit }, (_, index) => {
    const pointIndex = Math.round(index * (points.length - 1) / (limit - 1));
    return points[pointIndex]!;
  });
}

export function pointsFromCandles(candles: MarketCandle[]) {
  return candles.map((candle) => ({
    date: candle.date,
    value: candle.close
  }));
}

export function pointsFromSnapshots(snapshots: PortfolioDailySnapshot[]) {
  return snapshots.flatMap((snapshot, index) => {
    const valuation = effectiveValuation(snapshot, isLatestSnapshot(index, snapshots));
    return valuation ? [{ date: snapshot.date, value: valuation.totalMarketValueKrw }] : [];
  });
}

type SnapshotPeriod = "day" | "week";

function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

function candleFromObservations(date: string, observations: number[], close: number, previousClose?: number): MarketCandle {
  const open = observations[0] ?? previousClose ?? close;
  let high = Math.max(open, close);
  let low = Math.min(open, close);
  for (const value of observations) {
    high = Math.max(high, value);
    low = Math.min(low, value);
  }
  return { date, open, high, low, close };
}

function effectiveValuation(snapshot: PortfolioDailySnapshot, latest: boolean): PortfolioValuation | undefined {
  if (latest) return snapshot;
  if (snapshot.closeTotalMarketValueKrw === undefined) return undefined;
  return {
    totalMarketValueKrw: snapshot.closeTotalMarketValueKrw,
    costBasisKrw: snapshot.closeCostBasisKrw,
    annualDividendKrw: snapshot.closeAnnualDividendKrw
  };
}

function observationsThroughClose(snapshot: PortfolioDailySnapshot, latest: boolean) {
  const observations = snapshot.observations ?? [];
  const cutoff = latest ? undefined : snapshot.closedAt;
  return cutoff ? observations.filter((sample) => sample.observedAt <= cutoff) : observations;
}

function snapshotCandles(
  snapshots: PortfolioDailySnapshot[],
  period: SnapshotPeriod,
  metricValue: (valuation: PortfolioValuation) => number | undefined
) {
  const candles: MarketCandle[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const latest = isLatestSnapshot(index, snapshots);
    const valuation = effectiveValuation(snapshot, latest);
    const close = valuation && metricValue(valuation);
    if (close === undefined) continue;
    const values = observationsThroughClose(snapshot, latest).map(metricValue).filter((value) => value !== undefined);
    const previous = candles.at(-1);
    const date = period === "week" ? weekStart(snapshot.date) : snapshot.date;
    const candle = candleFromObservations(date, values, close, period === "day" ? previous?.close : undefined);
    if (previous?.date === date) {
      previous.high = Math.max(previous.high, candle.high);
      previous.low = Math.min(previous.low, candle.low);
      previous.close = close;
    } else {
      candles.push(candle);
    }
  }
  return candles;
}

export function candlesFromSnapshots(snapshots: PortfolioDailySnapshot[], period: SnapshotPeriod = "day") {
  return snapshotCandles(snapshots, period, (sample) => sample.totalMarketValueKrw);
}

function candlesFromPoints(points: ChartPoint[]) {
  return points.map((point, index) =>
    candleFromObservations(point.date, [], point.value, points[index - 1]?.value)
  );
}

export function returnCandlesFromSnapshots(snapshots: PortfolioDailySnapshot[], period: SnapshotPeriod = "day") {
  return snapshotCandles(snapshots, period, ({ totalMarketValueKrw, costBasisKrw }) =>
    costBasisKrw !== undefined && costBasisKrw > 0 ? (totalMarketValueKrw - costBasisKrw) / costBasisKrw : undefined
  );
}

function monthlyDividendRecordsByMonth(records: MonthlyDividendRecord[]) {
  return new Map(records.map((record) => [record.dividendMonth, record]));
}

export function dividendYieldCandlesFromSnapshots(
  snapshots: PortfolioDailySnapshot[],
  monthlyDividendRecords: MonthlyDividendRecord[] = [],
  currentMonthEstimatedDividendKrw?: number
) {
  const actualRecordsByMonth = monthlyDividendRecordsByMonth(monthlyDividendRecords);
  const usesMonthlyDividendRecords = monthlyDividendRecords.length > 0;

  const points = snapshots.flatMap((snapshot, index) => {
    const latest = isLatestSnapshot(index, snapshots);
    const valuation = effectiveValuation(snapshot, latest);
    if (!valuation || valuation.totalMarketValueKrw <= 0) return [];
    const dividendKrw =
      latest && typeof currentMonthEstimatedDividendKrw === "number"
        ? currentMonthEstimatedDividendKrw
        : usesMonthlyDividendRecords
          ? actualRecordsByMonth.get(snapshot.date.slice(0, 7))?.actualDividendKrw
          : valuation.annualDividendKrw;
    if (typeof dividendKrw !== "number" || dividendKrw <= 0) return [];
    return [{ date: snapshot.date, value: dividendKrw / valuation.totalMarketValueKrw }];
  });

  return candlesFromPoints(points);
}

function monthDate(month: string) {
  return `${month}-01T00:00:00.000Z`;
}

function currentMonthKey(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

export function monthlyDividendYieldCandlesFromSnapshots(
  snapshots: PortfolioDailySnapshot[],
  monthlyDividendRecords: MonthlyDividendRecord[] = [],
  currentAnnualEstimatedDividendKrw?: number,
  currentMarketValueKrw?: number,
  currentMonth = currentMonthKey()
) {
  const records = [...monthlyDividendRecords]
    .sort((a, b) => a.dividendMonth.localeCompare(b.dividendMonth));
  const months: { month: string; close: number; actualAnnualDividend?: number; yields: number[] }[] = [];
  for (const [index, record] of records.entries()) {
    const trailingRecords = records.slice(Math.max(0, index - 11), index + 1);
    const actualDividendKrw =
      trailingRecords.reduce((sum, item) => sum + item.actualDividendKrw, 0) *
      (12 / trailingRecords.length);
    const totalMarketValueKrw = record.referenceMarketValueKrw;
    if (
      actualDividendKrw <= 0 ||
      typeof totalMarketValueKrw !== "number" ||
      totalMarketValueKrw <= 0
    ) {
      continue;
    }
    months.push({
      month: record.dividendMonth,
      close: actualDividendKrw / totalMarketValueKrw,
      actualAnnualDividend: actualDividendKrw,
      yields: []
    });
  }

  if (
    typeof currentAnnualEstimatedDividendKrw === "number" &&
    currentAnnualEstimatedDividendKrw > 0 &&
    typeof currentMarketValueKrw === "number" &&
    currentMarketValueKrw > 0
  ) {
    const latestHistoricalMonth = records.at(-1)?.dividendMonth;
    if (latestHistoricalMonth !== currentMonth) {
      months.push({
        month: currentMonth,
        close: currentAnnualEstimatedDividendKrw / currentMarketValueKrw,
        yields: []
      });
    }
  }

  const byMonth = new Map(months.map((item) => [item.month, item]));
  for (const [index, snapshot] of snapshots.entries()) {
    const month = byMonth.get(snapshot.date.slice(0, 7));
    if (!month) continue;
    const latest = month.month === currentMonth && month.actualAnnualDividend === undefined && isLatestSnapshot(index, snapshots);
    const close = effectiveValuation(snapshot, latest);
    if (!close) continue;
    for (const sample of [...observationsThroughClose(snapshot, latest), close]) {
      const annualDividend = month.actualAnnualDividend ?? sample.annualDividendKrw;
      if (annualDividend !== undefined && annualDividend >= 0 && sample.totalMarketValueKrw > 0) {
        month.yields.push(annualDividend / sample.totalMarketValueKrw);
      }
    }
  }
  return months.map(({ month, yields, close }, index) =>
    candleFromObservations(monthDate(month), yields, close, months[index - 1]?.close)
  );
}

function isLatestSnapshot(index: number, snapshots: PortfolioDailySnapshot[]) {
  return index === snapshots.length - 1;
}

export function aggregatePortfolioCandles({
  holdings,
  charts,
  exchangeRate,
  bucket = "day"
}: {
  holdings: Holding[];
  charts: Map<string, MarketChart | null>;
  exchangeRate: number;
  bucket?: "day" | "week" | "month";
}) {
  const buckets = new Map<string, MarketCandle>();

  for (const holding of holdings) {
    const chart = charts.get(holding.symbol);
    if (!chart) continue;
    const multiplier = holding.quantity * (holding.currency === "USD" ? exchangeRate : 1);

    for (const candle of chart.candles) {
      const key = candleBucketKey(candle.date, bucket);
      const current = buckets.get(key) ?? {
        date: candle.date,
        open: 0,
        high: 0,
        low: 0,
        close: 0
      };

      buckets.set(key, {
        date: candle.date,
        open: current.open + candle.open * multiplier,
        high: current.high + candle.high * multiplier,
        low: current.low + candle.low * multiplier,
        close: current.close + candle.close * multiplier
      });
    }
  }

  return [...buckets.values()].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function candleBucketKey(dateValue: string, bucket: "day" | "week" | "month") {
  if (bucket === "day") return dateValue.slice(0, 10);
  const date = new Date(dateValue);
  if (bucket === "month") {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function returnPoints(candles: MarketCandle[], costBasisKrw: number) {
  return pointsFromCandles(returnCandles(candles, costBasisKrw));
}

export function dividendYieldPoints(candles: MarketCandle[], annualDividendKrw: number) {
  return pointsFromCandles(dividendYieldCandles(candles, annualDividendKrw));
}

export function returnCandles(candles: MarketCandle[], costBasisKrw: number) {
  if (costBasisKrw <= 0) return [];
  return candles.map((candle) => ({
    date: candle.date,
    open: (candle.open - costBasisKrw) / costBasisKrw,
    high: (candle.high - costBasisKrw) / costBasisKrw,
    low: (candle.low - costBasisKrw) / costBasisKrw,
    close: (candle.close - costBasisKrw) / costBasisKrw
  }));
}

export function dividendYieldCandles(candles: MarketCandle[], annualDividendKrw: number) {
  if (annualDividendKrw <= 0) return [];
  return candles
    .filter((candle) => candle.low > 0 && candle.high > 0 && candle.open > 0 && candle.close > 0)
    .map((candle) => ({
      date: candle.date,
      open: annualDividendKrw / candle.open,
      high: annualDividendKrw / candle.low,
      low: annualDividendKrw / candle.high,
      close: annualDividendKrw / candle.close
    }));
}

function holdingMarketValue(price: number, holding: Holding, exchangeRate: number) {
  return price * holding.quantity * (holding.currency === "USD" ? exchangeRate : 1);
}

/**
 * Each candle is valued at the exchange rate of its own period (see `candleExchangeRates`),
 * so historical returns include the FX gain or loss of that time.
 */
export function holdingReturnCandles(
  candles: MarketCandle[],
  holding: Holding,
  exchangeRate: number,
  exchangeRatePoints: readonly ExchangeRatePoint[] = []
) {
  if (!holding.averagePurchasePrice || holding.averagePurchasePrice <= 0) return [];
  const isUsd = holding.currency === "USD";
  if (isUsd && (!holding.purchaseExchangeRate || holding.purchaseExchangeRate <= 0)) return [];
  const costBasis =
    holding.averagePurchasePrice *
    holding.quantity *
    (isUsd ? holding.purchaseExchangeRate! : 1);
  if (costBasis <= 0) return [];
  const rates = isUsd
    ? candleExchangeRates(candles.map((candle) => candle.date), exchangeRatePoints, exchangeRate)
    : candles.map(() => 1);

  return candles.map((candle, index) => {
    const rate = rates[index]!;
    const value = (price: number) => (holdingMarketValue(price, holding, rate) - costBasis) / costBasis;
    return {
      date: candle.date,
      open: value(candle.open),
      high: value(candle.high),
      low: value(candle.low),
      close: value(candle.close)
    };
  });
}

export function holdingDividendYieldCandles(
  candles: MarketCandle[],
  annualDividendKrw: number,
  holding: Holding,
  exchangeRate: number
) {
  if (annualDividendKrw <= 0) return [];
  return candles
    .filter((candle) => candle.low > 0 && candle.high > 0 && candle.open > 0 && candle.close > 0)
    .map((candle) => ({
      date: candle.date,
      open: annualDividendKrw / holdingMarketValue(candle.open, holding, exchangeRate),
      high: annualDividendKrw / holdingMarketValue(candle.low, holding, exchangeRate),
      low: annualDividendKrw / holdingMarketValue(candle.high, holding, exchangeRate),
      close: annualDividendKrw / holdingMarketValue(candle.close, holding, exchangeRate)
    }));
}
