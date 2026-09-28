import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { monthlyCorrectionRecipients, retainedCorrectionRecipients } from "../src/application/notification-correction-recipients.js";
import { NotificationRequestError } from "../src/application/notification-request-policy.js";
import type { MonthlyPayoutRecipient } from "../src/domain/notifications/index.js";

function payout(overrides: Partial<MonthlyPayoutRecipient> = {}): MonthlyPayoutRecipient {
  return {
    userId: "investor-1", userName: "투자자 1", investmentKrw: 100_000,
    allocationKrw: 1_425, displayedKrw: 1_425, managementFeeKrw: 75, reinvestmentKrw: 0,
    ...overrides
  };
}

describe("Given a disclosure or quarterly statement needs a correction", () => {
  describe("When an original recipient has since fully withdrawn", () => {
    it("Then the prior audience is retained without adding current investors who did not receive the original", () => {
      const recipients = retainedCorrectionRecipients([
        { userId: "fully-withdrawn", userName: "출금 완료 투자자" },
        { userId: "still-invested", userName: "잔액 보유 투자자" }
      ]);
      assert.deepEqual(recipients, [
        { userId: "fully-withdrawn", userName: "출금 완료 투자자" },
        { userId: "still-invested", userName: "잔액 보유 투자자" }
      ]);
    });
  });

  describe("When the same recipient appears in several previously queued versions", () => {
    it("Then the new correction contains one message per investor", () => {
      assert.deepEqual(retainedCorrectionRecipients([
        { userId: "investor-1", userName: "투자자 1" },
        { userId: "investor-1", userName: "투자자 1" },
        { userId: "investor-2", userName: "투자자 2" }
      ]), [
        { userId: "investor-1", userName: "투자자 1" }, { userId: "investor-2", userName: "투자자 2" }
      ]);
    });
  });

  describe("When the original had no recipients", () => {
    it("Then the correction does not enroll later investors", () => {
      assert.deepEqual(retainedCorrectionRecipients([]), []);
    });
  });

  describe("When a prior recipient has no stable user identity", () => {
    it("Then it blocks preparation instead of silently losing the recipient or reusing a test address", () => {
      assert.throws(() => retainedCorrectionRecipients([{ userId: null, userName: "잘못된 대상" }]),
        (error: unknown) => error instanceof NotificationRequestError && error.code === "INVALID_CORRECTION_RECIPIENT");
    });
  });
});

describe("Given monthly payout eligibility has changed since earlier mail", () => {
  describe("When a previously notified investor is absent from the recalculation", () => {
    it("Then the investor receives an explicit zero correction for principal, payout, fee, and reinvestment", () => {
      assert.deepEqual(monthlyCorrectionRecipients([{ userId: "investor-1", userName: "투자자 1" }], []), [
        { userId: "investor-1", userName: "투자자 1", investmentKrw: 0, allocationKrw: 0, displayedKrw: 0, managementFeeKrw: 0, reinvestmentKrw: 0 }
      ]);
    });
  });

  describe("When an original investor remains eligible and another becomes newly eligible", () => {
    it("Then both get the recalculated amounts while the previous now-ineligible investor remains in the audience", () => {
      const updated = payout({ displayedKrw: 800, allocationKrw: 799.7, managementFeeKrw: 42.1, investmentKrw: 56_000 });
      const added = payout({ userId: "newly-eligible", userName: "신규 적격자", investmentKrw: 100_000 });
      const recipients = monthlyCorrectionRecipients([
        { userId: "investor-1", userName: "투자자 1" }, { userId: "no-longer-eligible", userName: "비적격 전환자" }
      ], [updated, added]);
      assert.deepEqual(recipients[0], updated);
      assert.equal(recipients[1]?.userId, "no-longer-eligible");
      assert.equal(recipients[1]?.displayedKrw, 0);
      assert.deepEqual(recipients[2], added);
      assert.equal(recipients.reduce((sum, recipient) => sum + recipient.displayedKrw, 0), updated.displayedKrw + added.displayedKrw);
    });
  });

  describe("When a prior correction introduced a recipient who is now ineligible", () => {
    it("Then the full version family retains that person once with an explicit zero amount", () => {
      const recipients = monthlyCorrectionRecipients([
        { userId: "investor-1", userName: "최초 수신자" },
        { userId: "investor-1", userName: "최초 수신자" },
        { userId: "introduced-in-v2", userName: "2차 정정 수신자" }
      ], [payout()]);
      assert.equal(recipients.length, 2);
      assert.equal(recipients[1]?.userId, "introduced-in-v2");
      assert.equal(recipients[1]?.displayedKrw, 0);
    });
  });

  describe("When an eligible investor's corrected dividend is legitimately zero", () => {
    it("Then their positive eligible principal is retained rather than being marked ineligible", () => {
      const eligibleZero = payout({ allocationKrw: 0, displayedKrw: 0, managementFeeKrw: 0 });
      const recipients = monthlyCorrectionRecipients([{ userId: "investor-1", userName: "투자자 1" }], [eligibleZero]);
      assert.equal(recipients[0]?.investmentKrw, 100_000);
      assert.equal(recipients[0]?.displayedKrw, 0);
    });
  });

  describe("When a correction audience is assembled", () => {
    it("Then saved prior data and the new calculation inputs remain unchanged", () => {
      const original = Object.freeze([{ userId: "investor-1", userName: "투자자 1" }]);
      const recalculated = Object.freeze([Object.freeze(payout())]);
      const recipients = monthlyCorrectionRecipients(original, recalculated);
      recipients[0]!.displayedKrw = 0;
      assert.equal(recalculated[0]!.displayedKrw, 1_425);
      assert.deepEqual(original, [{ userId: "investor-1", userName: "투자자 1" }]);
    });
  });
});
