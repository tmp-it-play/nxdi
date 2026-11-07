import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCashBalance, portfolioAssetValues, valueCashAsset } from "../src/domain/cash-assets.js";
import { portfolioCostBasisKrw } from "../src/domain/portfolio-math.js";
import { portfolioDailyChangeRate, returnCandlesFromSnapshots } from "../src/domain/chart-metrics.js";
import { PortfolioSnapshotService, type SnapshotState } from "../src/application/portfolio-snapshot-service.js";
import type { Holding, PortfolioDailySnapshot } from "../src/domain/types.js";

const cash = (currency: "KRW" | "USD", balance: number, rate = 1400) => valueCashAsset({
  currency, balance, initialBalance: currency === "KRW" ? 55500 : 0,
  initialCostBasisKrw: currency === "KRW" ? 55500 : 0, version: 0, updatedAt: "2026-11-08T00:00:00.000Z"
}, rate);
const holding: Holding = { symbol: "TEST", name: "Test", marketCountry: "KOSPI", currency: "KRW", quantity: 1,
  lastPrice: 1_100_000, marketValue: 1_100_000, marketValueKrw: 1_100_000, averagePurchasePrice: 1_000_000 };
const previous: PortfolioDailySnapshot = { date: "2026-11-07", totalMarketValueKrw: 1_000_000,
  closeTotalMarketValueKrw: 1_000_000, closedAt: "2026-11-07T15:10:00.000Z", exchangeRate: 1400,
  createdAt: "2026-11-07T00:00:00.000Z", updatedAt: "2026-11-07T14:00:00.000Z" };

describe("Given KRW and USD cash balances", () => {
  describe("When the operator submits a balance", () => {
    it("Then accepts zero and currency precision without treating empty input as zero", () => {
      assert.equal(parseCashBalance("KRW", "0"), 0);
      assert.equal(parseCashBalance("KRW", "60000"), 60000);
      assert.equal(parseCashBalance("USD", "12.34"), 12.34);
      for (const value of ["", " ", "-1", "NaN", "Infinity", "1e3", "1,000", "1000000000001", "1.001"]) {
        assert.equal(parseCashBalance("USD", value), undefined, value);
      }
      assert.equal(parseCashBalance("KRW", "1.5"), undefined);
    });
  });
  describe("When balances and exchange rates change", () => {
    it("Then retains fixed bases and includes the first USD balance and FX movement in profit", () => {
      assert.equal(cash("KRW", 60000).profitLossKrw, 4500);
      assert.equal(cash("KRW", 0).profitLossKrw, -55500);
      assert.equal(cash("USD", 100).profitLossKrw, 140000);
      assert.equal(cash("USD", 100).profitLossRate, undefined);
      assert.equal(cash("USD", 100, 1500).profitLossKrw - cash("USD", 100).profitLossKrw, 10000);
    });
    it("Then includes cash in both total valuation and the fixed cost basis", () => {
      const assets = [cash("KRW", 60000), cash("USD", 100)];
      assert.equal(portfolioAssetValues([holding], assets).totalMarketValueKrw, 1_300_000);
      assert.equal(portfolioCostBasisKrw([holding], assets), 1_055_500);
      assert.equal(portfolioCostBasisKrw([], assets), 55500);
      assert.equal(portfolioCostBasisKrw([{ ...holding, averagePurchasePrice: undefined }], assets), undefined);
    });
  });
});

describe("Given historical snapshots without cash", () => {
  describe("When cash is first included on the next KST day", () => {
    it("Then includes the entire increase without changing the historical value", () => {
      assert.equal(portfolioDailyChangeRate(1_055_500, [previous], new Date("2026-11-07T15:30:00Z")), 0.0555);
      assert.equal(previous.closeTotalMarketValueKrw, 1_000_000);
    });
    it("Then requires exactly yesterday's positive confirmed value", () => {
      const now = new Date("2026-11-08T05:00:00Z");
      for (const snapshots of [[], [{ ...previous, date: "2026-11-06" }], [{ ...previous, closedAt: undefined }], [{ ...previous, closeTotalMarketValueKrw: 0 }]]) {
        assert.equal(portfolioDailyChangeRate(55500, snapshots, now), undefined);
      }
    });
    it("Then records cash returns in the current candle and preserves historical returns", () => {
      const history = { ...previous, closeCostBasisKrw: 1_000_000 };
      const today = { ...previous, date: "2026-11-08", totalMarketValueKrw: 1_060_000, costBasisKrw: 1_055_500,
        observations: [{ observedAt: "2026-11-08T00:00:00Z", totalMarketValueKrw: 1_055_500, costBasisKrw: 1_055_500 }] };
      const candles = returnCandlesFromSnapshots([history, today]);
      assert.equal(candles[0]?.close, 0);
      assert.equal(candles[1]?.open, 0);
      assert.equal(candles[1]?.close, 4500 / 1_055_500);
    });
  });
});

describe("Given an open cash-inclusive snapshot", () => {
  describe("When the day is finalized", () => {
    it("Then freezes the cash components with the total valuation", async () => {
      const state: SnapshotState = { totalMarketValueKrw: 200000, costBasisKrw: 55500, annualDividendKrw: 0,
        exchangeRate: 1400, cashBalanceKrw: 60000, cashBalanceUsd: 100, cashMarketValueKrw: 200000,
        cashCostBasisKrw: 55500, closedAt: null };
      let saved: SnapshotState | undefined;
      const service = new PortfolioSnapshotService({ find: async () => state, close: async (_date, values) => { saved = values; return true; } }, () => new Date("2026-11-08T15:10:00Z"));
      await service.finalize("2026-11-08");
      assert.equal(saved?.cashBalanceUsd, 100);
      assert.equal(saved?.cashMarketValueKrw, 200000);
      assert.equal(saved?.cashCostBasisKrw, 55500);
    });
  });
});
