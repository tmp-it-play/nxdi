import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requestUser } from "../../auth/session.js";
import { registerNotificationAdminScope, notificationMutationOptions, notificationId, requestKeySchema } from "../../http/notification-admin.js";
import { createTestPreview, sendTestDraft, temporaryEmailTestOptions } from "./admin-service.js";

const month = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const preview = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MONTHLY_PAYOUT"), dividendMonth: month, totalMarketValueKrw: amount.positive(), investmentKrw: amount, actualDividendKrw: amount }).strict(),
  z.object({ type: z.literal("DISCLOSURE"), source: z.enum(["sample", "current"]), disclosureId: z.string().min(1).max(191).optional() }).strict(),
  z.object({ type: z.literal("QUARTERLY_HOLDINGS"), source: z.enum(["sample", "current"]) }).strict()
]);

export async function registerTemporaryEmailTestRoutes(app: FastifyInstance) {
  await registerNotificationAdminScope(app, async (router) => {
    router.get("/api/admin/notifications/tests/options", async (request) => {
      const query = z.object({ dividendMonth: month.optional() }).strict().parse(request.query);
      return temporaryEmailTestOptions(query.dividendMonth);
    });
    router.post("/api/admin/notifications/tests/preview", notificationMutationOptions, async (request) =>
      createTestPreview(preview.parse(request.body), requestUser(request)!.id));
    router.post("/api/admin/notifications/tests/:id/send", notificationMutationOptions, async (request) =>
      sendTestDraft(notificationId(request), requestUser(request)!.id, requestKeySchema.parse(request.body).requestKey));
  });
}
