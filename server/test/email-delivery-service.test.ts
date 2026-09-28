import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EmailDeliveryService,
  deliveryFailure,
  type DeliveryClaim,
  type DeliveryOutcome,
  type DeliveryRepository,
  type MailTransport,
  type Submission
} from "../src/application/email-delivery-service.js";

const instant = new Date("2026-10-01T00:00:00.000Z");

function harness() {
  let now = new Date(instant);
  let status: "PENDING" | "CLAIMED" | "SUBMITTING" | DeliveryOutcome["status"] = "PENDING";
  let attempts = 0;
  let nextAttemptAt: Date | undefined;
  let sendError: unknown;
  let permitBegin = true;
  let persistFailures = 0;
  const sends: Parameters<MailTransport["send"]>[0][] = [];
  const finishes: DeliveryOutcome[] = [];
  const begins: DeliveryClaim[] = [];
  const repository: DeliveryRepository = {
    async claim(date) {
      if (status !== "PENDING" && (status !== "RETRY_WAIT" || !nextAttemptAt || date < nextAttemptAt)) return null;
      status = "CLAIMED";
      return { id: "delivery-1", token: `claim-${attempts + 1}` };
    },
    async begin(claim) {
      begins.push(claim);
      if (!permitBegin) return null;
      status = "SUBMITTING";
      attempts += 1;
      return {
        ...claim, attemptNumber: attempts, to: "recipient@example.com", subject: "고정된 원본",
        html: "<p>저장된 원본</p>", text: "저장된 원본", messageId: "<delivery-1@example.com>"
      };
    },
    async finish(_submission, outcome) {
      finishes.push(outcome);
      if (persistFailures > 0) {
        persistFailures -= 1;
        throw new Error("database unavailable");
      }
      status = outcome.status;
      nextAttemptAt = outcome.nextAttemptAt;
    }
  };
  const sender: MailTransport = {
    async send(submission) {
      sends.push(submission);
      if (sendError) throw sendError;
      return { messageId: submission.messageId };
    }
  };
  const service = new EmailDeliveryService(repository, sender, () => new Date(now));
  return {
    service, sends, finishes, begins,
    setStatus(value: typeof status) { status = value; },
    setError(value: unknown) { sendError = value; },
    setPermitBegin(value: boolean) { permitBegin = value; },
    failPersists(count: number) { persistFailures = count; },
    advance(milliseconds: number) { now = new Date(now.getTime() + milliseconds); },
    get status() { return status; }
  };
}

describe("Given a delivery has a durable claim and stored message", () => {
  describe("When SMTP accepts the message", () => {
    it("Then it records acceptance once and cannot claim it for another send", async () => {
      const test = harness();
      assert.equal(await test.service.runOne(), true);
      assert.equal(test.sends.length, 1);
      assert.equal(test.sends[0]?.to, "recipient@example.com");
      assert.equal(test.sends[0]?.html, "<p>저장된 원본</p>");
      assert.deepEqual(test.finishes, [{ status: "ACCEPTED" }]);
      assert.equal(await test.service.runOne(), false);
      assert.equal(test.sends.length, 1);
    });
  });

  describe("When there is no claimable delivery", () => {
    it("Then it reports no work and never begins or contacts SMTP", async () => {
      const test = harness();
      test.setStatus("ACCEPTED");
      assert.equal(await test.service.runOne(), false);
      assert.equal(test.begins.length, 0);
      assert.equal(test.sends.length, 0);
      assert.equal(test.finishes.length, 0);
    });
  });

  describe("When final checks cancel or disable the claimed delivery", () => {
    it("Then a declined begin prevents SMTP submission", async () => {
      const test = harness();
      test.setPermitBegin(false);
      assert.equal(await test.service.runOne(), true);
      assert.equal(test.begins.length, 1);
      assert.equal(test.sends.length, 0);
      assert.equal(test.finishes.length, 0);
    });
  });
});

describe("Given SMTP rejects a message before acceptance", () => {
  describe("When the error is known to be temporary", () => {
    it("Then retries wait 1, 5, 30, and 120 minutes before stopping after attempt five", async () => {
      const test = harness();
      test.setError({ outcome: "retryable", code: "SMTP_TEMPORARY_REJECTION", responseCode: 451 });
      const retryMinutes = [1, 5, 30, 120];
      for (const minutes of retryMinutes) {
        assert.equal(await test.service.runOne(), true);
        assert.equal(test.status, "RETRY_WAIT");
        assert.equal(await test.service.runOne(), false);
        test.advance(minutes * 60_000 - 1);
        assert.equal(await test.service.runOne(), false);
        test.advance(1);
      }
      assert.equal(await test.service.runOne(), true);
      assert.equal(test.status, "FAILED");
      test.advance(24 * 60 * 60_000);
      assert.equal(await test.service.runOne(), false);
      assert.equal(test.sends.length, 5);
      assert.equal(test.finishes.at(-1)?.errorCode, "SMTP_TEMPORARY_REJECTION");
      assert.equal(test.finishes.at(-1)?.responseCode, 451);
      assert.equal(test.finishes.at(-1)?.nextAttemptAt, undefined);
    });
  });

  describe("When the error is permanent", () => {
    it("Then it stops immediately without scheduling another send", async () => {
      const test = harness();
      test.setError({ outcome: "permanent", code: "SMTP_REJECTED", responseCode: 550 });
      await test.service.runOne();
      assert.deepEqual(test.finishes, [{ status: "FAILED", errorCode: "SMTP_REJECTED", responseCode: 550 }]);
      test.advance(24 * 60 * 60_000);
      assert.equal(await test.service.runOne(), false);
      assert.equal(test.sends.length, 1);
    });
  });
});

describe("Given SMTP acceptance cannot be determined reliably", () => {
  describe("When a connection fails without a definitive rejection", () => {
    it("Then the message becomes UNKNOWN and is never automatically sent again", async () => {
      const test = harness();
      test.setError({ outcome: "unknown", code: "SMTP_ACCEPTANCE_UNKNOWN" });
      await test.service.runOne();
      assert.equal(test.status, "UNKNOWN");
      assert.equal(test.finishes[0]?.nextAttemptAt, undefined);
      test.advance(24 * 60 * 60_000);
      assert.equal(await test.service.runOne(), false);
      assert.equal(test.sends.length, 1);
    });
  });

  describe("When SMTP accepted the mail but the acceptance write fails", () => {
    it("Then it attempts to save UNKNOWN without contacting SMTP a second time", async () => {
      const test = harness();
      test.failPersists(1);
      await test.service.runOne();
      assert.deepEqual(test.finishes, [
        { status: "ACCEPTED" }, { status: "UNKNOWN", errorCode: "RESULT_PERSIST_FAILED" }
      ]);
      assert.equal(test.status, "UNKNOWN");
      assert.equal(await test.service.runOne(), false);
      assert.equal(test.sends.length, 1);
    });
  });

  describe("When persistence remains unavailable after successful SMTP submission", () => {
    it("Then it leaves the durable submission in place for UNKNOWN lease recovery and does not resend", async () => {
      const test = harness();
      test.failPersists(2);
      assert.equal(await test.service.runOne(), true);
      assert.equal(test.status, "SUBMITTING");
      assert.equal(test.finishes.length, 2);
      assert.equal(await test.service.runOne(), false);
      assert.equal(test.sends.length, 1);
    });
  });

  describe("When an unexpected error contains private details", () => {
    it("Then only a bounded application code is retained, with no raw provider message", () => {
      const outcome = deliveryFailure({ code: "recipient@example.com rejected secret", message: "private SMTP response" }, 1, instant);
      assert.deepEqual(outcome, { status: "UNKNOWN", errorCode: "SMTP_UNCERTAIN", responseCode: undefined });
    });
  });
});

describe("Given a durable claim cannot be transitioned to submitting", () => {
  describe("When the repository fails during begin", () => {
    it("Then it propagates the storage error before any SMTP side effect", async () => {
      let sends = 0;
      const repository: DeliveryRepository = {
        async claim() { return { id: "delivery-1", token: "claim-1" }; },
        async begin(): Promise<Submission | null> { throw new Error("database unavailable"); },
        async finish() { assert.fail("No SMTP outcome exists to persist"); }
      };
      const service = new EmailDeliveryService(repository, { async send() { sends += 1; } }, () => instant);
      await assert.rejects(() => service.runOne(), /database unavailable/);
      assert.equal(sends, 0);
    });
  });
});
