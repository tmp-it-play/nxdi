import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { isAdminUser } from "../auth/admin.js";
import { requestUser } from "../auth/session.js";
import { NotificationError } from "../infrastructure/notifications/shared.js";

export const requestKeySchema = z.object({ requestKey: z.string().uuid() }).strict();
export const notificationId = (request: FastifyRequest) => z.object({ id: z.string().min(1).max(191) }).parse(request.params).id;
export const notificationMutationOptions = { config: { rateLimit: { max: 20, timeWindow: "1 minute", keyGenerator: (r: FastifyRequest) => requestUser(r)?.id ?? r.ip } } };

export async function registerNotificationAdminScope(app: FastifyInstance, register: (router: FastifyInstance) => Promise<void>) {
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
    await register(router);
  });
}
