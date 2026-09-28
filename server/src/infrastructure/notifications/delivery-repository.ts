import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { DeliveryClaim, DeliveryOutcome, DeliveryRepository, Submission } from "../../application/email-delivery-service.js";
import { prisma } from "../prisma.js";
import { lockEvent, refreshEventStatus, validEmail } from "./shared.js";

// SMTP transport has bounded timeouts; the lease is deliberately longer than its whole submission.
const LEASE_MS = 10 * 60_000;
export type DeliveryModePolicy = {
  mode: string;
  resolveRecipient(delivery: { userId: string | null; recipientEmail: string | null }): { email: string; addressVersion?: number } | null;
};

export async function recoverExpiredDeliveries(now: Date) {
  const expired = await prisma.emailDelivery.findMany({ where: { status: { in: ["CLAIMED", "SUBMITTING"] }, claimedUntil: { lt: now } }, take: 100 });
  for (const delivery of expired) {
    await prisma.$transaction(async (db) => {
      await lockEvent(db, delivery.eventId);
      const result = await db.emailDelivery.updateMany({
        where: { id: delivery.id, status: delivery.status, claimToken: delivery.claimToken, claimedUntil: { lt: now } },
        data: { status: delivery.status === "SUBMITTING" ? "UNKNOWN" : "PENDING", claimToken: null, claimedUntil: null, lastErrorCode: "WORKER_INTERRUPTED" }
      });
      if (result.count && delivery.status === "SUBMITTING") {
        await db.emailDeliveryAttempt.updateMany({ where: { deliveryId: delivery.id, status: "SUBMITTING" }, data: { status: "UNKNOWN", errorCode: "WORKER_INTERRUPTED", finishedAt: now } });
      }
      await refreshEventStatus(db, delivery.eventId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}

export class PrismaDeliveryRepository implements DeliveryRepository {
  private readonly additionalModes: Map<string, DeliveryModePolicy>;
  constructor(policies: readonly DeliveryModePolicy[] = []) {
    this.additionalModes = new Map();
    for (const policy of policies) {
      if (policy.mode === "PRODUCTION" || this.additionalModes.has(policy.mode)) throw new Error("Delivery policies cannot replace an existing mode");
      this.additionalModes.set(policy.mode, policy);
    }
  }
  private supportedModes() { return ["PRODUCTION", ...this.additionalModes.keys()]; }

  async claim(now: Date): Promise<DeliveryClaim | null> {
    const rows = await prisma.emailDelivery.findMany({
      where: { status: { in: ["PENDING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now }, event: { mode: { in: this.supportedModes() }, status: { notIn: ["DRAFT", "CANCELLED"] } } },
      orderBy: { nextAttemptAt: "asc" }, take: 20, select: { id: true }
    });
    for (const row of rows) {
      const token = randomUUID();
      const result = await prisma.emailDelivery.updateMany({
        where: { id: row.id, status: { in: ["PENDING", "RETRY_WAIT"] }, nextAttemptAt: { lte: now } },
        data: { status: "CLAIMED", claimToken: token, claimedUntil: new Date(now.getTime() + LEASE_MS) }
      });
      if (result.count) return { id: row.id, token };
    }
    return null;
  }

  async begin(claim: DeliveryClaim, now: Date): Promise<Submission | null> {
    return prisma.$transaction(async (db) => {
      const ref = await db.emailDelivery.findUnique({ where: { id: claim.id }, select: { eventId: true } });
      if (!ref) return null;
      const event = await lockEvent(db, ref.eventId);
      const delivery = await db.emailDelivery.findUnique({ where: { id: claim.id } });
      if (!delivery || delivery.status !== "CLAIMED" || delivery.claimToken !== claim.token || !delivery.claimedUntil || delivery.claimedUntil <= now) return null;
      if (!this.supportedModes().includes(event.mode) || ["DRAFT", "CANCELLED"].includes(event.status)) {
        await db.emailDelivery.update({ where: { id: claim.id }, data: { status: event.status === "CANCELLED" ? "CANCELLED" : "PENDING", claimToken: null, claimedUntil: null } });
        return null;
      }
      const contact = event.mode === "PRODUCTION" && delivery.userId ? await db.notificationRecipient.findUnique({ where: { userId: delivery.userId } }) : null;
      const recipient = event.mode === "PRODUCTION"
        ? contact && !contact.errorCode ? { email: contact.email, addressVersion: contact.addressVersion } : null
        : this.additionalModes.get(event.mode)?.resolveRecipient(delivery);
      const to = validEmail(recipient?.email);
      if (!to) {
        await db.emailDelivery.update({ where: { id: claim.id }, data: { status: "BLOCKED_ADDRESS", lastErrorCode: "RECIPIENT_ADDRESS_REQUIRED", claimToken: null, claimedUntil: null } });
        await refreshEventStatus(db, event.id);
        return null;
      }
      const attemptNumber = delivery.attemptCount + 1;
      await db.emailDeliveryAttempt.create({ data: { deliveryId: claim.id, number: attemptNumber, toEmail: to, addressVersion: recipient?.addressVersion, status: "SUBMITTING", startedAt: now } });
      await db.emailDelivery.update({ where: { id: claim.id }, data: { status: "SUBMITTING", attemptCount: attemptNumber, recipientEmail: to, claimedUntil: new Date(now.getTime() + LEASE_MS) } });
      return { ...claim, attemptNumber, to, subject: delivery.subject, html: delivery.html, text: delivery.text, messageId: delivery.messageId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async finish(submission: Submission, outcome: DeliveryOutcome, now: Date) {
    await prisma.$transaction(async (db) => {
      const ref = await db.emailDelivery.findUniqueOrThrow({ where: { id: submission.id }, select: { eventId: true } });
      await lockEvent(db, ref.eventId);
      const result = await db.emailDelivery.updateMany({ where: { id: submission.id, claimToken: submission.token, status: "SUBMITTING" }, data: {
        status: outcome.status, lastErrorCode: outcome.errorCode ?? null, claimToken: null, claimedUntil: null,
        acceptedAt: outcome.status === "ACCEPTED" ? now : undefined, nextAttemptAt: outcome.nextAttemptAt
      } });
      if (!result.count) return; // A stale worker cannot overwrite a recovered/resolved attempt.
      await db.emailDeliveryAttempt.update({ where: { deliveryId_number: { deliveryId: submission.id, number: submission.attemptNumber } }, data: {
        status: outcome.status, errorCode: outcome.errorCode, responseCode: outcome.responseCode, response: outcome.response, finishedAt: now
      } });
      await refreshEventStatus(db, ref.eventId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
}
