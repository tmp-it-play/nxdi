import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acquisitionNativePrice, candleExchangeRates, realizedSale } from "../src/domain/holding-cost.js";

describe("Given a USD purchase with KRW fees and taxes", () => {
  describe("When the acquisition price is calculated", () => {
    it("Then quantity × price × rate equals the KRW cash paid", () => {
      const price = acquisitionNativePrice({
        currency: "USD", quantity: 10, orderPrice: 20, exchangeRate: 1500, feeKrw: 500, taxKrw: 100
      });
      assert.ok(Math.abs(10 * price * 1500 - 300_600) < 1e-9);
    });
  });
});

describe("Given a KRW purchase without charges", () => {
  describe("When the acquisition price is calculated", () => {
    it("Then the order price is kept", () => {
      assert.equal(acquisitionNativePrice({ currency: "KRW", quantity: 3, orderPrice: 5_000 }), 5_000);
    });
  });
});

describe("Given monthly candles and daily exchange-rate snapshots", () => {
  const points = [
    { date: "2026-07-31", exchangeRate: 1450 },
    { date: "2026-08-15", exchangeRate: 1400 },
    { date: "2026-08-31", exchangeRate: 1380 },
    { date: "2026-09-30", exchangeRate: 1360 }
  ];

  describe("When rates are assigned to each candle", () => {
    it("Then each past month uses its last rate and the latest month uses the current rate", () => {
      const rates = candleExchangeRates(["2026-08-01", "2026-09-01", "2026-10-01"], points, 1342);
      assert.deepEqual(rates, [1380, 1360, 1342]);
    });

    it("Then a snapshot on the first day of a month belongs to that month even with timestamped candles", () => {
      const rates = candleExchangeRates(
        ["2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"],
        [...points, { date: "2026-09-01", exchangeRate: 1370 }],
        1342
      );
      assert.deepEqual(rates, [1380, 1360, 1342]);
    });

    it("Then a month before any snapshot falls back to the earliest known rate", () => {
      const rates = candleExchangeRates(["2026-06-01", "2026-08-01", "2026-10-01"], points, 1342);
      assert.deepEqual(rates, [1450, 1380, 1342]);
    });

    it("Then a gap in candles does not borrow a later month's rate", () => {
      const rates = candleExchangeRates(["2026-06-01", "2026-07-01", "2026-10-01"], points, 1342);
      assert.deepEqual(rates, [1450, 1450, 1342]);
    });
  });
});

describe("Given one share bought and sold at the same price and rate", () => {
  describe("When the realized result is calculated with a half-won cost", () => {
    it("Then the stored cost and profit add up to the proceeds", () => {
      const sale = realizedSale({
        currency: "USD", quantity: 1, orderPrice: 10.5, exchangeRate: 1001, proceedsKrw: 10_511,
        averagePurchasePrice: 10.5, purchaseExchangeRate: 1001
      })!;
      assert.equal(sale.costBasisKrw + sale.realizedProfitLossKrw, 10_511);
      assert.equal(sale.realizedProfitLossKrw, 0);
    });
  });
});
