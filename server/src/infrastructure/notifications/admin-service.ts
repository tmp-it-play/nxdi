import { planNotificationCorrection, planNotificationDraftSend } from "../../application/notification-request-policy.js";
import { validEmail } from "../../application/notification-recipient-addresses.js";
import { Prisma, type NotificationEvent } from "@prisma/client";
import { type NotificationType } from "../../domain/notifications/index.js";
import { getManualPortfolioOverview } from "../portfolio-store.js";
import { prisma } from "../prisma.js";
import { prepareProduction, savePrepared } from "./preparation.js";
import { addDeliveries, json, lockEvent, refreshEventStatus, requireCondition, type PreparedRecipient } from "./shared.js";

const object = (value: Prisma.JsonValue | null) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const pendingStatuses = ["FAILED", "RETRY_WAIT"];
function summary(event: NotificationEvent, statuses: string[]) {
  return { id: event.id, type: event.type, mode: event.mode, status: event.status, periodKey: event.period ?? "", version: event.revision,
    reason: event.reason, createdAt: event.createdAt.toISOString(), updatedAt: event.updatedAt.toISOString(),
    preparationError: object(event.payload).preparationError ?? (event.status === "WAITING_DATA" ? "실배당 기록 입력 또는 평가 자료를 기다리는 중입니다." : null),
    deliveryCount: statuses.length, acceptedCount: statuses.filter((s) => s === "ACCEPTED").length,
    failedCount: statuses.filter((s) => ["FAILED", "BLOCKED_ADDRESS"].includes(s)).length, unknownCount: statuses.filter((s) => s === "UNKNOWN").length };
}
function draftRecipients(event: NotificationEvent) {
  return (object(event.payload).draftRecipients ?? []) as unknown as PreparedRecipient[];
}
export async function listNotifications(query: { mode?: string; type?: string; status?: string; period?: string; page: number }) {
  const where: Prisma.NotificationEventWhereInput = { mode: query.mode, type: query.type, status: query.status, period: query.period };
  const [events, total] = await Promise.all([
    prisma.notificationEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * 20, take: 20, include: { deliveries: { select: { status: true } } } }),
    prisma.notificationEvent.count({ where })
  ]);
  return { items: events.map((e) => summary(e, e.deliveries.map((d) => d.status))), total, page: query.page, pageSize: 20 };
}

export async function notificationDetail(id: string) {
  const event = await prisma.notificationEvent.findUnique({ where: { id }, include: { deliveries: { include: { attempts: { orderBy: { number: "desc" } } }, orderBy: { createdAt: "asc" } } } });
  requireCondition(event, "NOT_FOUND", "메일 이력을 찾을 수 없습니다.", 404);
  const deliveries = event.deliveries.map((d) => ({ id: d.id, userId: d.userId, recipientName: d.recipientName, recipientEmail: d.recipientEmail,
    messageId: d.messageId as string | null, status: d.status, subject: d.subject, html: d.html, text: d.text, lastError: d.lastErrorCode, nextAttemptAt: d.nextAttemptAt.toISOString(),
    attempts: d.attempts.map((a) => ({ id: a.id, attemptNumber: a.number, status: a.status, recipientEmail: a.toEmail, errorMessage: a.errorCode, createdAt: a.startedAt.toISOString() })) }));
  if (event.status === "DRAFT") {
    for (const [i, r] of draftRecipients(event).entries()) deliveries.push({ id: `draft-${i}`, userId: r.userId, recipientName: r.userName, recipientEmail: r.email ?? null, messageId: null, status: "DRAFT", ...r.rendered, lastError: null, nextAttemptAt: event.createdAt.toISOString(), attempts: [] });
  }
  return { event: summary(event, deliveries.map((d) => d.status)), deliveries };
}
export async function notificationPreview(id: string) {
  const event = await prisma.notificationEvent.findUnique({ where: { id } });
  requireCondition(event, "NOT_FOUND", "메일 원본을 찾을 수 없습니다.", 404);
  requireCondition(event.html && event.text && event.subject, "NOT_PREPARED", "아직 본문이 준비되지 않았습니다.");
  return { id: event.id, subject: event.subject, html: event.html, text: event.text, calculation: object(event.payload).calculation ?? undefined };
}
export async function sendNotificationDraft(id: string, actor: string, requestKey: string) {
  const status = await prisma.$transaction(async (db) => {
    const reference = await db.notificationEvent.findUnique({ where: { id }, select: { parentId: true } });
    if (reference?.parentId) await lockEvent(db, reference.parentId);
    const event = await lockEvent(db, id);
    const decision = planNotificationDraftSend({ event, requestKey, recipients: draftRecipients(event) });
    if (decision.action === "ALREADY_REQUESTED") return decision.status;
    await addDeliveries(db, id, decision.recipients, new Date());
    await db.notificationEvent.update({ where: { id }, data: { status: "READY", requestKey, requestedBy: actor } });
    return "READY";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return { id, status };
}

export async function createCorrection(id: string, reason: string, actor: string) {
  const original = await prisma.notificationEvent.findUnique({ where: { id } });
  requireCondition(original, "NOT_FOUND", "원본을 찾을 수 없습니다.", 404);
  const correction = planNotificationCorrection(original, reason);
  const now = new Date();
  const portfolio = original.type === "DISCLOSURE" ? undefined : await getManualPortfolioOverview();
  const event = await prisma.$transaction(async (db) => {
    const rootId = correction.rootId;
    await lockEvent(db, rootId);
    const prior = await db.emailDelivery.findMany({
      where: { event: { OR: [{ id: rootId }, { parentId: rootId }] } },
      select: { userId: true, recipientName: true }, orderBy: { createdAt: "asc" }
    });
    const prepared = await prepareProduction(original.type as NotificationType, original.period, original.sourceId, now, correction.reason, db, portfolio,
      prior.map((r) => ({ userId: r.userId, userName: r.recipientName })));
    requireCondition(prepared, "DATA_NOT_READY", "정정에 필요한 배당 기록이 없습니다.");
    const latest = await db.notificationEvent.aggregate({ where: { OR: [{ id: rootId }, { parentId: rootId }] }, _max: { revision: true } });
    const revision = (latest._max.revision ?? 1) + 1;
    const event = await db.notificationEvent.create({ data: { businessKey: `correction:${rootId}:${revision}`, type: original.type, mode: "PRODUCTION", status: "DRAFT", period: original.period, sourceId: original.sourceId, parentId: rootId, reason: correction.reason, requestedBy: actor, revision, eligibleAt: now, payload: {} } });
    await savePrepared(db, event.id, prepared, now, true);
    return event;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  return notificationPreview(event.id);
}
export async function actOnDelivery(id: string, action: { kind: "retry"; requestKey: string } | { kind: "resolve"; requestKey: string; outcome: "ACCEPTED" | "NOT_ACCEPTED"; evidence: string }, actor: string) {
  await prisma.$transaction(async (db) => {
    const ref = await db.emailDelivery.findUnique({ where: { id }, select: { eventId: true } });
    requireCondition(ref, "NOT_FOUND", "발송 항목을 찾을 수 없습니다.", 404);
    const event = await lockEvent(db, ref.eventId);
    const delivery = await db.emailDelivery.findUniqueOrThrow({ where: { id } });
    const payload = object(delivery.payload);
    const actions = (Array.isArray(payload.actions) ? payload.actions : []) as Array<Record<string, Prisma.JsonValue>>;
    if (actions.some((previous) => previous.requestKey === action.requestKey)) return;
    requireCondition(event.status !== "CANCELLED", "CANCELLED", "취소된 메일은 다시 발송할 수 없습니다.");
    if (action.kind === "retry") {
      requireCondition(event.mode === "PRODUCTION", "RETRY_NOT_ALLOWED", "운영 메일만 재시도할 수 있습니다.");
      requireCondition(pendingStatuses.includes(delivery.status), "RETRY_NOT_ALLOWED", "저장된 수신 주소가 있는 실패 항목만 재시도할 수 있습니다.");
      requireCondition(validEmail(delivery.recipientEmail), "RETRY_NOT_ALLOWED", "수신 주소가 없는 항목은 재시도할 수 없습니다. 정정 발송을 준비해 주세요.");
      await db.emailDelivery.update({ where: { id }, data: { status: "PENDING", nextAttemptAt: new Date(), lastErrorCode: null, payload: json({ ...payload, actions: [...actions, { ...action, actor, at: new Date().toISOString() }] }) } });
    } else {
      requireCondition(delivery.status === "UNKNOWN", "RESOLUTION_NOT_ALLOWED", "결과 불명 항목만 확인 처리할 수 있습니다.");
      await db.emailDeliveryAttempt.update({ where: { deliveryId_number: { deliveryId: id, number: delivery.attemptCount } }, data: { status: action.outcome === "ACCEPTED" ? "ACCEPTED" : "NOT_ACCEPTED", resolutionNote: action.evidence, finishedAt: new Date() } });
      await db.emailDelivery.update({ where: { id }, data: { status: action.outcome === "ACCEPTED" ? "ACCEPTED" : "FAILED", acceptedAt: action.outcome === "ACCEPTED" ? new Date() : null, lastErrorCode: action.outcome === "ACCEPTED" ? null : "CONFIRMED_NOT_ACCEPTED", payload: json({ ...payload, actions: [...actions, { ...action, actor, at: new Date().toISOString() }] }) } });
    }
    await refreshEventStatus(db, event.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  return { id, ok: true };
}
