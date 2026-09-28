import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNotificationDraftRequest,
  NotificationRequestError,
  planNotificationCorrection,
  planNotificationDraftSend,
  type NotificationDraftState
} from "../src/application/notification-request-policy.js";

function event(overrides: Partial<NotificationDraftState> = {}): NotificationDraftState {
  return { id: "correction-2", mode: "PRODUCTION", status: "DRAFT", requestKey: null, parentId: "original-1", reason: "실배당 합계 정정", ...overrides };
}
const input = () => ({ event: event(), requestKey: "request-1", recipients: [{ userId: "investor-1", html: "<p>저장된 원본</p>" }] });
const errorCode = (code: string) => (error: unknown) => error instanceof NotificationRequestError && error.code === code;

describe("Given a reviewed production correction", () => {
  describe("When its draft is queued", () => {
    it("Then it preserves each investor and the reviewed body", () => {
      const request = input();
      const result = planNotificationDraftSend(request);
      assert.equal(result.action, "ENQUEUE");
      assert.deepEqual(result.recipients, request.recipients);
      assert.notEqual(result.recipients[0], request.recipients[0]);
    });
  });
  describe("When a recipient is missing its investor identity or there are no recipients", () => {
    it("Then it refuses to enqueue an unaddressable production correction", () => {
      assert.throws(() => planNotificationDraftSend({ ...input(), recipients: [] }), errorCode("NO_RECIPIENTS"));
      assert.throws(() => planNotificationDraftSend({ ...input(), recipients: [{ userId: null }] }), errorCode("INVALID_PRODUCTION_RECIPIENT"));
    });
  });
  describe("When origin or reason is missing", () => {
    it("Then ordinary notices and incomplete corrections cannot be sent manually", () => {
      for (const overrides of [{ parentId: null }, { parentId: " " }, { parentId: "correction-2" }, { reason: null }, { reason: " " }]) {
        assert.throws(() => planNotificationDraftSend({ ...input(), event: event(overrides) }), errorCode("CORRECTION_REQUIRED"));
      }
    });
  });
  describe("When a different mode enters the production send path", () => {
    it("Then it rejects that draft even if the request key was already used", () => {
      for (const status of ["DRAFT", "COMPLETED"]) {
        assert.throws(() => planNotificationDraftSend({ ...input(), event: event({ mode: "OTHER", status, requestKey: "request-1" }) }), errorCode("MODE_MISMATCH"));
      }
    });
  });
});

describe("Given an atomic draft request has already been recorded", () => {
  describe("When the same key is repeated", () => {
    it("Then it observes the current status without scheduling another message", () => {
      for (const status of ["READY", "COMPLETED", "NEEDS_REVIEW", "PARTIAL_FAILURE", "CANCELLED"]) {
        const result = planNotificationDraftSend({ ...input(), event: event({ status, requestKey: "request-1" }) });
        assert.deepEqual(result, { action: "ALREADY_REQUESTED", status, recipients: [] });
      }
    });
  });
  describe("When another key or a conflicting draft key is supplied", () => {
    it("Then duplicate protection prevents a new submission", () => {
      for (const status of ["COMPLETED", "READY", "DRAFT"]) {
        assert.throws(() => planNotificationDraftSend({ ...input(), event: event({ status, requestKey: "earlier" }) }), errorCode("ALREADY_REQUESTED"));
      }
      assert.throws(() => planNotificationDraftSend({ ...input(), requestKey: " " }), errorCode("REQUEST_KEY_REQUIRED"));
    });
  });
  describe("When an additional delivery mode uses the shared request guard", () => {
    it("Then it retains mode isolation and idempotency independently of production policy", () => {
      assert.equal(assertNotificationDraftRequest({ event: event({ mode: "EXTRA" }), mode: "EXTRA", requestKey: "key" }), "ENQUEUE");
      assert.equal(assertNotificationDraftRequest({ event: event({ mode: "EXTRA", status: "READY", requestKey: "key" }), mode: "EXTRA", requestKey: "key" }), "ALREADY_REQUESTED");
      assert.throws(() => assertNotificationDraftRequest({ event: event(), mode: "EXTRA", requestKey: "key" }), errorCode("MODE_MISMATCH"));
    });
  });
});

describe("Given an administrator prepares a correction", () => {
  const original = { id: "original-1", parentId: null, mode: "PRODUCTION", preparedAt: new Date("2026-10-01T00:00:00.000Z") };
  describe("When a prepared source or an earlier correction is selected", () => {
    it("Then it retains the version family and requires a normalized reason", () => {
      assert.deepEqual(planNotificationCorrection(original, "  실배당 정정  "), { rootId: "original-1", reason: "실배당 정정" });
      assert.deepEqual(planNotificationCorrection({ ...original, id: "correction-2", parentId: "original-1" }, "추가 정정"), { rootId: "original-1", reason: "추가 정정" });
    });
  });
  describe("When the source is absent, unprepared, or from another mode", () => {
    it("Then it cannot become a production correction", () => {
      for (const invalid of [null, { ...original, preparedAt: null }, { ...original, mode: "OTHER" }]) {
        assert.throws(() => planNotificationCorrection(invalid, "실배당 정정"), errorCode("INVALID_CORRECTION"));
      }
      assert.throws(() => planNotificationCorrection(original, " \n "), errorCode("CORRECTION_REASON_REQUIRED"));
    });
  });
});
