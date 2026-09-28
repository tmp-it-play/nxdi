import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requestUser } from "../auth/session.js";
import { actOnDelivery, createCorrection, listNotifications, notificationDetail, notificationPreview, sendNotificationDraft } from "../infrastructure/notifications/admin-service.js";
import { wakeNotifications } from "../infrastructure/notifications/signals.js";
import { registerNotificationAdminScope, notificationMutationOptions, notificationId, requestKeySchema } from "../http/notification-admin.js";

const type = z.enum(["DISCLOSURE", "MONTHLY_PAYOUT", "QUARTERLY_HOLDINGS"]);
// Persisted historical modes remain readable after their creating module is removed.
const mode = z.enum(["TEST", "PRODUCTION"]);

export async function registerNotificationRoutes(app: FastifyInstance) {
  await registerNotificationAdminScope(app, async (router) => {
    router.get("/api/admin/notifications", async (request) => listNotifications(z.object({
      mode: mode.optional(), type: type.optional(), status: z.enum(["DRAFT", "WAITING_DATA", "READY", "COMPLETED", "PARTIAL_FAILURE", "NEEDS_REVIEW", "NO_RECIPIENTS", "SKIPPED", "CANCELLED"]).optional(),
      period: z.string().max(16).optional(), page: z.coerce.number().int().min(1).max(100000).default(1)
    }).strict().parse(request.query)));
    router.get("/api/admin/notifications/:id", async (request) => notificationDetail(notificationId(request)));
    router.get("/api/admin/notifications/:id/preview", async (request) => notificationPreview(notificationId(request)));
    router.post("/api/admin/notifications/:id/corrections", notificationMutationOptions, async (request) => createCorrection(notificationId(request), z.object({ reason: z.string().trim().min(1).max(1000) }).strict().parse(request.body).reason, requestUser(request)!.id));
    router.post("/api/admin/notifications/:id/send", notificationMutationOptions, async (request) => {
      const result = await sendNotificationDraft(notificationId(request), requestUser(request)!.id, requestKeySchema.parse(request.body).requestKey);
      wakeNotifications(); return result;
    });
    router.post("/api/admin/email-deliveries/:id/retry", notificationMutationOptions, async (request) => {
      const result = await actOnDelivery(notificationId(request), { kind: "retry", ...requestKeySchema.parse(request.body) }, requestUser(request)!.id);
      wakeNotifications(); return result;
    });
    router.post("/api/admin/email-deliveries/:id/resolve", notificationMutationOptions, async (request) => actOnDelivery(notificationId(request), { kind: "resolve", ...z.object({ requestKey: z.string().uuid(), outcome: z.enum(["ACCEPTED", "NOT_ACCEPTED"]), evidence: z.string().trim().min(5).max(1000) }).strict().parse(request.body) }, requestUser(request)!.id));
  });
}
