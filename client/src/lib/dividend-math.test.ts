import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { forecastLinePaymentAmount } from "./dividend-math";
import type { DividendForecastLine } from "@/lib/types";

function forecastLine(overrides: Partial<DividendForecastLine>): DividendForecastLine {
  return {
    symbol: "TEST",
    name: "Test",
    marketCountry: "KOSPI",
    currency: "KRW",
    allocationKrw: 100000,
    estimatedQuantity: 10,
    annualDividendKrw: 12000,
    monthlyAverageKrw: 1000,
    expectedPaymentMonths: [3, 6, 9, 12],
    ...overrides
  };
}

describe("forecastLinePaymentAmount", () => {
  it("splits annual expected dividend by scheduled payment months", () => {
    assert.equal(forecastLinePaymentAmount(forecastLine({})), 3000);
  });

  it("does not use the latest dividend amount as the forecast amount", () => {
    assert.equal(forecastLinePaymentAmount(forecastLine({ lastDividendKrw: 5000 })), 3000);
  });

  it("keeps unscheduled annual dividend in the unscheduled bucket", () => {
    assert.equal(forecastLinePaymentAmount(forecastLine({ expectedPaymentMonths: [] })), 12000);
  });

  it("does not convert missing dividend data to zero", () => {
    assert.equal(forecastLinePaymentAmount(forecastLine({
      annualDividendKrw: undefined,
      monthlyAverageKrw: undefined,
      dividendDataMissing: true
    })), undefined);
  });
});
