import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  confirmedMonthEndPortfolioMarketValueKrw,
  monthEndReferencePeriod
} from "../src/domain/month-end-portfolio-market-value.js";

describe("Given a dividend month", () => {
  describe("When its month-end reference period is calculated", () => {
    it("Then it uses the exact calendar month end and the next KST month boundary", () => {
      const period = monthEndReferencePeriod("2026-12");

      assert.equal(period?.snapshotDate, "2026-12-31");
      assert.equal(period?.closedAfter.toISOString(), "2026-12-31T15:00:00.000Z");
    });
  });
});

describe("Given an exact month-end snapshot confirmed after the KST boundary", () => {
  describe("When its reference market value is selected", () => {
    it("Then it uses the immutable closing value", () => {
      const period = monthEndReferencePeriod("2026-07")!;
      const result = confirmedMonthEndPortfolioMarketValueKrw({
        period,
        snapshot: {
          snapshotDate: "2026-07-31",
          totalMarketValueKrw: 650_000,
          closeTotalMarketValueKrw: 638_240,
          closedAt: new Date("2026-07-31T15:10:00.000Z")
        }
      });

      assert.equal(result, 638_240);
    });
  });
});

describe("Given a month-end snapshot closed before the KST month boundary", () => {
  describe("When its reference market value is selected", () => {
    it("Then it rejects the still-mutable monthly valuation", () => {
      const period = monthEndReferencePeriod("2026-07")!;
      const result = confirmedMonthEndPortfolioMarketValueKrw({
        period,
        snapshot: {
          snapshotDate: "2026-07-31",
          totalMarketValueKrw: 650_000,
          closeTotalMarketValueKrw: 638_240,
          closedAt: new Date("2026-07-31T14:59:59.999Z")
        }
      });

      assert.equal(result, undefined);
    });
  });
});

describe("Given a trade written after the month-end snapshot was confirmed", () => {
  describe("When its reference market value is selected", () => {
    it("Then it rejects the stale monthly valuation", () => {
      const period = monthEndReferencePeriod("2026-07")!;
      const result = confirmedMonthEndPortfolioMarketValueKrw({
        period,
        snapshot: {
          snapshotDate: "2026-07-31",
          totalMarketValueKrw: 650_000,
          closeTotalMarketValueKrw: 638_240,
          closedAt: new Date("2026-07-31T15:10:00.000Z")
        },
        latestTradeCreatedAt: new Date("2026-07-31T15:11:00.000Z")
      });

      assert.equal(result, undefined);
    });
  });
});
