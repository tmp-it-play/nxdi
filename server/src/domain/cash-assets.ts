import type { Holding, PortfolioCashAsset } from "./types.js";

export type CashCurrency = "KRW" | "USD";
export const MAX_CASH_BALANCE = 1_000_000_000_000;

export function parseCashBalance(currency: CashCurrency, value: string): number | undefined {
  const text = value.trim();
  const pattern = currency === "KRW" ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/;
  if (text.length > 20 || !pattern.test(text)) return undefined;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 && amount <= MAX_CASH_BALANCE ? amount : undefined;
}

export function valueCashAsset(
  asset: Omit<PortfolioCashAsset, "marketValueKrw" | "profitLossKrw" | "profitLossRate">,
  exchangeRate: number
): PortfolioCashAsset {
  const marketValueKrw = asset.balance * (asset.currency === "USD" ? exchangeRate : 1);
  const profitLossKrw = marketValueKrw - asset.initialCostBasisKrw;
  return {
    ...asset, marketValueKrw, profitLossKrw,
    profitLossRate: asset.initialCostBasisKrw > 0 ? profitLossKrw / asset.initialCostBasisKrw : undefined
  };
}

export function portfolioAssetValues(holdings: Holding[], cashAssets: PortfolioCashAsset[] = []) {
  const securitiesMarketValueKrw = holdings.reduce((sum, holding) => sum + holding.marketValueKrw, 0);
  const cashMarketValueKrw = cashAssets.reduce((sum, cash) => sum + cash.marketValueKrw, 0);
  return {
    securitiesMarketValueKrw, cashMarketValueKrw,
    totalMarketValueKrw: securitiesMarketValueKrw + cashMarketValueKrw,
    cashBalanceKrw: cashAssets.find((cash) => cash.currency === "KRW")?.balance ?? 0,
    cashBalanceUsd: cashAssets.find((cash) => cash.currency === "USD")?.balance ?? 0,
    cashCostBasisKrw: cashAssets.reduce((sum, cash) => sum + cash.initialCostBasisKrw, 0)
  };
}
