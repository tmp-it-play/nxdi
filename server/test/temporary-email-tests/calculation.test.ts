import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateTestMonthlyPayout, type MonthlyTestInput } from "../../src/temporary/email-tests/domain.js";

describe("Given an administrator supplies a hypothetical monthly payout", () => {
  const sample: MonthlyTestInput = {
    dividendMonth: "2026-09", totalMarketValueKrw: 1_000_000, investmentKrw: 100_000, actualDividendKrw: 10_000
  };

  describe("When the documented sample is calculated", () => {
    it("Then existing policy pays 1,425 won with a 75 won fee without adding the investment to portfolio value", () => {
      const result = calculateTestMonthlyPayout(sample);
      assert.equal(result.displayedKrw, 1_425);
      assert.equal(result.managementFeeKrw, 75);
      assert.equal(result.reinvestmentKrw, 0);
      assert.equal(result.allocation.investorPrincipalKrw, 100_000);
      assert.equal(result.allocation.companyPrincipalKrw, 900_000);
      assert.equal(result.totalMarketValueKrw, 1_000_000);
    });
  });

  describe("When the administrator explicitly enters zero dividends or zero principal", () => {
    it("Then it allows the scenario and returns zero without production eligibility checks", () => {
      assert.equal(calculateTestMonthlyPayout({ ...sample, actualDividendKrw: 0 }).displayedKrw, 0);
      assert.equal(calculateTestMonthlyPayout({ ...sample, investmentKrw: 0 }).displayedKrw, 0);
      assert.equal(calculateTestMonthlyPayout({ ...sample, dividendMonth: "2035-01" }).displayedKrw, 1_425);
    });
  });

  describe("When any test amount is negative, fractional, absent, nonfinite, or unsafe", () => {
    it("Then the calculation rejects it rather than coercing or silently normalizing it", () => {
      for (const key of ["totalMarketValueKrw", "investmentKrw", "actualDividendKrw"] as const) {
        for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
          assert.throws(() => calculateTestMonthlyPayout({ ...sample, [key]: value }), RangeError, `${key}=${value}`);
        }
      }
      assert.throws(() => calculateTestMonthlyPayout({ ...sample, totalMarketValueKrw: 0 }), RangeError);
    });
  });

  describe("When the dividend month is not a real YYYY-MM month", () => {
    it("Then it rejects the request before producing a preview", () => {
      for (const dividendMonth of ["2026-1", "2026-00", "2026-13", "2026-09-01", "0000-01", ""]) {
        assert.throws(() => calculateTestMonthlyPayout({ ...sample, dividendMonth }), RangeError);
      }
    });
  });
});
