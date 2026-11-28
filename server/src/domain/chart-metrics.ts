import type {
  Holding,
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

/** Compares today's whole portfolio with exactly the previous KST day's confirmed value. */
export function portfolioDailyChangeRate(
  totalMarketValueKrw: number,
  snapshots: PortfolioDailySnapshot[],
  now: Date
) {
  const yesterday = new Date(now.getTime() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const previous = snapshots.find((snapshot) => snapshot.date === yesterday);
  const close = previous?.closeTotalMarketValueKrw;
  if (!previous?.closedAt || close === undefined || !Number.isFinite(close) || close <= 0 ||
      !Number.isFinite(totalMarketValueKrw) || totalMarketValueKrw < 0) return undefined;
  return (totalMarketValueKrw - close) / close;
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
  metricValue: (valuation: PortfolioValuation) => number | undefined
) {
  const candles: MarketCandle[] = [];
  for (const [index, snapshot] of snapshots.entries()) {
    const latest = isLatestSnapshot(index, snapshots);
    const valuation = effectiveValuation(snapshot, latest);
    const close = valuation && metricValue(valuation);
    if (close === undefined) continue;
    const values = observationsThroughClose(snapshot, latest).map(metricValue).filter((value) => value !== undefined);
    candles.push(candleFromObservations(snapshot.date, values, close, candles.at(-1)?.close));
  }
  return candles;
}

export function candlesFromSnapshots(snapshots: PortfolioDailySnapshot[]) {
  return snapshotCandles(snapshots, (sample) => sample.totalMarketValueKrw);
}

export function returnCandlesFromSnapshots(snapshots: PortfolioDailySnapshot[]) {
  return snapshotCandles(snapshots, ({ totalMarketValueKrw, costBasisKrw }) =>
    costBasisKrw !== undefined && costBasisKrw > 0 ? (totalMarketValueKrw - costBasisKrw) / costBasisKrw : undefined
  );
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
