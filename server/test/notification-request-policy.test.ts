import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NotificationRequestError,
  planNotificationCorrection,
  planNotificationDraftSend,
  type NotificationDraftState
} from "../src/application/notification-request-policy.js";
import { TEST_RECIPIENT } from "../src/domain/notifications/index.js";

function event(overrides: Partial<NotificationDraftState> = {}): NotificationDraftState {
  return { id: "test-draft", mode: "TEST", status: "DRAFT", requestKey: null, parentId: null, reason: null, ...overrides };
}

function sendInput(overrides: Partial<Parameters<typeof planNotificationDraftSend>[0]> = {}) {
  return {
    event: event(), mode: "TEST" as const, requestKey: "request-1",
    recipients: [{ userId: "untrusted-user", email: "untrusted@example.com", subject: "저장된 미리보기", html: "<p>원본</p>", facts: { cashPayoutKrw: 1_425 } }],
    ...overrides
  };
}

function errorCode(code: string) {
  return (error: unknown) => error instanceof NotificationRequestError && error.code === code;
}

describe("Given an administrator requests a stored test preview", () => {
  describe("When any of the three notification types is queued", () => {
    it("Then it sends only to the fixed test address and preserves the reviewed content", () => {
      for (const type of ["DISCLOSURE", "MONTHLY_PAYOUT", "QUARTERLY_HOLDINGS"]) {
        const recipient = { userId: "investor-1", email: "investor@example.com", type, html: "<p>저장된 원본</p>", facts: { cashPayoutKrw: 1_425 } };
        const result = planNotificationDraftSend({ ...sendInput(), recipients: [recipient] });
        assert.equal(result.action, "ENQUEUE");
        assert.equal(result.recipients.length, 1);
        assert.equal(result.recipients[0]?.email, TEST_RECIPIENT);
        assert.equal(result.recipients[0]?.userId, null);
        assert.equal(result.recipients[0]?.html, recipient.html);
        assert.deepEqual(result.recipients[0]?.facts, recipient.facts);
        assert.equal(recipient.email, "investor@example.com");
        assert.equal(recipient.userId, "investor-1");
      }
    });
  });

  describe("When a malformed test preview contains multiple investor recipients", () => {
    it("Then it rejects the preview rather than converting a fan-out into repeated test messages", () => {
      assert.throws(() => planNotificationDraftSend(sendInput({ recipients: [
        { userId: "investor-1" }, { userId: "investor-2" }
      ] })), errorCode("INVALID_TEST_RECIPIENTS"));
    });
  });

  describe("When the request route and stored event use different modes", () => {
    it("Then neither a test nor a production route can send the other mode's preview", () => {
      assert.throws(() => planNotificationDraftSend(sendInput({ event: event({ mode: "PRODUCTION" }) })), errorCode("MODE_MISMATCH"));
      assert.throws(() => planNotificationDraftSend(sendInput({ mode: "PRODUCTION" })), errorCode("MODE_MISMATCH"));
    });
  });

  describe("When the prepared original has no recipients", () => {
    it("Then it creates no send request", () => {
      assert.throws(() => planNotificationDraftSend(sendInput({ recipients: [] })), errorCode("NO_RECIPIENTS"));
    });
  });
});

describe("Given a test request has already been recorded atomically", () => {
  describe("When the same request key is repeated during or after delivery", () => {
    it("Then it returns the current state without scheduling another message", () => {
      for (const status of ["READY", "COMPLETED", "NEEDS_REVIEW", "PARTIAL_FAILURE", "CANCELLED"]) {
        const result = planNotificationDraftSend(sendInput({ event: event({ status, requestKey: "request-1" }) }));
        assert.deepEqual(result, { action: "ALREADY_REQUESTED", status, recipients: [] });
      }
    });
  });

  describe("When an accepted request is retried with a different key", () => {
    it("Then it rejects the attempt instead of resending the original", () => {
      assert.throws(() => planNotificationDraftSend(sendInput({ event: event({ status: "COMPLETED", requestKey: "earlier-key" }) })), errorCode("ALREADY_REQUESTED"));
    });
  });

  describe("When a repeated key is presented through the wrong mode", () => {
    it("Then mode separation takes precedence over idempotency", () => {
      assert.throws(() => planNotificationDraftSend(sendInput({ event: event({ mode: "PRODUCTION", status: "COMPLETED", requestKey: "request-1" }) })), errorCode("MODE_MISMATCH"));
    });
  });

  describe("When the request key is missing or the draft already contains another request key", () => {
    it("Then it refuses to create an operation without reliable duplicate protection", () => {
      assert.throws(() => planNotificationDraftSend(sendInput({ requestKey: "   " })), errorCode("REQUEST_KEY_REQUIRED"));
      assert.throws(() => planNotificationDraftSend(sendInput({ event: event({ requestKey: "previous-request" }) })), errorCode("ALREADY_REQUESTED"));
    });
  });
});

describe("Given an administrator manually sends a production correction", () => {
  const correction = event({ id: "correction-2", mode: "PRODUCTION", parentId: "original-1", reason: "전월 실배당 합계 정정" });

  describe("When the correction is a draft with a real source and reason", () => {
    it("Then it preserves its already reviewed individual recipients", () => {
      const recipients = [{ userId: "investor-1" }, { userId: "investor-2" }];
      const result = planNotificationDraftSend(sendInput({ event: correction, mode: "PRODUCTION", recipients }));
      assert.equal(result.action, "ENQUEUE");
      assert.deepEqual(result.recipients, recipients);
    });
  });

  describe("When origin, reason, or draft state is missing", () => {
    it("Then ordinary production events and incomplete corrections cannot be sent manually", () => {
      for (const invalid of [
        { ...correction, parentId: null }, { ...correction, parentId: " " }, { ...correction, parentId: correction.id },
        { ...correction, reason: null }, { ...correction, reason: "  " }
      ]) {
        assert.throws(() => planNotificationDraftSend(sendInput({ event: invalid, mode: "PRODUCTION" })), errorCode("CORRECTION_REQUIRED"));
      }
      assert.throws(() => planNotificationDraftSend(sendInput({ event: { ...correction, status: "READY" }, mode: "PRODUCTION" })), errorCode("ALREADY_REQUESTED"));
    });
  });
});

describe("Given a new correction is requested", () => {
  const original = { id: "original-1", parentId: null, mode: "PRODUCTION", preparedAt: new Date("2026-10-01T00:00:00.000Z") };

  describe("When a prepared production original or its earlier correction is selected", () => {
    it("Then it retains the original version family and normalizes the required reason", () => {
      assert.deepEqual(planNotificationCorrection(original, "  실배당 정정  "), { rootId: "original-1", reason: "실배당 정정" });
      assert.deepEqual(planNotificationCorrection({ ...original, id: "correction-2", parentId: "original-1" }, "추가 정정"), { rootId: "original-1", reason: "추가 정정" });
    });
  });

  describe("When the source is absent, unprepared, or belongs to test mode", () => {
    it("Then it cannot be promoted into a production correction", () => {
      for (const invalid of [null, { ...original, preparedAt: null }, { ...original, mode: "TEST" }]) {
        assert.throws(() => planNotificationCorrection(invalid, "실배당 정정"), errorCode("INVALID_CORRECTION"));
      }
      assert.throws(() => planNotificationCorrection(original, " \n "), errorCode("CORRECTION_REASON_REQUIRED"));
    });
  });
});
