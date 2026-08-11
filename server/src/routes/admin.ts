import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { RecordMonthlyDividendService } from "../application/record-monthly-dividend-service.js";
import { isAdminUser } from "../auth/admin.js";
import { requestUser } from "../auth/session.js";
import {
  deleteDisclosure,
  readDisclosure,
  upsertDisclosure,
  type DisclosureTradeInput
} from "../infrastructure/disclosures.js";
import {
  deleteDividendRecord,
  deleteMonthlyDividendRecord,
  upsertDividendRecord,
  upsertMonthlyDividendRecord
} from "../infrastructure/dividends.js";
import { fetchDividendRecordFromMarket } from "../infrastructure/market-data.js";
import {
  applyManualHoldingTrade,
  deleteManualHolding,
  finalizePortfolioDailySnapshot,
  readMonthEndPortfolioMarketValueKrw,
  refreshPortfolioMarketSnapshot,
  upsertManualHolding
} from "../infrastructure/portfolio-store.js";
import {
  ROADMAP_EVENT_CATEGORIES,
  ROADMAP_EVENT_KINDS,
  createRoadmapEvent,
  deleteRoadmapEvent,
  deriveRoadmapCategory,
  deriveRoadmapKind,
  isValidDateKey,
  updateRoadmapEvent
} from "../infrastructure/roadmap.js";
import { updateIntentStatus } from "../infrastructure/store.js";
import { errorFlash, redirectWithFlash, successFlash } from "../http/flash.js";

function admin(request: FastifyRequest) {
  return isAdminUser(requestUser(request));
}

function rejectAdminForm(reply: FastifyReply) {
  return redirectWithFlash(reply, "/admin", errorFlash("admin_required"));
}

function formBody(request: FastifyRequest) {
  return request.body as Record<string, unknown> | undefined;
}

function adminError(reply: FastifyReply, code: string) {
  return redirectWithFlash(reply, "/admin", errorFlash(code));
}

function adminSuccess(reply: FastifyReply, id: string, title: string) {
  return redirectWithFlash(reply, "/admin", successFlash(id, title));
}

const holdingSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  alias: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().max(80).optional()),
  marketCountry: z.enum(["NASDAQ", "NYSE", "AMEX", "KOSPI", "KOSDAQ"]),
  currency: z.enum(["KRW", "USD"]),
  riskLevel: z.preprocess((value) => value === "" ? undefined : value, z.enum(["LOW", "HIGH"]).optional()),
  quantity: z.preprocess((value) => value === "" || value === undefined ? 0 : value, z.coerce.number().nonnegative()),
  lastPrice: z.coerce.number().positive(),
  averagePurchasePrice: z.preprocess(
    (value) => value === "" || value === undefined ? undefined : value,
    z.coerce.number().positive().optional()
  ),
  purchaseExchangeRate: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().min(500).max(3000).optional()
  )
}).superRefine((holding, context) => {
  if (holding.quantity <= 0) return;
  if (holding.averagePurchasePrice === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["averagePurchasePrice"],
      message: "required for an opening position"
    });
  }
  if (holding.currency === "USD" && holding.purchaseExchangeRate === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["purchaseExchangeRate"],
      message: "required for a USD opening position"
    });
  }
});

function normalizeHoldingSymbol(symbol: string, currency: "KRW" | "USD", market: string) {
  const normalized = symbol.trim().toUpperCase();
  if (currency === "KRW" && market === "KOSDAQ") return `${normalized.replace(/\.(KS|KQ)$/, "")}.KQ`;
  if (currency === "KRW") return normalized.replace(/\.(KS|KQ)$/, "");
  return normalized;
}

const tradeSchema = z.object({
  tradeSymbol: z.string().trim().min(1).max(20),
  side: z.enum(["BUY", "SELL", "GIFT_IN"]),
  tradeQuantity: z.coerce.number().positive(),
  orderPrice: z.coerce.number().positive(),
  exchangeRate: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().min(500).max(3000).optional()),
  feeKrw: z.coerce.number().int().nonnegative().default(0),
  taxKrw: z.coerce.number().int().nonnegative().default(0)
});

const disclosureTradeSchema = z.object({
  side: z.enum(["BUY", "SELL"]),
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  alias: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().max(80).optional()),
  marketCountry: z.enum(["NASDAQ", "NYSE", "AMEX", "KOSPI", "KOSDAQ"]),
  currency: z.enum(["KRW", "USD"]),
  quantity: z.coerce.number().positive(),
  orderPrice: z.coerce.number().positive(),
  exchangeRate: z.preprocess((value) => value === "" || value === null ? undefined : value, z.coerce.number().min(500).max(3000).optional()),
  profitRate: z.coerce.number(),
  feeKrw: z.coerce.number().int().nonnegative(),
  taxKrw: z.coerce.number().int().nonnegative(),
  orderedAt: z.string().trim().min(1)
}).superRefine((trade, context) => {
  if (trade.currency === "USD" && trade.exchangeRate === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["exchangeRate"], message: "required" });
  }
});

function prismaCode(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code);
  return undefined;
}

const recordMonthlyDividend = new RecordMonthlyDividendService({
  readReferenceMarketValueKrw: readMonthEndPortfolioMarketValueKrw,
  save: upsertMonthlyDividendRecord
});

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post("/api/admin/status", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({
      type: z.enum(["INVESTMENT", "WITHDRAWAL"]),
      id: z.string().cuid(),
      status: z.enum(["PENDING", "COMPLETED", "REJECTED"])
    }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_status");
    const result = await updateIntentStatus(parsed.data);
    if (result.status === "principal_invariant") return adminError(reply, "status_principal_invariant");
    if (result.status === "not_found") return adminError(reply, "invalid_status");
    return adminSuccess(reply, "admin-updated", "상태가 저장되었습니다");
  });

  app.post("/api/admin/portfolio/holding", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = holdingSchema.safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_holding");
    const symbol = normalizeHoldingSymbol(parsed.data.symbol, parsed.data.currency, parsed.data.marketCountry);
    const result = await upsertManualHolding({
      ...parsed.data,
      symbol,
      purchaseExchangeRate: parsed.data.currency === "USD" ? parsed.data.purchaseExchangeRate : undefined
    });
    void fetchDividendRecordFromMarket(symbol)
      .then((dividend) => dividend ? upsertDividendRecord(dividend) : undefined)
      .catch((error) => {
        request.log.warn(
          { symbol, err: error instanceof Error ? error.message : "unknown" },
          "Dividend sync failed after holding update"
        );
      });
    return adminSuccess(
      reply,
      "portfolio-updated",
      result.status === "created"
        ? "종목과 초기 보유값이 등록되었습니다"
        : "종목 메타데이터가 저장되었습니다"
    );
  });

  app.post("/api/admin/portfolio/trade", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = tradeSchema.safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_trade");
    const result = await applyManualHoldingTrade({
      symbol: parsed.data.tradeSymbol,
      side: parsed.data.side,
      quantity: parsed.data.tradeQuantity,
      orderPrice: parsed.data.orderPrice,
      exchangeRate: parsed.data.exchangeRate,
      feeKrw: parsed.data.feeKrw,
      taxKrw: parsed.data.taxKrw
    });
    const errors: Partial<Record<typeof result.status, string>> = {
      not_found: "trade_not_found",
      insufficient_quantity: "trade_insufficient",
      missing_exchange_rate: "invalid_exchange_rate",
      missing_cost_basis: "invalid_trade",
      risk_unclassified: "risk_unclassified"
    };
    const code = errors[result.status];
    if (code) return adminError(reply, code);
    return adminSuccess(
      reply,
      "portfolio-traded",
      parsed.data.side === "GIFT_IN"
        ? "증여받은 주식이 포트폴리오에 반영되었습니다"
        : "거래가 포트폴리오에 반영되었습니다"
    );
  });

  app.post("/api/admin/portfolio/delete", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({ symbol: z.string().trim().min(1).max(20) }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_delete");
    await deleteManualHolding(parsed.data.symbol);
    return adminSuccess(reply, "portfolio-deleted", "포트폴리오 종목이 삭제되었습니다");
  });

  app.post("/api/admin/dividends/record", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({
      symbol: z.string().trim().min(1).max(20),
      currency: z.enum(["KRW", "USD"]),
      annualDividendPerShare: z.coerce.number().min(0),
      trailingYield: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().min(0).optional()),
      expectedPaymentMonths: z.string().min(1).max(80),
      lastDividendPerShare: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().min(0).optional()),
      memo: z.preprocess((value) => value === "" ? undefined : value, z.string().max(500).optional())
    }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_dividend");
    const months = parsed.data.expectedPaymentMonths.split(",").map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12);
    if (!months.length) return adminError(reply, "invalid_dividend_months");
    await upsertDividendRecord({
      symbol: parsed.data.symbol.toUpperCase(),
      currency: parsed.data.currency,
      annualDividendPerShare: parsed.data.annualDividendPerShare,
      trailingYield: parsed.data.trailingYield === undefined ? undefined : parsed.data.trailingYield / 100,
      expectedPaymentMonths: months,
      lastDividendPerShare: parsed.data.lastDividendPerShare,
      memo: parsed.data.memo
    });
    return adminSuccess(reply, "dividend-updated", "배당 데이터가 저장되었습니다");
  });

  app.post("/api/admin/dividends/delete", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({ symbol: z.string().trim().min(1).max(20) }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_dividend_delete");
    await deleteDividendRecord(parsed.data.symbol);
    return adminSuccess(reply, "dividend-deleted", "배당 데이터가 삭제되었습니다");
  });

  app.post("/api/admin/dividends/sync", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({ symbol: z.string().trim().min(1).max(20) }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_dividend_sync");
    const record = await fetchDividendRecordFromMarket(parsed.data.symbol);
    if (!record) return adminError(reply, "dividend_sync_failed");
    await upsertDividendRecord(record);
    return adminSuccess(reply, "dividend-synced", "배당 데이터가 동기화되었습니다");
  });

  app.post("/api/admin/dividends/monthly/record", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({
      dividendMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      actualDividendKrw: z.coerce.number().int().nonnegative()
    }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_monthly_dividend");
    const result = await recordMonthlyDividend.execute({
      dividendMonth: parsed.data.dividendMonth,
      actualDividendKrw: parsed.data.actualDividendKrw
    });
    if (result.status === "month_end_snapshot_required") {
      return adminError(reply, "month_end_snapshot_required");
    }
    return adminSuccess(reply, "monthly-dividend-updated", "월별 실배당 합계가 저장되었습니다");
  });

  app.post("/api/admin/dividends/monthly/delete", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({ dividendMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_monthly_dividend_delete");
    await deleteMonthlyDividendRecord(parsed.data.dividendMonth);
    return adminSuccess(reply, "monthly-dividend-deleted", "월별 실배당 합계가 삭제되었습니다");
  });

  app.post("/api/admin/disclosures", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({
      id: z.preprocess((value) => value === "" ? undefined : value, z.string().trim().optional()),
      title: z.string().trim().min(1).max(160),
      body: z.string().trim().min(1).max(10_000),
      tradesJson: z.string().default("[]")
    }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_disclosure");
    let rawTrades: unknown;
    try { rawTrades = JSON.parse(parsed.data.tradesJson); } catch { return adminError(reply, "invalid_disclosure_trade"); }
    const trades = z.array(disclosureTradeSchema).max(20).safeParse(rawTrades);
    if (!trades.success) return adminError(reply, "invalid_disclosure_trade");
    const normalized: DisclosureTradeInput[] = [];
    for (const trade of trades.data) {
      const orderedAt = new Date(trade.orderedAt);
      if (Number.isNaN(orderedAt.getTime())) return adminError(reply, "invalid_disclosure_trade");
      normalized.push({
        ...trade,
        symbol: trade.symbol.toUpperCase(),
        exchangeRate: trade.currency === "USD" ? trade.exchangeRate : undefined,
        profitRate: trade.profitRate / 100,
        orderedAt
      });
    }
    await upsertDisclosure({ id: parsed.data.id, title: parsed.data.title, body: parsed.data.body, trades: normalized });
    return adminSuccess(reply, `disclosure-${parsed.data.id ? "updated" : "created"}`, parsed.data.id ? "공시가 수정되었습니다" : "공시가 등록되었습니다");
  });

  app.post("/api/admin/disclosures/delete", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({ id: z.string().trim().min(1) }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_disclosure_delete");
    await deleteDisclosure(parsed.data.id);
    return adminSuccess(reply, "disclosure-deleted", "공시가 삭제되었습니다");
  });

  app.post("/api/admin/portfolio/snapshot/finalize", async (request, reply) => {
    if (!admin(request)) return rejectAdminForm(reply);
    const parsed = z.object({ date: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()) }).safeParse(formBody(request));
    if (!parsed.success) return adminError(reply, "invalid_snapshot");
    await refreshPortfolioMarketSnapshot();
    const result = await finalizePortfolioDailySnapshot(parsed.data.date);
    if (result.status === "not_found") return adminError(reply, "snapshot_not_found");
    return adminSuccess(reply, "portfolio-updated", "포트폴리오가 저장되었습니다");
  });

  app.post("/api/admin/roadmap-events", async (request, reply) => {
    if (!admin(request)) return reply.code(403).send({ error: "관리자 권한이 필요합니다." });
    const parsed = z.object({
      disclosureId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
      eventDate: z.string().refine(isValidDateKey),
      label: z.string().trim().max(160).optional()
    }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "입력값을 확인해 주세요.", fields: parsed.error.flatten().fieldErrors });
    try {
      const disclosure = await readDisclosure(parsed.data.disclosureId);
      if (!disclosure) return reply.code(404).send({ error: "공시를 찾을 수 없습니다." });
      return reply.code(201).send({
        event: await createRoadmapEvent({
          ...parsed.data,
          kind: deriveRoadmapKind(disclosure.title, disclosure.body),
          category: deriveRoadmapCategory(disclosure.title, disclosure.body)
        })
      });
    } catch (error) {
      const code = prismaCode(error);
      if (code === "P2002") return reply.code(409).send({ error: "같은 공시가 이미 이 날짜에 등록되어 있습니다." });
      if (code === "P2003") return reply.code(404).send({ error: "공시를 찾을 수 없습니다." });
      request.log.error({ code }, "Roadmap event creation failed");
      return reply.code(500).send({ error: "핀을 추가하지 못했습니다." });
    }
  });

  app.patch("/api/admin/roadmap-events/:id", async (request, reply) => {
    if (!admin(request)) return reply.code(403).send({ error: "관리자 권한이 필요합니다." });
    const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).safeParse((request.params as { id?: unknown }).id);
    const body = z.object({
      eventDate: z.string().refine(isValidDateKey).optional(),
      kind: z.enum(ROADMAP_EVENT_KINDS).optional(),
      category: z.enum(ROADMAP_EVENT_CATEGORIES).optional(),
      label: z.string().trim().max(160).optional()
    }).strict().refine((value) => Object.keys(value).length > 0).safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ error: "입력값을 확인해 주세요." });
    try {
      return { event: await updateRoadmapEvent(id.data, body.data) };
    } catch (error) {
      const code = prismaCode(error);
      if (code === "P2002") return reply.code(409).send({ error: "같은 공시가 이미 이 날짜에 등록되어 있습니다." });
      if (code === "P2025") return reply.code(404).send({ error: "핀을 찾을 수 없습니다." });
      return reply.code(500).send({ error: "핀을 저장하지 못했습니다." });
    }
  });

  app.delete("/api/admin/roadmap-events/:id", async (request, reply) => {
    if (!admin(request)) return reply.code(403).send({ error: "관리자 권한이 필요합니다." });
    const id = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).safeParse((request.params as { id?: unknown }).id);
    if (!id.success) return reply.code(400).send({ error: "핀 ID가 올바르지 않습니다." });
    try {
      await deleteRoadmapEvent(id.data);
      return { deleted: true, id: id.data };
    } catch (error) {
      if (prismaCode(error) === "P2025") return reply.code(404).send({ error: "핀을 찾을 수 없습니다." });
      return reply.code(500).send({ error: "핀을 삭제하지 못했습니다." });
    }
  });
}
