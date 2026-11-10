import type { Holding, PortfolioCashAsset, PortfolioOverview } from "./types";

export type PortfolioAsset =
  | { kind: "holding"; id: string; marketValueKrw: number; holding: Holding }
  | { kind: "cash"; id: string; marketValueKrw: number; cash: PortfolioCashAsset };

export function cashLabel(currency: "KRW" | "USD") {
  return currency === "KRW" ? "원화 현금" : "달러 현금";
}

export function portfolioAssets(
  portfolio: Pick<PortfolioOverview, "holdings" | "cashAssets">,
  { includeZeroBalanceCash = false }: { includeZeroBalanceCash?: boolean } = {}
): PortfolioAsset[] {
  return [
    ...portfolio.holdings.map((holding): PortfolioAsset => ({ kind: "holding", id: holding.symbol, marketValueKrw: holding.marketValueKrw, holding })),
    ...(portfolio.cashAssets ?? [])
      .filter((cash) => includeZeroBalanceCash || cash.balance !== 0)
      .map((cash): PortfolioAsset => ({ kind: "cash", id: `cash:${cash.currency}`, marketValueKrw: cash.marketValueKrw, cash }))
  ].sort((a, b) => b.marketValueKrw - a.marketValueKrw || a.id.localeCompare(b.id));
}
