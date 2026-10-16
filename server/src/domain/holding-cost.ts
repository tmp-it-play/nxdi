export type TradeCurrency = "KRW" | "USD" | string;

function krwPerUnit(currency: TradeCurrency, exchangeRate?: number | null) {
  return currency === "USD" ? exchangeRate ?? 0 : 1;
}

/**
 * Native-currency acquisition price per share including KRW fees and taxes,
 * so that quantity × price × exchange rate equals the KRW cash actually paid.
 */
export function acquisitionNativePrice(input: {
  currency: TradeCurrency;
  quantity: number;
  orderPrice: number;
  exchangeRate?: number | null;
  feeKrw?: number;
  taxKrw?: number;
}) {
  const rate = krwPerUnit(input.currency, input.exchangeRate);
  const chargesKrw = Math.max(0, input.feeKrw ?? 0) + Math.max(0, input.taxKrw ?? 0);
  if (chargesKrw === 0 || input.quantity <= 0 || rate <= 0) return input.orderPrice;
  return input.orderPrice + chargesKrw / (input.quantity * rate);
}

export type RealizedSale = {
  costBasisKrw: number;
  realizedProfitLossKrw: number;
  realizedFxGainLossKrw: number;
};

/**
 * Realized result of an average-cost sale. The FX part uses the same convention as the
 * unrealized figure: sold USD value × (sale rate − purchase rate); the rest is price and charges.
 */
export function realizedSale(input: {
  currency: TradeCurrency;
  quantity: number;
  orderPrice: number;
  exchangeRate?: number | null;
  proceedsKrw: number;
  averagePurchasePrice: number | null;
  purchaseExchangeRate: number | null;
}): RealizedSale | null {
  if (!input.averagePurchasePrice || input.averagePurchasePrice <= 0) return null;
  const isUsd = input.currency === "USD";
  if (isUsd && (!input.purchaseExchangeRate || input.purchaseExchangeRate <= 0 || !input.exchangeRate)) return null;
  const purchaseRate = isUsd ? input.purchaseExchangeRate! : 1;
  const costBasisKrw = input.quantity * input.averagePurchasePrice * purchaseRate;
  const realizedFxGainLossKrw = isUsd
    ? input.quantity * input.orderPrice * (input.exchangeRate! - purchaseRate)
    : 0;
  return {
    costBasisKrw: Math.round(costBasisKrw),
    realizedProfitLossKrw: Math.round(input.proceedsKrw - costBasisKrw),
    realizedFxGainLossKrw: Math.round(realizedFxGainLossKrw)
  };
}

export type ExchangeRatePoint = { date: string; exchangeRate: number };

/**
 * Rate in effect for each candle: the last known rate before the next candle starts,
 * falling back to the earliest known rate, and `currentRate` for the latest candle.
 */
export function candleExchangeRates(
  candleDates: readonly string[],
  points: readonly ExchangeRatePoint[],
  currentRate: number
) {
  const sorted = points
    .filter((point) => Number.isFinite(point.exchangeRate) && point.exchangeRate > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  return candleDates.map((_, index) => {
    const nextDate = candleDates[index + 1]?.slice(0, 10);
    if (nextDate === undefined) return currentRate;
    let rate: number | undefined;
    for (const point of sorted) {
      if (point.date.slice(0, 10) >= nextDate) break;
      rate = point.exchangeRate;
    }
    return rate ?? sorted[0]?.exchangeRate ?? currentRate;
  });
}
