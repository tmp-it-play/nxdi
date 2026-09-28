import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeInvestorRecipients,
  calculateMonthlyPayouts,
  calculateTestMonthlyPayout,
  dueNotificationPeriods,
  kstDateKey,
  previousDividendMonth,
  type MonthlyTestInput,
  type NotificationIntent,
  type NotificationStore
} from "../src/domain/notifications/index.js";

function intent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    id: "investment-1", userId: "user-1", userName: "투자자 1", status: "COMPLETED",
    amountKrw: 100_000, updatedAt: "2026-07-15T00:00:00.000Z", ...overrides
  };
}

describe("Given scheduled notifications use the Korean calendar", () => {
  describe("When UTC is still the last day of the prior year", () => {
    it("Then midnight Korea starts the next year and selects December dividends", () => {
      const now = new Date("2026-12-31T15:00:00.000Z");
      assert.equal(kstDateKey(now), "2027-01-01");
      assert.equal(previousDividendMonth(now), "2026-12");
    });
  });

  describe("When activation precedes a quarter boundary by one millisecond", () => {
    it("Then both the monthly payout and current quarterly statement become due at midnight", () => {
      const activatedAt = new Date("2026-09-30T14:59:59.999Z");
      assert.deepEqual(dueNotificationPeriods(activatedAt, activatedAt), { monthly: [], quarterly: [] });
      assert.deepEqual(dueNotificationPeriods(activatedAt, new Date("2026-09-30T15:00:00.000Z")), {
        monthly: ["2026-09"], quarterly: [{ period: "2026-Q4", status: "DUE" }]
      });
    });
  });

  describe("When activation occurs exactly at midnight on a scheduled date", () => {
    it("Then that scheduled period is eligible", () => {
      const now = new Date("2026-09-30T15:00:00.000Z");
      assert.deepEqual(dueNotificationPeriods(now, now), {
        monthly: ["2026-09"], quarterly: [{ period: "2026-Q4", status: "DUE" }]
      });
    });
  });

  describe("When activation occurs after the scheduled instant", () => {
    it("Then no pre-activation monthly or quarterly mail is backfilled", () => {
      assert.deepEqual(dueNotificationPeriods(new Date("2026-09-30T15:00:00.001Z"), new Date("2026-10-15T00:00:00.000Z")), {
        monthly: [], quarterly: []
      });
    });
  });

  describe("When processing resumes after several months", () => {
    it("Then all outstanding monthly periods remain eligible while older uncreated quarters are skipped", () => {
      assert.deepEqual(dueNotificationPeriods(new Date("2026-06-29T00:00:00.000Z"), new Date("2027-01-12T00:00:00.000Z")), {
        monthly: ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"],
        quarterly: [
          { period: "2026-Q3", status: "SKIPPED" }, { period: "2026-Q4", status: "SKIPPED" }, { period: "2027-Q1", status: "DUE" }
        ]
      });
    });
  });

  describe("When activation is in the future or either timestamp is invalid", () => {
    it("Then future activation has no due periods and invalid dates are rejected", () => {
      assert.deepEqual(dueNotificationPeriods(new Date("2026-11-01"), new Date("2026-10-01")), { monthly: [], quarterly: [] });
      assert.throws(() => dueNotificationPeriods(new Date("invalid"), new Date("2026-10-01")), RangeError);
      assert.throws(() => previousDividendMonth(new Date("invalid")), RangeError);
    });
  });
});

describe("Given investors can hold multiple intents in different states", () => {
  const store: NotificationStore = {
    investmentIntents: [
      intent(), intent({ id: "investment-2", amountKrw: 50_000 }),
      intent({ id: "pending", status: "PENDING", userId: "pending-user" }),
      intent({ id: "rejected", status: "REJECTED", userId: "rejected-user" }),
      intent({ id: "withdrawn", status: "WITHDRAWN", userId: "withdrawn-user" }),
      intent({ id: "zero", amountKrw: 0, userId: "zero-user" }),
      intent({ id: "closed", userId: "closed-user" })
    ],
    withdrawalIntents: [
      intent({ id: "partial-withdrawal", amountKrw: 25_000 }),
      intent({ id: "pending-withdrawal", status: "PENDING" }),
      intent({ id: "closed-withdrawal", userId: "closed-user" })
    ]
  };

  describe("When active recipients for disclosures and statements are selected", () => {
    it("Then completed net balances are aggregated once per user and fully withdrawn users are excluded", () => {
      assert.deepEqual(activeInvestorRecipients(store), [
        { userId: "user-1", userName: "투자자 1", investmentKrw: 125_000 }
      ]);
    });
  });

  describe("When a completed investment is new in the current month", () => {
    it("Then it is immediately eligible for disclosures even before dividend eligibility starts", () => {
      assert.equal(activeInvestorRecipients({ investmentIntents: [intent({ updatedAt: "2026-10-10T00:00:00.000Z" })], withdrawalIntents: [] }).length, 1);
    });
  });
});

describe("Given a monthly payout uses historical dividend eligibility and withdrawals", () => {
  const store: NotificationStore = {
    investmentIntents: [
      intent({ id: "old", amountKrw: 100_000, updatedAt: "2026-06-10T00:00:00.000Z" }),
      intent({ id: "new", amountKrw: 50_000 }),
      intent({ id: "current-month", amountKrw: 500_000, updatedAt: "2026-08-10T00:00:00.000Z" }),
      intent({ id: "closed", userId: "closed-user" }),
      intent({ id: "pending", userId: "pending-user", status: "PENDING" })
    ],
    withdrawalIntents: [
      intent({ id: "fifo", amountKrw: 120_000, updatedAt: "2026-08-05T00:00:00.000Z" }),
      intent({ id: "future", amountKrw: 500_000, updatedAt: "2026-09-05T00:00:00.000Z" }),
      intent({ id: "closed-withdrawal", userId: "closed-user", updatedAt: "2026-08-05T00:00:00.000Z" })
    ]
  };

  describe("When the prior month's amount is calculated", () => {
    it("Then it reuses next-month investment eligibility and same-month FIFO withdrawals", () => {
      const result = calculateMonthlyPayouts({ store, dividendMonth: "2026-08", totalMarketValueKrw: 1_000_000, actualDividendKrw: 10_000 });
      assert.equal(result.recipients.length, 1);
      assert.equal(result.recipients[0]?.investmentKrw, 30_000);
      assert.equal(result.investorPrincipalKrw, 30_000);
      assert.equal(result.recipients[0]?.displayedKrw, 428);
    });
  });

  describe("When actual dividends are explicitly recorded as zero", () => {
    it("Then eligible investors still receive a zero payout calculation", () => {
      const result = calculateMonthlyPayouts({ store, dividendMonth: "2026-08", totalMarketValueKrw: 1_000_000, actualDividendKrw: 0 });
      assert.equal(result.recipients.length, 1);
      assert.equal(result.recipients[0]?.allocationKrw, 0);
      assert.equal(result.recipients[0]?.managementFeeKrw, 0);
    });
  });

  describe("When there are no eligible investors", () => {
    it("Then no zero-value mail is invented for investors outside the selected dividend month", () => {
      const result = calculateMonthlyPayouts({
        store: { investmentIntents: [intent({ updatedAt: "2026-08-10T00:00:00.000Z" })], withdrawalIntents: [] },
        dividendMonth: "2026-08", totalMarketValueKrw: 1_000_000, actualDividendKrw: 0
      });
      assert.deepEqual(result.recipients, []);
      assert.equal(result.displayedTotalKrw, 0);
    });
  });

  describe("When an amount or dividend month is missing or invalid", () => {
    it("Then it fails instead of treating unavailable data as a zero dividend", () => {
      const base = { store, dividendMonth: "2026-08", totalMarketValueKrw: 1_000_000, actualDividendKrw: 10_000 };
      for (const actualDividendKrw of [NaN, Infinity, -1, undefined as unknown as number]) {
        assert.throws(() => calculateMonthlyPayouts({ ...base, actualDividendKrw }), RangeError);
      }
      assert.throws(() => calculateMonthlyPayouts({ ...base, dividendMonth: "2026-13" }), RangeError);
      assert.throws(() => calculateMonthlyPayouts({ ...base, totalMarketValueKrw: NaN }), RangeError);
    });
  });
});

describe("Given a user's allocation spans multiple investment intents", () => {
  describe("When the final amount is displayed in whole won", () => {
    it("Then it rounds once per user and records the difference without redistributing it", () => {
      const result = calculateMonthlyPayouts({
        store: {
          investmentIntents: [intent({ id: "part-1", amountKrw: 35 }), intent({ id: "part-2", amountKrw: 35 }), intent({ id: "other", userId: "user-2", amountKrw: 70 })],
          withdrawalIntents: []
        },
        dividendMonth: "2026-08", totalMarketValueKrw: 1_000, actualDividendKrw: 10
      });
      assert.equal(result.recipients.length, 2);
      assert.equal(result.recipients[0]?.displayedKrw, 1);
      assert.equal(result.recipients[0]?.investmentKrw, 70);
      assert.equal(result.displayedTotalKrw, 2);
      assert.ok(Math.abs(result.unroundedTotalKrw - 1.995) < 1e-10);
      assert.ok(Math.abs(result.roundingDifferenceKrw - 0.005) < 1e-10);
    });
  });
});

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
