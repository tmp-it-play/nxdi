import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withdrawalIntentReferenceForUser } from "../src/domain/withdrawal-limit.js";
import type { AppStore, InvestmentIntent } from "../src/domain/types.js";

function investment(overrides: Partial<InvestmentIntent> = {}): InvestmentIntent {
  return {
    id: "investment-1", type: "INVESTMENT", userId: "user-1", userName: "투자자", userEmail: "user@example.com",
    amountKrw: 100_000, depositorName: "투자자", contact: "010-0000-0000", guardianConfirmed: false,
    dividendPolicyAgreed: true, status: "COMPLETED", createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z", ...overrides
  };
}

describe("Given a completed investment and booked total-return accruals", () => {
  const store: AppStore = { investmentIntents: [investment()], withdrawalIntents: [] };

  describe("When the withdrawal reference is calculated", () => {
    it("Then the accrued amount can be requested together with the investment", () => {
      assert.equal(withdrawalIntentReferenceForUser(store, "user-1", 2_870).maxRequestIntentKrw, 102_870);
    });
  });
});
