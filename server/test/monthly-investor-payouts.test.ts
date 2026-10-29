import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateInvestorPayouts,
  rebuildMonthlyInvestorPayouts,
  type MonthlyInvestorPayoutRow,
  type PayoutPrincipalEntry
} from "../src/domain/monthly-investor-payouts.js";
import type { PayoutMode } from "../src/domain/payout-mode.js";

function entry(overrides: Partial<PayoutPrincipalEntry> = {}): PayoutPrincipalEntry {
  return { id: "investment-1", userId: "user-1", amountKrw: 100_000, completedAt: "2026-07-15T00:00:00.000Z", ...overrides };
}

function modes(byUser: Record<string, PayoutMode>) {
  return (userId: string) => byUser[userId] ?? "MONTHLY_CASH";
}

function row(overrides: Partial<MonthlyInvestorPayoutRow> = {}): MonthlyInvestorPayoutRow {
  return {
    dividendMonth: "2026-08", userId: "user-1", payoutMode: "MONTHLY_CASH",
    eligiblePrincipalKrw: 100_000, cashPayoutKrw: 1_475, totalReturnAccrualKrw: 0, ...overrides
  };
}

describe("Given one monthly cash investor and one total-return investor with equal balances", () => {
  const input = {
    dividendMonth: "2026-08",
    totalMarketValueKrw: 1_000_000,
    actualDividendKrw: 100_000,
    investments: [entry({ id: "cash", userId: "cash-user", amountKrw: 50_000 }), entry({ id: "tr", userId: "tr-user", amountKrw: 50_000 })],
    withdrawals: [],
    payoutModeOf: modes({ "tr-user": "TOTAL_RETURN" })
  };

  describe("When the investor share exceeds the monthly cash cap", () => {
    const { payouts } = calculateInvestorPayouts(input);
    const cash = payouts.find((payout) => payout.userId === "cash-user")!;
    const totalReturn = payouts.find((payout) => payout.userId === "tr-user")!;

    it("Then the cash investor receives the capped cash amount and only a notional reinvestment", () => {
      assert.equal(cash.payoutMode, "MONTHLY_CASH");
      assert.equal(cash.allocationKrw, 750);
      assert.equal(cash.reinvestmentKrw, 4_237.5);
      assert.equal(cash.totalReturnAccrualKrw, 0);
    });

    it("Then the total-return investor receives no cash and accrues the capped and over-cap amounts", () => {
      assert.equal(totalReturn.payoutMode, "TOTAL_RETURN");
      assert.equal(totalReturn.allocationKrw, 0);
      assert.equal(totalReturn.reinvestmentKrw, 0);
      assert.equal(totalReturn.totalReturnAccrualKrw, 4_987.5);
      assert.equal(totalReturn.managementFeeKrw, cash.managementFeeKrw);
    });
  });
});

describe("Given a total-return accrual booked for September", () => {
  const accrual = { userId: "user-1", dividendMonth: "2026-09", amountKrw: 1_000 };
  const base = {
    totalMarketValueKrw: 1_000_000,
    actualDividendKrw: 10_000,
    investments: [entry()],
    withdrawals: [],
    totalReturnAccruals: [accrual],
    payoutModeOf: modes({ "user-1": "TOTAL_RETURN" })
  };

  describe("When September itself is calculated", () => {
    it("Then the accrual is not yet part of the eligible balance", () => {
      const { investorPrincipalKrw } = calculateInvestorPayouts({ ...base, dividendMonth: "2026-09" });
      assert.equal(investorPrincipalKrw, 100_000);
    });
  });

  describe("When October is calculated", () => {
    it("Then the accrual is added to the investor's eligible balance", () => {
      const { payouts } = calculateInvestorPayouts({ ...base, dividendMonth: "2026-10" });
      assert.equal(payouts[0]?.investmentKrw, 101_000);
    });
  });

  describe("When a completed withdrawal exceeds the investment intents", () => {
    it("Then the excess is deducted from the accrual after the older investment", () => {
      const { investorPrincipalKrw } = calculateInvestorPayouts({
        ...base,
        dividendMonth: "2026-10",
        withdrawals: [entry({ id: "withdrawal-1", amountKrw: 100_500, completedAt: "2026-10-02T00:00:00.000Z" })]
      });
      assert.equal(investorPrincipalKrw, 500);
    });
  });
});

describe("Given recorded months and a payout ledger", () => {
  const records = [
    { dividendMonth: "2026-08", actualDividendKrw: 10_000, referenceMarketValueKrw: 1_000_000 },
    { dividendMonth: "2026-09", actualDividendKrw: 10_000, referenceMarketValueKrw: 1_000_000 },
    { dividendMonth: "2026-10", actualDividendKrw: 10_000, referenceMarketValueKrw: 1_000_000 }
  ];
  const base = {
    records,
    investments: [entry()],
    withdrawals: [],
    currentPayoutModeOf: modes({ "user-1": "TOTAL_RETURN" })
  };

  describe("When the ledger is rebuilt from a month booked as monthly cash", () => {
    const rows = rebuildMonthlyInvestorPayouts({ ...base, fromMonth: "2026-08", existingRows: [row()] });

    it("Then the booked month keeps its monthly cash mode", () => {
      assert.deepEqual(rows[0], row());
    });

    it("Then unbooked months apply the current total-return mode and compound the accruals", () => {
      assert.deepEqual(rows.slice(1), [
        row({ dividendMonth: "2026-09", payoutMode: "TOTAL_RETURN", cashPayoutKrw: 0, totalReturnAccrualKrw: 1_475 }),
        row({ dividendMonth: "2026-10", payoutMode: "TOTAL_RETURN", eligiblePrincipalKrw: 101_475, cashPayoutKrw: 0, totalReturnAccrualKrw: 1_497 })
      ]);
    });
  });

  describe("When the ledger is rebuilt after an earlier total-return month", () => {
    const earlier = row({ payoutMode: "TOTAL_RETURN", cashPayoutKrw: 0, totalReturnAccrualKrw: 1_425 });
    const rows = rebuildMonthlyInvestorPayouts({ ...base, fromMonth: "2026-09", existingRows: [earlier] });

    it("Then the earlier month is left out of the rebuilt rows but its accrual is compounded", () => {
      assert.deepEqual(rows.map((item) => item.dividendMonth), ["2026-09", "2026-10"]);
      assert.equal(rows[0]?.eligiblePrincipalKrw, 101_425);
    });
  });

  describe("When a month has no confirmed month-end market value", () => {
    it("Then no ledger rows are booked for that month", () => {
      const rows = rebuildMonthlyInvestorPayouts({
        ...base,
        records: [{ dividendMonth: "2026-08", actualDividendKrw: 10_000 }],
        fromMonth: "2026-08",
        existingRows: []
      });
      assert.deepEqual(rows, []);
    });
  });
});
