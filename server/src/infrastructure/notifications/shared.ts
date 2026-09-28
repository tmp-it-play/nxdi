import { NotificationRequestError as NotificationError } from "../../application/notification-request-policy.js";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { NotificationStore, RenderedEmail } from "../../domain/notifications/index.js";
import { prisma } from "../prisma.js";

export type NotificationDb = Prisma.TransactionClient;
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const validEmail = (value: string | null | undefined) => value && z.string().email().max(254).safeParse(value).success && !/[\r\n]/.test(value) ? value : null;
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
export async function addDeliveries(db: NotificationDb, eventId: string, recipients: PreparedRecipient[], now: Date, draft = false) {
  if (!recipients.length) return;
  const contacts = await db.notificationRecipient.findMany({ where: { userId: { in: recipients.flatMap((r) => r.userId ? [r.userId] : []) } } });
  const byUser = new Map(contacts.map((contact) => [contact.userId, contact]));
  await db.emailDelivery.createMany({ data: recipients.map((r) => {
    const contact = r.userId ? byUser.get(r.userId) : undefined;
    const address = validEmail(r.email ?? (contact?.errorCode ? null : contact?.email));
    const recipientKey = r.recipientKey ?? r.userId ?? address;
    requireCondition(recipientKey, "RECIPIENT_KEY_REQUIRED", "발송 대상을 식별할 수 없습니다.");
    return {
      eventId, recipientKey, userId: r.userId, recipientEmail: address,
      recipientName: r.userName, ...r.rendered, payload: json(r.facts ?? {}),
      messageId: `<${randomUUID()}@kimtaeeun.site>`, status: draft ? "DRAFT" : address ? "PENDING" : "BLOCKED_ADDRESS", nextAttemptAt: now
    };
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
