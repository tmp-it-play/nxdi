import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { fetchDividendRecordFromMarket } from "../src/infrastructure/market-data.js";

const symbol = "0191M0";
const yahooSymbol = `${symbol}.KS`;
const timestamp = Date.parse("2026-11-18T06:00:00Z") / 1000;
const market = {
  meta: { symbol: yahooSymbol, currency: "KRW", regularMarketPrice: 101420 },
  timestamp: [timestamp]
};

function mockYahoo(t: TestContext, result: unknown, error: unknown = null) {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const matched = url.pathname.endsWith(`/${yahooSymbol}`);
    return Response.json({
      chart: matched
        ? { result: result ? [result] : null, error }
        : { result: null, error: { code: "Not Found" } }
    });
  });
}

describe("Given a recognized security with no dividend payments", () => {
  describe("When the market response contains prices and no dividend events", () => {
    it("Then records zero annual dividends and no payment months", async (t) => {
      mockYahoo(t, market);

      const record = await fetchDividendRecordFromMarket(symbol);

      assert.equal(record?.symbol, symbol);
      assert.equal(record?.currency, "KRW");
      assert.equal(record?.annualDividendPerShare, 0);
      assert.equal(record?.trailingYield, 0);
      assert.deepEqual(record?.expectedPaymentMonths, []);
      assert.equal(record?.lastDividendPerShare, undefined);
      assert.match(record?.memo ?? "", /Yahoo/);
    });
  });

  describe("When the dividend event collection is explicitly empty", () => {
    it("Then records zero annual dividends", async (t) => {
      mockYahoo(t, { ...market, events: { dividends: {} } });

      const record = await fetchDividendRecordFromMarket(symbol);

      assert.equal(record?.annualDividendPerShare, 0);
      assert.deepEqual(record?.expectedPaymentMonths, []);
    });
  });

  describe("When an existing Korean symbol includes its exchange suffix", () => {
    it("Then stores the same normalized symbol for dividend lookup", async (t) => {
      mockYahoo(t, market);

      const record = await fetchDividendRecordFromMarket(yahooSymbol);

      assert.equal(record?.symbol, symbol);
      assert.equal(record?.annualDividendPerShare, 0);
    });
  });
});

describe("Given incomplete or unsuccessful dividend data", () => {
  describe("When the provider returns an error alongside market data", () => {
    it("Then leaves the dividend amount unknown", async (t) => {
      mockYahoo(t, market, { code: "Unavailable" });

      assert.equal(await fetchDividendRecordFromMarket(symbol), null);
    });
  });

  describe("When the provider does not identify the requested security", () => {
    it("Then leaves the dividend amount unknown", async (t) => {
      mockYahoo(t, { ...market, meta: { ...market.meta, symbol: "OTHER.KS" } });

      assert.equal(await fetchDividendRecordFromMarket(symbol), null);
    });
  });

  describe("When the provider returns no market history", () => {
    it("Then leaves the dividend amount unknown", async (t) => {
      mockYahoo(t, { ...market, timestamp: [] });

      assert.equal(await fetchDividendRecordFromMarket(symbol), null);
    });
  });

  describe("When the provider returns no valid price", () => {
    it("Then leaves the dividend amount unknown", async (t) => {
      mockYahoo(t, { ...market, meta: { ...market.meta, regularMarketPrice: 0 } });

      assert.equal(await fetchDividendRecordFromMarket(symbol), null);
    });
  });

  describe("When dividend events exist but contain incomplete payment data", () => {
    it("Then leaves the dividend amount unknown", async (t) => {
      mockYahoo(t, { ...market, events: { dividends: { payment: { date: timestamp } } } });

      assert.equal(await fetchDividendRecordFromMarket(symbol), null);
    });
  });
});

describe("Given a security with dividend payments", () => {
  describe("When the market returns its dividend history", () => {
    it("Then preserves the annual amount and latest payment", async (t) => {
      mockYahoo(t, {
        ...market,
        events: {
          dividends: {
            latest: { date: timestamp, amount: 150 },
            previous: { date: timestamp - 90 * 86400, amount: 100 },
            older: { date: timestamp - 366 * 86400, amount: 75 }
          }
        }
      });

      const record = await fetchDividendRecordFromMarket(symbol);

      assert.equal(record?.annualDividendPerShare, 250);
      assert.equal(record?.lastDividendPerShare, 150);
      assert.equal(record?.trailingYield, 250 / 101420);
    });
  });
});
