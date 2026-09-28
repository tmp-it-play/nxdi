import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotificationRequestError, type NotificationDraftState } from "../../src/application/notification-request-policy.js";
import { TEST_RECIPIENT } from "../../src/temporary/email-tests/constants.js";
import { temporaryEmailTestDeliveryPolicy } from "../../src/temporary/email-tests/delivery-policy.js";
import { planTestDraftSend } from "../../src/temporary/email-tests/policy.js";

function event(overrides: Partial<NotificationDraftState> = {}): NotificationDraftState {
  return { id: "test-draft", mode: "TEST", status: "DRAFT", requestKey: null, parentId: null, reason: null, ...overrides };
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof NotificationRequestError && error.code === code;
}

describe("Given a temporary test preview is ready for an explicit send", () => {
  describe("When any of the three notification types is requested", () => {
    it("Then the stored content is preserved and the only recipient is the fixed test address", () => {
      for (const type of ["DISCLOSURE", "MONTHLY_PAYOUT", "QUARTERLY_HOLDINGS"]) {
        const original = { type, userId: "investor", email: "untrusted@example.com", recipientKey: "investor", html: "저장된 미리보기", facts: { cashPayoutKrw: 1_425 } };
        const result = planTestDraftSend({ event: event(), requestKey: "request-1", recipients: [original] });
        assert.equal(result.action, "ENQUEUE");
        assert.equal(result.recipients.length, 1);
        assert.equal(result.recipients[0]?.userId, null);
        assert.equal(result.recipients[0]?.email, TEST_RECIPIENT);
        assert.equal(result.recipients[0]?.recipientKey, `test:${TEST_RECIPIENT}`);
        assert.equal(result.recipients[0]?.html, original.html);
        assert.deepEqual(result.recipients[0]?.facts, original.facts);
        assert.equal(original.userId, "investor");
        assert.equal(original.email, "untrusted@example.com");
      }
    });
  });

  describe("When the stored event belongs to production mode", () => {
    it("Then the temporary test endpoint cannot send it even with a repeated key", () => {
      for (const original of [event({ mode: "PRODUCTION" }), event({ mode: "PRODUCTION", status: "READY", requestKey: "request-1" })]) {
        assert.throws(() => planTestDraftSend({ event: original, requestKey: "request-1", recipients: [{ userId: null }] }), errorCode("MODE_MISMATCH"));
      }
    });
  });

  describe("When the preview has no recipients or multiple recipients", () => {
    it("Then it refuses to create either an empty request or a test fan-out", () => {
      assert.throws(() => planTestDraftSend({ event: event(), requestKey: "request-1", recipients: [] }), errorCode("NO_RECIPIENTS"));
      assert.throws(() => planTestDraftSend({ event: event(), requestKey: "request-1", recipients: [{ userId: null }, { userId: null }] }), errorCode("INVALID_TEST_RECIPIENTS"));
    });
  });

  describe("When the same request is repeated during or after delivery", () => {
    it("Then it returns the recorded state without creating recipients or resending", () => {
      for (const status of ["READY", "COMPLETED", "NEEDS_REVIEW", "PARTIAL_FAILURE", "CANCELLED"]) {
        assert.deepEqual(planTestDraftSend({ event: event({ status, requestKey: "request-1" }), requestKey: "request-1", recipients: [{ userId: null }] }), {
          action: "ALREADY_REQUESTED", status, recipients: []
        });
      }
    });
  });

  describe("When an administrator changes the key for an already requested original", () => {
    it("Then accepted or uncertain deliveries are not sent again through the preview endpoint", () => {
      for (const status of ["COMPLETED", "NEEDS_REVIEW"]) {
        assert.throws(() => planTestDraftSend({ event: event({ status, requestKey: "old-key" }), requestKey: "new-key", recipients: [{ userId: null }] }), errorCode("ALREADY_REQUESTED"));
      }
    });
  });

  describe("When a new request has no usable idempotency key", () => {
    it("Then it rejects the request before queueing", () => {
      assert.throws(() => planTestDraftSend({ event: event(), requestKey: " ", recipients: [{ userId: null }] }), errorCode("REQUEST_KEY_REQUIRED"));
    });
  });
});

describe("Given the temporary delivery policy is explicitly installed", () => {
  describe("When a saved test has the expected fixed recipient and no investor identity", () => {
    it("Then it resolves only the configured test destination", () => {
      assert.equal(temporaryEmailTestDeliveryPolicy.mode, "TEST");
      assert.deepEqual(temporaryEmailTestDeliveryPolicy.resolveRecipient({ userId: null, recipientEmail: TEST_RECIPIENT }), { email: TEST_RECIPIENT });
    });
  });

  describe("When a queued test contains a different address or a production investor identity", () => {
    it("Then it blocks submission instead of treating malformed data as an investor mail", () => {
      for (const delivery of [
        { userId: "investor-1", recipientEmail: TEST_RECIPIENT },
        { userId: null, recipientEmail: "another@example.com" },
        { userId: null, recipientEmail: null }
      ]) {
        assert.equal(temporaryEmailTestDeliveryPolicy.resolveRecipient(delivery), null);
      }
    });
  });
});
