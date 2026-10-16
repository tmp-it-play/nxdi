import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requestUser } from "../auth/session.js";
import { DEFAULT_PAYOUT_MODE, PAYOUT_MODES } from "../domain/payout-mode.js";
import { PRODUCT_MAX_INVESTMENT_KRW, PRODUCT_MIN_INVESTMENT_KRW } from "../domain/product-policy.js";
import {
  createInvestmentIntentSafely,
  createWithdrawalIntentSafely,
  withdrawNonbindingIntent
} from "../infrastructure/store.js";
import { errorFlash, redirectWithFlash, successFlash } from "../http/flash.js";

const investmentSchema = z.object({
  amountKrw: z.coerce.number().int().min(PRODUCT_MIN_INVESTMENT_KRW).max(PRODUCT_MAX_INVESTMENT_KRW),
  depositorName: z.string().trim().min(1).max(30),
  contact: z.string().trim().min(4).max(80),
  guardianConfirmed: z.coerce.boolean().default(false),
  termsAgreed: z.literal("true"),
  dividendPolicyAgreed: z.literal("true"),
  payoutMode: z.enum(PAYOUT_MODES).default(DEFAULT_PAYOUT_MODE),
  note: z.string().max(500).optional()
});

const withdrawalSchema = z.object({
  amountKrw: z.coerce.number().int().positive().max(100_000_000),
  bankName: z.string().trim().min(1).max(30),
  accountNumber: z.string().trim().min(5).max(40),
  accountHolder: z.string().trim().min(1).max(30),
  contact: z.string().trim().min(4).max(80),
  termsAgreed: z.literal("true"),
  note: z.string().max(500).optional()
});

function requireUser(request: Parameters<typeof requestUser>[0], reply: Parameters<typeof redirectWithFlash>[0]) {
  const user = requestUser(request);
  if (!user) redirectWithFlash(reply, "/intents", errorFlash("login_required"));
  return user;
}

export async function registerIntentRoutes(app: FastifyInstance) {
  app.post("/api/intents/cancel", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = z.object({
      type: z.enum(["INVESTMENT", "WITHDRAWAL"]),
      id: z.string().cuid()
    }).safeParse(request.body);
    if (!parsed.success) return redirectWithFlash(reply, "/intents", errorFlash("invalid_intent_cancel"));
    const result = await withdrawNonbindingIntent({ ...parsed.data, userId: user.id });
    if (result.status !== "withdrawn") {
      return redirectWithFlash(reply, "/intents", errorFlash("invalid_intent_cancel"));
    }
    return redirectWithFlash(reply, "/intents", successFlash("intent-withdrawn", "비구속적 의향을 철회했습니다"));
  });

  app.post("/api/intents/invest", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = investmentSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((item) => item.path[0] === "termsAgreed" || item.path[0] === "dividendPolicyAgreed");
      return redirectWithFlash(reply, "/intents", errorFlash(String(issue?.path[0] === "termsAgreed" ? "terms_required" : issue ? "dividend_policy_required" : "invalid_investment")));
    }
    const result = await createInvestmentIntentSafely({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      amountKrw: parsed.data.amountKrw,
      depositorName: parsed.data.depositorName,
      contact: parsed.data.contact,
      guardianConfirmed: parsed.data.guardianConfirmed,
      dividendPolicyAgreed: true,
      note: parsed.data.note
    }, parsed.data.payoutMode);
    if (result.status === "paused") {
      return redirectWithFlash(reply, "/intents", errorFlash("investment_intake_paused"));
    }
    return redirectWithFlash(reply, "/intents", successFlash("intent-submitted", "의향서가 제출되었습니다"));
  });

  app.post("/api/intents/withdraw", async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return reply;
    const parsed = withdrawalSchema.safeParse(request.body);
    if (!parsed.success) {
      const terms = parsed.error.issues.some((item) => item.path[0] === "termsAgreed");
      return redirectWithFlash(reply, "/intents", errorFlash(terms ? "terms_required" : "invalid_withdrawal"));
    }
    const result = await createWithdrawalIntentSafely({
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      amountKrw: parsed.data.amountKrw,
      bankName: parsed.data.bankName,
      accountNumber: parsed.data.accountNumber,
      accountHolder: parsed.data.accountHolder,
      contact: parsed.data.contact,
      note: parsed.data.note
    });
    if (result.status === "limit_exceeded") {
      return redirectWithFlash(reply, "/intents", errorFlash("withdrawal_limit"));
    }
    return redirectWithFlash(reply, "/intents", successFlash("intent-submitted", "출금 의향서가 제출되었습니다"));
  });
}
