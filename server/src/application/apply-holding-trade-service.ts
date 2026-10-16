import { acquisitionNativePrice, realizedSale } from "../domain/holding-cost.js";

export type HoldingTradeState = {
  symbol: string;
  currency: string;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number | null;
  purchaseExchangeRate: number | null;
  riskLevel?: "LOW" | "HIGH" | null;
};

export type HoldingTradeUpdate = {
  quantity: number;
  lastPrice: number;
  averagePurchasePrice?: number;
  purchaseExchangeRate?: number | null;
  profitLossRate?: number | null;
};

export type HoldingAdjustmentType = "BUY" | "SELL" | "GIFT_IN";

export interface HoldingTradeTransaction {
  find(): Promise<HoldingTradeState | null>;
  update(values: HoldingTradeUpdate): Promise<void>;
  delete(): Promise<void>;
  recordExecution(values: HoldingTradeExecution): Promise<void>;
}

export type HoldingTradeExecution = {
  symbol: string;
  side: HoldingAdjustmentType;
  currency: string;
  quantity: number;
  orderPrice: number;
  exchangeRate?: number;
  grossAmountKrw: number;
  feeKrw: number;
  taxKrw: number;
  cashAmountKrw: number;
  costBasisKrw?: number;
  realizedProfitLossKrw?: number;
  realizedFxGainLossKrw?: number;
  executedAt: string;
};

export interface HoldingTradeRepository {
  withSymbolTransaction<T>(
    symbol: string,
    work: (transaction: HoldingTradeTransaction) => Promise<T>
  ): Promise<T>;
}

export type HoldingTradeResult =
  | { status: "not_found" | "insufficient_quantity" | "missing_exchange_rate" | "missing_cost_basis" | "risk_unclassified" }
  | { status: "updated" | "deleted" };

const MIN_REMAINING_QUANTITY = 0.0000001;

export class ApplyHoldingTradeService {
  constructor(
    private readonly repository: HoldingTradeRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  execute(input: {
    symbol: string;
    side: HoldingAdjustmentType;
    quantity: number;
    orderPrice: number;
    exchangeRate?: number;
    feeKrw?: number;
    taxKrw?: number;
  }): Promise<HoldingTradeResult> {
    const symbol = input.symbol.trim().toUpperCase();
    return this.repository.withSymbolTransaction(symbol, async (transaction) => {
      const holding = await transaction.find();
      if (!holding) return { status: "not_found" };
      if (holding.currency === "USD" && !input.exchangeRate) {
        return { status: "missing_exchange_rate" };
      }
      if (input.side !== "SELL" && !holding.riskLevel) return { status: "risk_unclassified" };
      const isGift = input.side === "GIFT_IN";
      const feeKrw = isGift ? 0 : Math.max(0, Math.round(input.feeKrw ?? 0));
      const taxKrw = isGift ? 0 : Math.max(0, Math.round(input.taxKrw ?? 0));
      const grossAmountKrw = Math.round(
        input.quantity * input.orderPrice * (holding.currency === "USD" ? input.exchangeRate ?? 0 : 1)
      );
      const execution = {
        symbol,
        side: input.side,
        currency: holding.currency,
        quantity: input.quantity,
        orderPrice: input.orderPrice,
        exchangeRate: holding.currency === "USD" ? input.exchangeRate : undefined,
        grossAmountKrw,
        feeKrw,
        taxKrw,
        cashAmountKrw: isGift
          ? 0
          : input.side === "BUY"
            ? grossAmountKrw + feeKrw + taxKrw
            : Math.max(grossAmountKrw - feeKrw - taxKrw, 0),
        executedAt: this.now().toISOString()
      } satisfies HoldingTradeExecution;

      if (input.side === "SELL") {
        const nextQuantity = holding.quantity - input.quantity;
        if (nextQuantity < -MIN_REMAINING_QUANTITY) return { status: "insufficient_quantity" };
        const sale = realizedSale({
          currency: holding.currency,
          quantity: input.quantity,
          orderPrice: input.orderPrice,
          exchangeRate: input.exchangeRate,
          proceedsKrw: execution.cashAmountKrw,
          averagePurchasePrice: holding.averagePurchasePrice,
          purchaseExchangeRate: holding.purchaseExchangeRate
        });
        const saleExecution = sale ? { ...execution, ...sale } : execution;
        if (nextQuantity <= MIN_REMAINING_QUANTITY) {
          await transaction.delete();
          await transaction.recordExecution(saleExecution);
          return { status: "deleted" };
        }
        const profitLossRate = holding.averagePurchasePrice && holding.averagePurchasePrice > 0
          ? (input.orderPrice - holding.averagePurchasePrice) / holding.averagePurchasePrice
          : null;
        await transaction.update({ quantity: nextQuantity, lastPrice: input.orderPrice, profitLossRate });
        await transaction.recordExecution(saleExecution);
        return { status: "updated" };
      }

      // Gifts carry no charges; purchases fold KRW fees and taxes into the acquisition cost.
      const tradeNativePrice = isGift ? input.orderPrice : acquisitionNativePrice({
        currency: holding.currency,
        quantity: input.quantity,
        orderPrice: input.orderPrice,
        exchangeRate: input.exchangeRate,
        feeKrw,
        taxKrw
      });

      if (holding.quantity <= MIN_REMAINING_QUANTITY) {
        const nextLastPrice = isGift ? holding.lastPrice : input.orderPrice;
        await transaction.update({
          quantity: input.quantity,
          lastPrice: nextLastPrice,
          averagePurchasePrice: tradeNativePrice,
          purchaseExchangeRate: holding.currency === "USD" ? input.exchangeRate : null,
          profitLossRate: (nextLastPrice - tradeNativePrice) / tradeNativePrice
        });
        await transaction.recordExecution(execution);
        return { status: "updated" };
      }

      if (!holding.averagePurchasePrice || holding.averagePurchasePrice <= 0) return { status: "missing_cost_basis" };

      const currentNativeCost = holding.averagePurchasePrice * holding.quantity;
      const tradeNativeCost = tradeNativePrice * input.quantity;
      const nextQuantity = holding.quantity + input.quantity;
      const nextAveragePurchasePrice = (currentNativeCost + tradeNativeCost) / nextQuantity;
      let nextPurchaseExchangeRate: number | null | undefined = holding.purchaseExchangeRate;

      if (holding.currency === "USD") {
        if (!input.exchangeRate || !holding.purchaseExchangeRate) {
          return { status: "missing_exchange_rate" };
        }
        nextPurchaseExchangeRate =
          (currentNativeCost * holding.purchaseExchangeRate + tradeNativeCost * input.exchangeRate) /
          (currentNativeCost + tradeNativeCost);
      }

      const nextLastPrice = isGift ? holding.lastPrice : input.orderPrice;

      await transaction.update({
        quantity: nextQuantity,
        lastPrice: nextLastPrice,
        averagePurchasePrice: nextAveragePurchasePrice,
        purchaseExchangeRate: holding.currency === "USD" ? nextPurchaseExchangeRate : null,
        profitLossRate: (nextLastPrice - nextAveragePurchasePrice) / nextAveragePurchasePrice
      });
      await transaction.recordExecution(execution);
      return { status: "updated" };
    });
  }
}
