import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { previousDividendMonth } from "../../domain/notifications/index.js";
import { notificationPreview } from "../../infrastructure/notifications/admin-service.js";
import { savePrepared } from "../../infrastructure/notifications/preparation.js";
import { addDeliveries, lockEvent, type PreparedRecipient } from "../../infrastructure/notifications/shared.js";
import { wakeNotifications } from "../../infrastructure/notifications/signals.js";
import { getManualPortfolioOverview } from "../../infrastructure/portfolio-store.js";
import { prisma } from "../../infrastructure/prisma.js";
import { TEST_RECIPIENT } from "./constants.js";
import { planTestDraftSend } from "./policy.js";
import { prepareTest, type TestPreviewInput } from "./preparation.js";

export async function temporaryEmailTestOptions(dividendMonth?: string) {
  const month = dividendMonth ?? previousDividendMonth(new Date());
  const [disclosures, drafts] = await Promise.all([
    prisma.disclosure.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.notificationEvent.findMany({ where: { mode: "TEST", status: "DRAFT" }, select: { id: true, type: true, subject: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 })
  ]);
  // Loading live values is an explicit administrator action; absent dividends stay absent.
  const [record, portfolio] = dividendMonth ? await Promise.all([
    prisma.monthlyDividendRecord.findUnique({ where: { dividendMonth } }), getManualPortfolioOverview().catch(() => null)
  ]) : [null, null];
  return {
    testRecipient: TEST_RECIPIENT,
    defaults: { dividendMonth: month, totalMarketValueKrw: portfolio?.totalMarketValueKrw, actualDividendKrw: record?.actualDividendKrw },
    disclosures,
    drafts: drafts.map((draft) => ({ ...draft, createdAt: draft.createdAt.toISOString() }))
  };
}

export async function createTestPreview(input: TestPreviewInput, actor: string) {
  const now = new Date();
  const prepared = await prepareTest(input, now);
  const event = await prisma.$transaction(async (db) => {
    const event = await db.notificationEvent.create({ data: {
      businessKey: `test:${randomUUID()}`, type: input.type, mode: "TEST", status: "DRAFT",
      period: input.type === "MONTHLY_PAYOUT" ? input.dividendMonth : null, requestedBy: actor, eligibleAt: now, payload: {}
    } });
    await savePrepared(db, event.id, prepared, now, true);
    return event;
  });
  return notificationPreview(event.id);
}

export async function sendTestDraft(id: string, actor: string, requestKey: string) {
  const result = await prisma.$transaction(async (db) => {
    const event = await lockEvent(db, id);
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload : {};
    const recipients = (Array.isArray(payload.draftRecipients) ? payload.draftRecipients : []) as unknown as PreparedRecipient[];
    const decision = planTestDraftSend({ event, requestKey, recipients });
    if (decision.action === "ALREADY_REQUESTED") return { status: decision.status, enqueued: false };
    await addDeliveries(db, id, decision.recipients, new Date());
    await db.notificationEvent.update({ where: { id }, data: { status: "READY", requestKey, requestedBy: actor } });
    return { status: "READY", enqueued: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  if (result.enqueued) wakeNotifications();
  return { id, status: result.status };
}
