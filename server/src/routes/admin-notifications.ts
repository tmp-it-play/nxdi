import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { isAdminUser } from "../auth/admin.js";
import { requestUser } from "../auth/session.js";
import { actOnDelivery, createCorrection, createTestPreview, listNotifications, notificationDetail, notificationPreview, sendNotificationDraft } from "../infrastructure/notifications/admin-service.js";
import { NotificationError } from "../infrastructure/notifications/shared.js";
import { wakeNotifications } from "../infrastructure/notifications/signals.js";

const type = z.enum(["DISCLOSURE", "MONTHLY_PAYOUT", "QUARTERLY_HOLDINGS"]);
const mode = z.enum(["TEST", "PRODUCTION"]);
const month = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const preview = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MONTHLY_PAYOUT"), dividendMonth: month, totalMarketValueKrw: amount.positive(), investmentKrw: amount, actualDividendKrw: amount }).strict(),
  z.object({ type: z.literal("DISCLOSURE"), source: z.enum(["sample", "current"]), disclosureId: z.string().min(1).max(191).optional() }).strict(),
  z.object({ type: z.literal("QUARTERLY_HOLDINGS"), source: z.enum(["sample", "current"]) }).strict()
]);
const requestKey = z.object({ requestKey: z.string().uuid() }).strict();
const id = (request: FastifyRequest) => z.object({ id: z.string().min(1).max(191) }).parse(request.params).id;

export async function registerNotificationRoutes(app: FastifyInstance) {
  await app.register(async (router) => {
    router.addHook("onRequest", async (request, reply) => {
      if (!isAdminUser(requestUser(request))) return reply.code(403).send({ error: "admin_required" });
    });
    router.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "validation_error", message: "입력 형식과 금액을 확인해 주세요." });
      if (error instanceof NotificationError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
      if (error instanceof RangeError) return reply.code(400).send({ error: "invalid_calculation", message: error.message });
      if (error && typeof error === "object" && "statusCode" in error && Number(error.statusCode) === 429) return reply.code(429).send({ error: "rate_limited", message: "잠시 후 다시 요청해 주세요." });
      if (error && typeof error === "object" && "code" in error) {
        if (error.code === "P2025") return reply.code(404).send({ error: "NOT_FOUND", message: "메일 원본을 찾을 수 없습니다." });
        if (error.code === "P2002") return reply.code(409).send({ error: "DUPLICATE_REQUEST", message: "이미 처리된 요청입니다. 저장된 이력을 확인해 주세요." });
      }
      // Prisma errors may include stored email content. Keep logs and responses free of raw errors.
      app.log.error({ code: "NOTIFICATION_OPERATION_FAILED" }, "Notification operation failed");
      return reply.code(500).send({ error: "notification_operation_failed", message: "메일 작업을 처리하지 못했습니다. 잠시 후 다시 확인해 주세요." });
    });
    const mutation = { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => requestUser(r)?.id ?? r.ip } } };
    router.get("/api/admin/notifications", async (request) => listNotifications(z.object({
      mode: mode.optional(), type: type.optional(), status: z.enum(["DRAFT", "WAITING_DATA", "READY", "COMPLETED", "PARTIAL_FAILURE", "NEEDS_REVIEW", "NO_RECIPIENTS", "SKIPPED", "CANCELLED"]).optional(),
      period: z.string().max(16).optional(), page: z.coerce.number().int().min(1).max(100000).default(1), dividendMonth: month.optional()
    }).strict().parse(request.query)));
    router.get("/api/admin/notifications/:id", async (request) => notificationDetail(id(request)));
    router.get("/api/admin/notifications/:id/preview", async (request) => notificationPreview(id(request)));
    router.post("/api/admin/notifications/tests/preview", mutation, async (request) => createTestPreview(preview.parse(request.body), requestUser(request)!.id));
    router.post("/api/admin/notifications/tests/:id/send", mutation, async (request) => {
      const result = await sendNotificationDraft(id(request), "TEST", requestUser(request)!.id, requestKey.parse(request.body).requestKey);
      wakeNotifications(); return result;
    });
    router.post("/api/admin/notifications/:id/corrections", mutation, async (request) => createCorrection(id(request), z.object({ reason: z.string().trim().min(1).max(1000) }).strict().parse(request.body).reason, requestUser(request)!.id));
    router.post("/api/admin/notifications/:id/send", mutation, async (request) => {
      const result = await sendNotificationDraft(id(request), "PRODUCTION", requestUser(request)!.id, requestKey.parse(request.body).requestKey);
      wakeNotifications(); return result;
    });
    router.post("/api/admin/email-deliveries/:id/retry", mutation, async (request) => {
      const result = await actOnDelivery(id(request), { kind: "retry", ...requestKey.parse(request.body) }, requestUser(request)!.id);
      wakeNotifications(); return result;
    });
    router.post("/api/admin/email-deliveries/:id/resolve", mutation, async (request) => actOnDelivery(id(request), { kind: "resolve", ...z.object({ requestKey: z.string().uuid(), outcome: z.enum(["ACCEPTED", "NOT_ACCEPTED"]), evidence: z.string().trim().min(5).max(1000) }).strict().parse(request.body) }, requestUser(request)!.id));
  });
}
