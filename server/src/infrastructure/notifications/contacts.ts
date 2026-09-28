import { Prisma } from "@prisma/client";
import type { AppUser } from "../../domain/types.js";
import { prisma } from "../prisma.js";
import { lockEvent, refreshEventStatus, validEmail } from "./shared.js";

export async function rememberNotificationRecipient(user: AppUser) {
  const email = validEmail(user.email);
  await prisma.$transaction(async (db) => {
    await db.notificationRecipient.upsert({ where: { userId: user.id }, create: {
      userId: user.id, name: user.name, email, source: "DATAGSM", confirmedAt: new Date(), errorCode: email ? null : "INVALID_EMAIL"
    }, update: { name: user.name, email, source: "DATAGSM", confirmedAt: new Date(), addressVersion: { increment: 1 }, errorCode: email ? null : "INVALID_EMAIL" } });
  });
  // The sender re-reads the contact immediately before every attempt.
  if (email) {
    const blocked = await prisma.emailDelivery.findMany({
      where: { userId: user.id, status: "BLOCKED_ADDRESS", event: { status: { notIn: ["DRAFT", "CANCELLED"] } } },
      select: { eventId: true }
    });
    for (const eventId of new Set(blocked.map((row) => row.eventId))) {
      await prisma.$transaction(async (db) => {
        const event = await lockEvent(db, eventId);
        if (["DRAFT", "CANCELLED"].includes(event.status)) return;
        // A newer login can replace this address before this recovery transaction.
        const current = await db.notificationRecipient.findUnique({ where: { userId: user.id } });
        if (current?.errorCode || !validEmail(current?.email)) return;
        const recovered = await db.emailDelivery.updateMany({
          where: { eventId, userId: user.id, status: "BLOCKED_ADDRESS" },
          data: { status: "PENDING", nextAttemptAt: new Date(), lastErrorCode: null }
        });
        if (recovered.count) await refreshEventStatus(db, eventId);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    }
  }
}
