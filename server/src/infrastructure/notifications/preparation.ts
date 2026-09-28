import { monthlyCorrectionRecipients, retainedCorrectionRecipients, type PriorNotificationRecipient } from "../../application/notification-correction-recipients.js";
import { productPolicyDto } from "../../domain/product-policy.js";
import { DIVIDEND_POLICY_VERSION, DIVIDEND_POLICY_SHA256 } from "../../domain/document-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { activeInvestorRecipients, calculateMonthlyPayouts, dueNotificationPeriods, kstDateKey, type NotificationType } from "../../domain/notifications/index.js";
import type { Disclosure, PortfolioOverview } from "../../domain/types.js";
import { readDisclosure } from "../disclosures.js";
import { getManualPortfolioOverview } from "../portfolio-store.js";
import { prisma } from "../prisma.js";
import { renderDisclosureEmail, renderMonthlyPayoutEmail, renderQuarterlyHoldingsEmail, TEMPLATE_VERSION } from "./templates.js";
import { addDeliveries, json, lockEvent, notificationStore, refreshEventStatus, NotificationError, requireCondition, type NotificationDb, type PreparedRecipient } from "./shared.js";

export type PreparedNotification = { recipients: PreparedRecipient[]; facts: unknown; calculation?: unknown };
const quarter = (now: Date) => `${kstDateKey(now).slice(0, 4)}-Q${Math.ceil(Number(kstDateKey(now).slice(5, 7)) / 3)}`;
const disclosureUrl = (id: string) => new URL(`/disclosures/${encodeURIComponent(id)}`, process.env.PUBLIC_APP_URL ?? "http://localhost:3000").toString();
export function checkedPortfolio(portfolio: PortfolioOverview) {
  requireCondition(Number.isFinite(portfolio.totalMarketValueKrw) && portfolio.totalMarketValueKrw >= 0
    && Number.isFinite(portfolio.exchangeRate) && portfolio.exchangeRate > 0
    && portfolio.holdings.every((holding) => [holding.quantity, holding.lastPrice, holding.marketValueKrw].every((n) => Number.isFinite(n) && n >= 0)), "INVALID_VALUATION", "평가금액을 확인한 뒤 다시 준비합니다.");
  return portfolio;
}
export async function prepareProduction(type: NotificationType, period: string | null, sourceId: string | null, now: Date, reason?: string, db: NotificationDb = prisma, portfolioInput?: PortfolioOverview, priorRecipients?: readonly PriorNotificationRecipient[]): Promise<PreparedNotification | null> {
  const store = await notificationStore(db);
  const audience = priorRecipients === undefined ? activeInvestorRecipients(store) : retainedCorrectionRecipients(priorRecipients);
  if (type === "DISCLOSURE") {
    const disclosure = sourceId ? await readDisclosure(sourceId) : null;
    requireCondition(disclosure, "DISCLOSURE_MISSING", "원본 공시가 없습니다.");
    const rendered = renderDisclosureEmail({ disclosure, disclosureUrl: disclosureUrl(disclosure.id), correctionReason: reason });
    return { facts: { disclosure }, recipients: audience.map((r) => ({ userId: r.userId, userName: r.userName, rendered, facts: r })) };
  }
  const portfolio = checkedPortfolio(portfolioInput ?? await getManualPortfolioOverview());
  if (type === "QUARTERLY_HOLDINGS") {
    const certificateNumber = `NXDI-${period}-${randomUUID().slice(0, 8)}`;
    const rendered = renderQuarterlyHoldingsEmail({ period: period ?? quarter(now), portfolio, issuedAt: now.toISOString(), certificateNumber, correctionReason: reason });
    return { facts: { portfolio, certificateNumber, issuedAt: now.toISOString() }, recipients: audience.map((r) => ({ userId: r.userId, userName: r.userName, rendered, facts: r })) };
  }
  requireCondition(period, "PERIOD_REQUIRED", "배당월이 필요합니다.");
  const record = await db.monthlyDividendRecord.findUnique({ where: { dividendMonth: period } });
  if (!record) return null;
  requireCondition(record.referenceMarketValueKrw !== null && Number.isFinite(record.referenceMarketValueKrw) && record.referenceMarketValueKrw > 0, "MONTH_END_REQUIRED", "확정된 월말 평가액을 실배당 기록에 등록해 주세요.");
  const result = calculateMonthlyPayouts({ store, dividendMonth: period, totalMarketValueKrw: portfolio.totalMarketValueKrw, actualDividendKrw: record.actualDividendKrw });
  const recipients = priorRecipients === undefined ? result.recipients : monthlyCorrectionRecipients(priorRecipients, result.recipients);
  return {
    facts: { ...result, recipients, policy: productPolicyDto(), policyVersion: DIVIDEND_POLICY_VERSION, policyHash: DIVIDEND_POLICY_SHA256, portfolio, record, store, calculatedAt: now.toISOString() },
    recipients: recipients.map((recipient) => ({ userId: recipient.userId, userName: recipient.userName, facts: recipient,
      rendered: renderMonthlyPayoutEmail({ dividendMonth: period, recipient, calculatedAt: now.toISOString(), correctionReason: reason }) }))
  };
}

export async function savePrepared(db: NotificationDb, id: string, prepared: PreparedNotification, now: Date, draft = false) {
  const first = prepared.recipients[0]?.rendered;
  if (!draft) await addDeliveries(db, id, prepared.recipients, now);
  await db.notificationEvent.update({ where: { id }, data: {
    status: prepared.recipients.length ? draft ? "DRAFT" : "READY" : "NO_RECIPIENTS", preparedAt: now,
    payload: json({ inputFingerprint: createHash("sha256").update(JSON.stringify(prepared.facts)).digest("hex"), templateVersion: TEMPLATE_VERSION, facts: prepared.facts, calculation: prepared.calculation, draftRecipients: draft ? prepared.recipients : undefined }), ...first
  } });
  if (!draft && prepared.recipients.length) await refreshEventStatus(db, id);
}

export async function prepareDueNotifications(now: Date) {
  const control = await prisma.notificationControl.upsert({ where: { id: "production" }, create: { id: "production", activatedAt: now }, update: {} });
  const due = dueNotificationPeriods(control.activatedAt ?? now, now);
  for (const entry of [ ...due.monthly.map((period) => ({ type: "MONTHLY_PAYOUT" as const, period, status: "DUE" })), ...due.quarterly.map((p) => ({ type: "QUARTERLY_HOLDINGS" as const, ...p })) ]) {
    await prisma.notificationEvent.upsert({ where: { businessKey: `${entry.type}:${entry.period}:1` }, create: {
      businessKey: `${entry.type}:${entry.period}:1`, type: entry.type, mode: "PRODUCTION", period: entry.period,
      status: entry.status === "SKIPPED" ? "SKIPPED" : "WAITING_DATA", eligibleAt: now, payload: json({ preparationError: entry.status === "SKIPPED" ? "분기 종료 전 준비되지 않아 건너뛰었습니다." : null })
    }, update: {} });
  }
  const waiting = await prisma.notificationEvent.findMany({ where: { mode: "PRODUCTION", status: "WAITING_DATA" }, orderBy: { updatedAt: "asc" }, take: 50 });
  for (const event of waiting) {
    if (event.type === "QUARTERLY_HOLDINGS" && event.period !== quarter(now)) {
      await prisma.notificationEvent.updateMany({ where: { id: event.id, status: "WAITING_DATA" }, data: { status: "SKIPPED", payload: json({ preparationError: "분기 종료 전 준비되지 않아 건너뛰었습니다." }) } });
      continue;
    }
    try {
      if (event.type === "MONTHLY_PAYOUT" && !await prisma.monthlyDividendRecord.findUnique({ where: { dividendMonth: event.period! }, select: { dividendMonth: true } })) {
        await prisma.notificationEvent.updateMany({ where: { id: event.id, status: "WAITING_DATA" }, data: { updatedAt: now, payload: json({ preparationError: "해당 월의 실배당 기록 입력을 기다리고 있습니다." }) } });
        continue;
      }
      const portfolio = checkedPortfolio(await getManualPortfolioOverview());
      await prisma.$transaction(async (db) => {
        const current = await lockEvent(db, event.id);
        if (current.status !== "WAITING_DATA") return;
        const prepared = await prepareProduction(event.type as NotificationType, event.period, event.sourceId, now, undefined, db, portfolio);
        if (prepared) await savePrepared(db, event.id, prepared, now);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
    } catch (error) {
      const preparationError = error instanceof NotificationError ? error.message : "자료 준비 실패: 배당 기록과 현재 평가 자료를 확인해 주세요.";
      const preparationErrorCode = error instanceof NotificationError ? error.code : "PREPARATION_FAILED";
      await prisma.notificationEvent.updateMany({ where: { id: event.id, status: "WAITING_DATA" }, data: { payload: json({ preparationError, preparationErrorCode }) } });
    }
  }
}

// Runs in the same transaction as the disclosure write. No SMTP or market API calls.
export async function captureDisclosure(db: NotificationDb, disclosure: Disclosure, isNew: boolean) {
  const key = `DISCLOSURE:${disclosure.id}:1`;
  let existing = await db.notificationEvent.findUnique({ where: { businessKey: key } });
  if (!existing && !isNew) return;
  const now = new Date();
  const rendered = renderDisclosureEmail({ disclosure, disclosureUrl: disclosureUrl(disclosure.id) });
  if (existing) {
    existing = await lockEvent(db, existing.id);
    const started = await db.emailDelivery.count({ where: { eventId: existing.id, attemptCount: { gt: 0 } } });
    if (started || existing.status === "CANCELLED") return;
    // Registration-time recipient IDs, eligibility facts and Message-IDs remain fixed.
    // Reset only unstarted claims, so a worker holding the old content is fenced out.
    await db.emailDelivery.updateMany({ where: { eventId: existing.id }, data: rendered });
    await db.emailDelivery.updateMany({
      where: { eventId: existing.id, status: "CLAIMED" },
      data: { status: "PENDING", claimToken: null, claimedUntil: null, nextAttemptAt: now }
    });
    const payload = existing.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload) ? existing.payload : {};
    const facts = payload.facts && typeof payload.facts === "object" && !Array.isArray(payload.facts) ? payload.facts : {};
    await db.notificationEvent.update({ where: { id: existing.id }, data: {
      ...rendered, preparedAt: now, sourceUpdatedAt: new Date(disclosure.updatedAt),
      payload: json({ ...payload, inputFingerprint: createHash("sha256").update(JSON.stringify({ ...facts, disclosure })).digest("hex"), templateVersion: TEMPLATE_VERSION, facts: { ...facts, disclosure } })
    } });
    return;
  }
  await db.notificationControl.upsert({ where: { id: "production" }, create: { id: "production", activatedAt: now }, update: {} });
  existing = await db.notificationEvent.create({ data: { businessKey: key, type: "DISCLOSURE", mode: "PRODUCTION", status: "READY", sourceId: disclosure.id, eligibleAt: now, payload: {} } });
  const recipients = activeInvestorRecipients(await notificationStore(db));
  await savePrepared(db, existing.id, { facts: { disclosure }, recipients: recipients.map((r) => ({ userId: r.userId, userName: r.userName, facts: r, rendered })) }, now);
  await db.notificationEvent.update({ where: { id: existing.id }, data: { sourceUpdatedAt: new Date(disclosure.updatedAt) } });
}

export async function cancelDisclosureNotifications(db: NotificationDb, sourceId: string) {
  const events = await db.notificationEvent.findMany({ where: { sourceId, type: "DISCLOSURE", mode: "PRODUCTION" } });
  for (const event of events) {
    await lockEvent(db, event.id);
    await db.emailDelivery.updateMany({ where: { eventId: event.id, status: { in: ["DRAFT", "PENDING", "CLAIMED", "RETRY_WAIT", "BLOCKED_ADDRESS", "FAILED"] } }, data: { status: "CANCELLED", claimToken: null, claimedUntil: null, lastErrorCode: "DISCLOSURE_DELETED" } });
    await db.notificationEvent.update({ where: { id: event.id }, data: { status: "CANCELLED" } });
  }
}
