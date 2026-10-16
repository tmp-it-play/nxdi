import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  candlesFromSnapshots,
  changeRateFromSnapshots,
  dividendYieldCandlesFromSnapshots,
  holdingDividendYieldCandles,
  holdingReturnCandles,
  monthlyDividendYieldCandlesFromSnapshots,
  portfolioChangeRateFromMarketValue,
  pointsFromSnapshots,
  returnCandlesFromSnapshots,
  samplePoints
} from "../src/domain/chart-metrics.js";
import type { MarketChart } from "../src/domain/chart-metrics.js";
import type { Holding } from "../src/domain/types.js";

function holding(overrides: Partial<Holding>): Holding {
  return {
    symbol: "TEST",
    name: "Test",
    marketCountry: "KOSPI",
    currency: "KRW",
    quantity: 10,
    lastPrice: 110,
    marketValue: 1100,
    marketValueKrw: 1100,
    ...overrides
  };
}

function chart(overrides: Partial<MarketChart>): MarketChart {
  return {
    symbol: "TEST",
    currency: "KRW",
    marketCountry: "KOSPI",
    previousClose: 100,
    candles: [
      { date: "2026-01-01T00:00:00.000Z", open: 90, high: 105, low: 85, close: 100 },
      { date: "2026-01-02T00:00:00.000Z", open: 100, high: 999, low: 95, close: 999 }
    ],
    ...overrides
  };
}

describe("Given portfolio holdings and market charts, when the daily change is calculated", () => {
  it("then uses current holding market value instead of the latest chart close", () => {
    const rate = portfolioChangeRateFromMarketValue({
      holdings: [holding({})],
      charts: new Map([["TEST", chart({})]]),
      exchangeRate: 1300
    });

    assert.equal(rate, 0.1);
  });

  it("then prefers the previous candle close over range chartPreviousClose", () => {
    const rate = portfolioChangeRateFromMarketValue({
      holdings: [holding({})],
      charts: new Map([["TEST", chart({ previousClose: 80 })]]),
      exchangeRate: 1300
    });

    assert.equal(rate, 0.1);
  });

  it("then uses current exchange rate for USD previous market value", () => {
    const rate = portfolioChangeRateFromMarketValue({
      holdings: [
        holding({
          currency: "USD",
          marketCountry: "NASDAQ",
          quantity: 2,
          lastPrice: 55,
          marketValue: 110,
          marketValueKrw: 143000
        })
      ],
      charts: new Map([[
        "TEST",
        chart({
          currency: "USD",
          marketCountry: "NASDAQ",
          previousClose: 45,
          candles: [
            { date: "2026-01-01T00:00:00.000Z", open: 45, high: 55, low: 44, close: 50 },
            { date: "2026-01-02T00:00:00.000Z", open: 50, high: 60, low: 49, close: 60 }
          ]
        })
      ]]),
      exchangeRate: 1300
    });

    assert.equal(rate, 0.1);
  });

  it("then falls back to the previous candle close when chart previousClose is missing", () => {
    const rate = portfolioChangeRateFromMarketValue({
      holdings: [holding({})],
      charts: new Map([["TEST", chart({ previousClose: undefined })]]),
      exchangeRate: 1300
    });

    assert.equal(rate, 0.1);
  });

  it("then does not estimate a total rate from partial holding coverage", () => {
    const rate = portfolioChangeRateFromMarketValue({
      holdings: [
        holding({}),
        holding({
          symbol: "MISS",
          name: "Missing",
          quantity: 10,
          lastPrice: 50,
          marketValue: 500,
          marketValueKrw: 500
        })
      ],
      charts: new Map([["TEST", chart({})]]),
      exchangeRate: 1300
    });

    assert.equal(rate, undefined);
  });
});

describe("Given portfolio snapshots, when the daily change is calculated", () => {
  it("then does not estimate from unclosed previous snapshots", () => {
    const rate = changeRateFromSnapshots([
      {
        date: "2026-07-07",
        totalMarketValueKrw: 100000,
        exchangeRate: 1300,
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z"
      },
      {
        date: "2026-07-08",
        totalMarketValueKrw: 102500,
        exchangeRate: 1310,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ]);

    assert.equal(rate, undefined);
  });

  it("then compares the latest market value with the previous closed market value", () => {
    const rate = changeRateFromSnapshots([
      {
        date: "2026-07-07",
        totalMarketValueKrw: 100000,
        exchangeRate: 1300,
        closeTotalMarketValueKrw: 101000,
        closeExchangeRate: 1300,
        closedAt: "2026-07-07T14:55:00.000Z",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T14:55:00.000Z"
      },
      {
        date: "2026-07-08",
        totalMarketValueKrw: 102010,
        exchangeRate: 1310,
        closeTotalMarketValueKrw: 99000,
        closeExchangeRate: 1310,
        closedAt: "2026-07-08T14:55:00.000Z",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T14:55:00.000Z"
      }
    ]);

    assert.equal(rate, 0.01);
  });

  it("then does not estimate a rate when fewer than two snapshots exist", () => {
    const rate = changeRateFromSnapshots([
      {
        date: "2026-07-08",
        totalMarketValueKrw: 102500,
        exchangeRate: 1310,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ]);

    assert.equal(rate, undefined);
  });
});

describe("Given portfolio snapshots, when a market-value series is built", () => {
  it("then uses closed values for historical points and latest values for the current point", () => {
    const snapshots = [
      {
        date: "2026-07-07",
        totalMarketValueKrw: 100000,
        exchangeRate: 1300,
        closeTotalMarketValueKrw: 101000,
        closeExchangeRate: 1300,
        closedAt: "2026-07-07T14:55:00.000Z",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T14:55:00.000Z"
      },
      {
        date: "2026-07-08",
        totalMarketValueKrw: 102500,
        exchangeRate: 1310,
        closeTotalMarketValueKrw: 99000,
        closeExchangeRate: 1310,
        closedAt: "2026-07-08T14:55:00.000Z",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T14:55:00.000Z"
      }
    ];

    assert.deepEqual(pointsFromSnapshots(snapshots), [
      { date: "2026-07-07", value: 101000 },
      { date: "2026-07-08", value: 102500 }
    ]);
    assert.deepEqual(candlesFromSnapshots(snapshots), [
      { date: "2026-07-07", open: 101000, high: 101000, low: 101000, close: 101000 },
      { date: "2026-07-08", open: 101000, high: 102500, low: 101000, close: 102500 }
    ]);
  });

  it("then omits unclosed historical points instead of using stale values", () => {
    const snapshots = [
      {
        date: "2026-07-07",
        totalMarketValueKrw: 100000,
        exchangeRate: 1300,
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T12:00:00.000Z"
      },
      {
        date: "2026-07-08",
        totalMarketValueKrw: 102500,
        exchangeRate: 1310,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T12:00:00.000Z"
      }
    ];

    assert.deepEqual(pointsFromSnapshots(snapshots), [
      { date: "2026-07-08", value: 102500 }
    ]);
    assert.deepEqual(candlesFromSnapshots(snapshots).map((candle) => candle.date), ["2026-07-08"]);
  });
});

describe("Given a long chart series, when it is sampled for a compact response", () => {
  it("then preserves both the first and latest points", () => {
    const points = Array.from({ length: 252 }, (_, index) => ({
      date: `day-${index}`,
      value: index
    }));

    const sampled = samplePoints(points, 72);

    assert.equal(sampled.length, 72);
    assert.deepEqual(sampled[0], points[0]);
    assert.deepEqual(sampled.at(-1), points.at(-1));
  });

  it("then keeps the latest point when only one point can be returned", () => {
    const points = [
      { date: "first", value: 1 },
      { date: "latest", value: 2 }
    ];

    assert.deepEqual(samplePoints(points, 1), [points[1]]);
  });
});

describe("Given portfolio snapshots, when return candles are built", () => {
  it("then uses stored market value and cost basis snapshots", () => {
    const candles = returnCandlesFromSnapshots([
      {
        date: "2026-07-08",
        totalMarketValueKrw: 143000,
        exchangeRate: 1300,
        costBasisKrw: 100000,
        annualDividendKrw: 5000,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ]);

    assert.equal(candles.at(0)?.close, 0.43);
  });

  it("then uses closed market value and closed cost basis for historical returns", () => {
    const candles = returnCandlesFromSnapshots([
      {
        date: "2026-07-07",
        totalMarketValueKrw: 100000,
        exchangeRate: 1300,
        costBasisKrw: 50000,
        closeTotalMarketValueKrw: 90000,
        closeExchangeRate: 1300,
        closeCostBasisKrw: 60000,
        closedAt: "2026-07-07T14:55:00.000Z",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T14:55:00.000Z"
      },
      {
        date: "2026-07-08",
        totalMarketValueKrw: 120000,
        exchangeRate: 1310,
        costBasisKrw: 100000,
        closeTotalMarketValueKrw: 1,
        closeExchangeRate: 1310,
        closeCostBasisKrw: 1,
        closedAt: "2026-07-08T14:55:00.000Z",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T14:55:00.000Z"
      }
    ]);

    assert.equal(candles.at(0)?.close, 0.5);
    assert.deepEqual(candles.at(1), {
      date: "2026-07-08",
      open: 0.5,
      high: 0.5,
      low: 0.2,
      close: 0.2
    });
  });
});

describe("Given portfolio snapshots, when dividend-yield candles are built", () => {
  it("then uses stored annual dividend and market value snapshots", () => {
    const candles = dividendYieldCandlesFromSnapshots([
      {
        date: "2026-07-08",
        totalMarketValueKrw: 143000,
        exchangeRate: 1300,
        costBasisKrw: 100000,
        annualDividendKrw: 7150,
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T00:00:00.000Z"
      }
    ]);

    assert.equal(candles.at(0)?.close, 0.05);
  });

  it("then uses closed annual dividend and closed market value for historical dividend yield", () => {
    const candles = dividendYieldCandlesFromSnapshots([
      {
        date: "2026-07-07",
        totalMarketValueKrw: 100000,
        exchangeRate: 1300,
        annualDividendKrw: 10000,
        closeTotalMarketValueKrw: 120000,
        closeExchangeRate: 1300,
        closeAnnualDividendKrw: 6000,
        closedAt: "2026-07-07T14:55:00.000Z",
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T14:55:00.000Z"
      },
      {
        date: "2026-07-08",
        totalMarketValueKrw: 200000,
        exchangeRate: 1310,
        annualDividendKrw: 10000,
        closeTotalMarketValueKrw: 1,
        closeExchangeRate: 1310,
        closeAnnualDividendKrw: 1,
        closedAt: "2026-07-08T14:55:00.000Z",
        createdAt: "2026-07-08T00:00:00.000Z",
        updatedAt: "2026-07-08T14:55:00.000Z"
      }
    ]);

    assert.equal(candles.at(0)?.close, 0.05);
    assert.equal(candles.at(1)?.close, 0.05);
  });

  it("then uses actual monthly dividend records for history and an estimate for the latest month", () => {
    const candles = dividendYieldCandlesFromSnapshots(
      [
        {
          date: "2026-06-30",
          totalMarketValueKrw: 100000,
          exchangeRate: 1300,
          annualDividendKrw: 10000,
          closeTotalMarketValueKrw: 200000,
          closeExchangeRate: 1300,
          closeAnnualDividendKrw: 10000,
          closedAt: "2026-06-30T14:55:00.000Z",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T14:55:00.000Z"
        },
        {
          date: "2026-07-09",
          totalMarketValueKrw: 400000,
          exchangeRate: 1310,
          annualDividendKrw: 50000,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z"
        }
      ],
      [
        {
          dividendMonth: "2026-06",
          recordId: "mdr_20260600000000000000000000000000",
          actualDividendKrw: 10000,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      ],
      20000
    );

    assert.equal(candles.at(0)?.close, 0.05);
    assert.equal(candles.at(1)?.close, 0.05);
  });
});

describe("Given monthly dividend history, when monthly yield candles are built", () => {
  it("then annualizes actual monthly records and adds the current annual estimate", () => {
    const candles = monthlyDividendYieldCandlesFromSnapshots(
      [
        {
          date: "2026-06-10",
          totalMarketValueKrw: 100000,
          exchangeRate: 1300,
          closeTotalMarketValueKrw: 100000,
          closeExchangeRate: 1300,
          closedAt: "2026-06-10T14:55:00.000Z",
          createdAt: "2026-06-10T00:00:00.000Z",
          updatedAt: "2026-06-10T14:55:00.000Z"
        },
        {
          date: "2026-06-30",
          totalMarketValueKrw: 120000,
          exchangeRate: 1300,
          closeTotalMarketValueKrw: 200000,
          closeExchangeRate: 1300,
          closedAt: "2026-06-30T14:55:00.000Z",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T14:55:00.000Z"
        },
        {
          date: "2026-07-09",
          totalMarketValueKrw: 400000,
          exchangeRate: 1310,
          createdAt: "2026-07-09T00:00:00.000Z",
          updatedAt: "2026-07-09T00:00:00.000Z"
        }
      ],
      [
        {
          dividendMonth: "2026-05",
          recordId: "mdr_20260500000000000000000000000000",
          actualDividendKrw: 4000,
          referenceMarketValueKrw: 300000,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z"
        },
        {
          dividendMonth: "2026-06",
          recordId: "mdr_20260600000000000000000000000000",
          actualDividendKrw: 8000,
          referenceMarketValueKrw: 200000,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      ],
      48000,
      400000,
      "2026-07"
    );

    assert.deepEqual(candles.map((candle) => candle.date), [
      "2026-05-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z"
    ]);
    assert.equal(candles.at(0)?.close, 0.16);
    assert.equal(candles.at(1)?.close, 0.36);
    assert.deepEqual(candles.at(2), {
      date: "2026-07-01T00:00:00.000Z",
      open: 0.36,
      high: 0.36,
      low: 0.12,
      close: 0.12
    });
  });

  it("then skips historical monthly records without a reference market value", () => {
    const candles = monthlyDividendYieldCandlesFromSnapshots(
      [],
      [
        {
          dividendMonth: "2026-06",
          recordId: "mdr_20260600000000000000000000000000",
          actualDividendKrw: 8000,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z"
        }
      ],
      undefined,
      undefined,
      "2026-07"
    );

    assert.deepEqual(candles, []);
  });
});

describe("Given a holding and market candles, when holding-return candles are built", () => {
  it("then uses current exchange rate for market value and purchase exchange rate for cost basis", () => {
    const candles = holdingReturnCandles(
      [{ date: "2026-01-02T00:00:00.000Z", open: 10, high: 12, low: 9, close: 11 }],
      holding({
        currency: "USD",
        marketCountry: "NASDAQ",
        quantity: 2,
        averagePurchasePrice: 10,
        purchaseExchangeRate: 1000
      }),
      1300
    );

    assert.equal(candles.at(0)?.close, 0.43);
  });
});

describe("Given a USD holding without a purchase exchange rate", () => {
  describe("When holding-return candles are built", () => {
    it("Then no candles are returned instead of hiding the FX result", () => {
      const candles = holdingReturnCandles(
        [{ date: "2026-01-02T00:00:00.000Z", open: 10, high: 12, low: 9, close: 11 }],
        holding({ currency: "USD", marketCountry: "NASDAQ", quantity: 2, averagePurchasePrice: 10 }),
        1300
      );

      assert.deepEqual(candles, []);
    });
  });
});

describe("Given a holding and market candles, when holding dividend-yield candles are built", () => {
  it("then uses current exchange rate adjusted holding market value as denominator", () => {
    const candles = holdingDividendYieldCandles(
      [{ date: "2026-01-02T00:00:00.000Z", open: 10, high: 12, low: 9, close: 11 }],
      2860,
      holding({
        currency: "USD",
        marketCountry: "NASDAQ",
        quantity: 2
      }),
      1300
    );

    assert.equal(candles.at(0)?.close, 0.1);
  });
});
