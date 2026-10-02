import { NotificationRequestError as NotificationError } from "../../application/notification-request-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { selectNotificationAddresses } from "../../application/notification-recipient-addresses.js";
import type { NotificationStore, RenderedEmail } from "../../domain/notifications/index.js";
import { prisma } from "../prisma.js";

export type NotificationDb = Prisma.TransactionClient;
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export { NotificationError };
export function requireCondition(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new NotificationError(code, message, status);
}
export async function lockEvent(db: NotificationDb, id: string) {
  // All start/edit/delete/retry transitions acquire this row before touching deliveries.
  await db.notificationEvent.update({ where: { id }, data: { updatedAt: new Date() } });
  return db.notificationEvent.findUniqueOrThrow({ where: { id } });
}
export async function notificationStore(db: NotificationDb = prisma): Promise<NotificationStore> {
  const select = { id: true, userId: true, userName: true, amountKrw: true, status: true, updatedAt: true } as const;
  const [investmentIntents, withdrawalIntents] = await Promise.all([
    db.investmentIntent.findMany({ where: { status: "COMPLETED" }, select }),
    db.withdrawalIntent.findMany({ where: { status: "COMPLETED" }, select })
  ]);
  const map = (row: typeof investmentIntents[number]) => ({ ...row, status: "COMPLETED" as const, updatedAt: row.updatedAt.toISOString() });
  return { investmentIntents: investmentIntents.map(map), withdrawalIntents: withdrawalIntents.map(map) };
}
export type PreparedRecipient = { userId: string | null; userName: string; email?: string; recipientKey?: string; rendered: RenderedEmail; facts?: unknown };
export async function addDeliveries(db: NotificationDb, eventId: string, recipients: PreparedRecipient[], now: Date) {
  if (!recipients.length) return;
  const userIds = [...new Set(recipients.flatMap((recipient) => recipient.userId ? [recipient.userId] : []))];
  const intents = await db.investmentIntent.findMany({
    where: { userId: { in: userIds }, status: "COMPLETED" },
    select: { userId: true, userEmail: true, status: true }
  });
  const addresses = new Map(userIds.map((userId) => [userId, selectNotificationAddresses(intents, userId)]));
  await db.emailDelivery.createMany({ data: recipients.flatMap((recipient) => {
    const identity = recipient.userId ?? recipient.recipientKey;
    requireCondition(identity, "RECIPIENT_KEY_REQUIRED", "발송 대상을 식별할 수 없습니다.");
    const selection = recipient.userId ? addresses.get(recipient.userId) : undefined;
    const emails = selection?.emails ?? [];
    const targets: Array<{ email: string | null; errorCode: string | null }> = emails.map((email) => ({ email, errorCode: null }));
    if (selection?.hasInvalidEmail || !targets.length) {
      targets.push({ email: null, errorCode: selection?.hasInvalidEmail ? "INVALID_EMAIL" : "RECIPIENT_ADDRESS_REQUIRED" });
    }
    return targets.map(({ email, errorCode }) => ({
      eventId,
      recipientKey: createHash("sha256").update(identity).update("\0").update(email?.toLowerCase() ?? "invalid").digest("hex"),
      userId: recipient.userId,
      recipientEmail: email,
      recipientName: recipient.userName,
      ...recipient.rendered,
      payload: json(recipient.facts ?? {}),
      messageId: `<${randomUUID()}@kimtaeeun.site>`,
      status: email ? "PENDING" : "BLOCKED_ADDRESS",
      lastErrorCode: errorCode,
      nextAttemptAt: now
    }));
  }) });
}
export async function refreshEventStatus(db: NotificationDb, eventId: string) {
  const event = await db.notificationEvent.findUnique({ where: { id: eventId }, select: { status: true } });
  if (!event || ["CANCELLED", "DRAFT"].includes(event.status)) return;
  const rows = await db.emailDelivery.findMany({ where: { eventId }, select: { status: true } });
  if (!rows.length) return;
  const statuses = rows.map((row) => row.status);
  const status = statuses.some((s) => s === "UNKNOWN") ? "NEEDS_REVIEW"
    : statuses.some((s) => ["PENDING", "CLAIMED", "SUBMITTING", "RETRY_WAIT"].includes(s)) ? "READY"
    : statuses.every((s) => s === "ACCEPTED") ? "COMPLETED"
    : statuses.every((s) => s === "CANCELLED") ? "CANCELLED" : "PARTIAL_FAILURE";
  await db.notificationEvent.update({ where: { id: eventId }, data: { status } });
}
