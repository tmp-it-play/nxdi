import type { Holding, PortfolioCashAsset } from "./types.js";

export function holdingCostBasisKrw(holding: Pick<
  Holding,
  "averagePurchasePrice" | "currency" | "purchaseExchangeRate" | "quantity"
>) {
  if (!holding.averagePurchasePrice || holding.averagePurchasePrice <= 0) return undefined;
  if (holding.currency === "USD" && (!holding.purchaseExchangeRate || holding.purchaseExchangeRate <= 0)) {
    return undefined;
  }

  const nativeCost = holding.averagePurchasePrice * holding.quantity;
  return holding.currency === "USD" ? nativeCost * holding.purchaseExchangeRate! : nativeCost;
}

export function portfolioCostBasisKrw(holdings: Holding[], cashAssets: PortfolioCashAsset[] = []) {
  let total = cashAssets.reduce((sum, cash) => sum + cash.initialCostBasisKrw, 0);
  let eligibleCount = 0;

  for (const holding of holdings) {
    if (holding.quantity <= 0 || holding.marketValueKrw <= 0) continue;
    eligibleCount += 1;

    const costBasisKrw = holding.costBasisKrw ?? holdingCostBasisKrw(holding);
    if (typeof costBasisKrw !== "number" || costBasisKrw <= 0) return undefined;
    total += costBasisKrw;
  }

  return eligibleCount > 0 || cashAssets.length > 0 ? total : undefined;
}
