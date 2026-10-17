import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { investorBalances } from "../src/domain/investor-balances.js";
import type { MonthlyInvestorPayoutRow } from "../src/domain/monthly-investor-payouts.js";
import type { AppStore, InvestmentIntent, WithdrawalIntent } from "../src/domain/types.js";

function investment(overrides: Partial<InvestmentIntent> = {}): InvestmentIntent {
  return {
    id: "investment-1", type: "INVESTMENT", userId: "user-1", userName: "투자자 1", userEmail: "one@example.com",
    amountKrw: 20_000, depositorName: "투자자 1", contact: "010-0000-0000", guardianConfirmed: false,
    dividendPolicyAgreed: true, status: "COMPLETED", createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z", ...overrides
  };
}

function withdrawal(overrides: Partial<WithdrawalIntent> = {}): WithdrawalIntent {
  return {
    id: "withdrawal-1", type: "WITHDRAWAL", userId: "user-1", userName: "투자자 1", userEmail: "one@example.com",
    amountKrw: 1_000, bankName: "은행", accountNumber: "***", accountHolder: "투자자 1", contact: "010-0000-0000",
    status: "COMPLETED", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...overrides
  };
}

function accrual(overrides: Partial<MonthlyInvestorPayoutRow> = {}): MonthlyInvestorPayoutRow {
  return {
    dividendMonth: "2026-09", userId: "user-1", payoutMode: "TOTAL_RETURN",
    eligiblePrincipalKrw: 20_000, cashPayoutKrw: 0, totalReturnAccrualKrw: 285, ...overrides
  };
}

describe("Given a total-return investor with one booked accrual", () => {
  const store: AppStore = { investmentIntents: [investment()], withdrawalIntents: [] };

  describe("When balances are summarized", () => {
    it("Then the principal, accrual, payout mode and total are shown separately", () => {
      assert.deepEqual(investorBalances(store, [accrual()], new Map([["user-1", "TOTAL_RETURN"]])), [{
        userId: "user-1", userName: "투자자 1", userEmail: "one@example.com", payoutMode: "TOTAL_RETURN",
        netPrincipalKrw: 20_000, totalReturnBalanceKrw: 285, totalBalanceKrw: 20_285
      }]);
    });
  });

  describe("When a withdrawal exceeds the investment principal", () => {
    it("Then the excess is taken from the accrual and the parts still add up", () => {
      const [balance] = investorBalances(
        { ...store, withdrawalIntents: [withdrawal({ amountKrw: 20_100 })] },
        [accrual()],
        new Map()
      );
      assert.equal(balance?.netPrincipalKrw, 0);
      assert.equal(balance?.totalReturnBalanceKrw, 185);
      assert.equal(balance?.totalBalanceKrw, 185);
      assert.equal(balance?.payoutMode, null);
    });
  });
});

describe("Given an investor who withdrew everything", () => {
  describe("When balances are summarized", () => {
    it("Then the investor is left out", () => {
      const store: AppStore = {
        investmentIntents: [investment({ amountKrw: 10_000 })],
        withdrawalIntents: [withdrawal({ amountKrw: 10_000 })]
      };
      assert.deepEqual(investorBalances(store, [], new Map()), []);
    });
  });
});
