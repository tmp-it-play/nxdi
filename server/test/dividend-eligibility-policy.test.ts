import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dividendEligibleFromMonth,
  isEligibleForDividendMonth
} from "../src/domain/dividend-eligibility.js";

describe("DividendEligibilityPolicy", () => {
  describe("given an investment completed before the KST month boundary", () => {
    describe("when the first eligible dividend month is calculated", () => {
      it("then starts eligibility in the following calendar month", () => {
        assert.equal(dividendEligibleFromMonth("2026-07-31T14:59:59.000Z"), "2026-08");
        assert.equal(isEligibleForDividendMonth("2026-07-31T14:59:59.000Z", "2026-07"), false);
        assert.equal(isEligibleForDividendMonth("2026-07-31T14:59:59.000Z", "2026-08"), true);
      });
    });
  });

  describe("given an investment completed after the UTC boundary into a new KST month", () => {
    describe("when eligibility is calculated", () => {
      it("then uses the KST acceptance month", () => {
        assert.equal(dividendEligibleFromMonth("2026-07-31T15:00:00.000Z"), "2026-09");
        assert.equal(isEligibleForDividendMonth("2026-07-31T15:00:00.000Z", "2026-08"), false);
        assert.equal(isEligibleForDividendMonth("2026-07-31T15:00:00.000Z", "2026-09"), true);
      });
    });
  });

  describe("given a December acceptance", () => {
    describe("when eligibility is calculated", () => {
      it("then rolls over to January of the next year", () => {
        assert.equal(dividendEligibleFromMonth("2026-12-15T00:00:00.000Z"), "2027-01");
      });
    });
  });

  describe("given an invalid completion date or dividend month", () => {
    describe("when eligibility is calculated", () => {
      it("then is not eligible", () => {
        assert.equal(isEligibleForDividendMonth("invalid", "2026-07"), false);
        assert.equal(isEligibleForDividendMonth("2026-06-30T14:59:59.000Z", "2026-13"), false);
      });
    });
  });
});
