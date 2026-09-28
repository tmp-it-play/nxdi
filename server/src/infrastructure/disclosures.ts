import { Prisma } from "@prisma/client";
import type { Disclosure, DisclosureTrade, MarketCode, TradeSide } from "../domain/types.js";
import { captureDisclosure, cancelDisclosureNotifications } from "./notifications/preparation.js";
import { wakeNotifications } from "./notifications/signals.js";
import { prisma } from "./prisma.js";

type DisclosureRow = Awaited<ReturnType<typeof prisma.disclosure.findMany>>[number] & {
  trades: Array<Awaited<ReturnType<typeof prisma.disclosureTrade.findMany>>[number]>;
};

export type DisclosureTradeInput = {
  side: TradeSide;
  symbol: string;
  name: string;
  alias?: string;
  marketCountry: MarketCode;
  currency: "KRW" | "USD";
  quantity: number;
  orderPrice: number;
  exchangeRate?: number;
  profitRate: number;
  feeKrw: number;
  taxKrw: number;
  orderedAt: Date;
};

export type DisclosureInput = {
  id?: string;
  title: string;
  body: string;
  trades: DisclosureTradeInput[];
};

function normalizeMarketCode(value: string, currency: "KRW" | "USD", symbol: string): MarketCode {
  if (value === "NASDAQ" || value === "NYSE" || value === "AMEX" || value === "KOSPI" || value === "KOSDAQ") {
    return value;
  }
  if (currency === "KRW") return symbol.toUpperCase().endsWith(".KQ") ? "KOSDAQ" : "KOSPI";
  return "NASDAQ";
}

function normalizeSide(value: string): TradeSide {
  return value === "SELL" ? "SELL" : "BUY";
}

function toDisclosureTrade(row: DisclosureRow["trades"][number]): DisclosureTrade {
  const currency = row.currency === "KRW" ? "KRW" : "USD";

  return {
    id: row.id,
    disclosureId: row.disclosureId,
    side: normalizeSide(row.side),
    symbol: row.symbol,
    name: row.name,
    alias: row.alias ?? undefined,
    marketCountry: normalizeMarketCode(row.marketCountry, currency, row.symbol),
    currency,
    quantity: row.quantity,
    orderPrice: row.orderPrice,
    exchangeRate: row.exchangeRate ?? undefined,
    profitRate: row.profitRate,
    feeKrw: row.feeKrw,
    taxKrw: row.taxKrw,
    orderedAt: row.orderedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toDisclosure(row: DisclosureRow): Disclosure {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    trades: row.trades.map((trade) => toDisclosureTrade(trade)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export async function readDisclosures(options: { take?: number } = {}) {
  const rows = await prisma.disclosure.findMany({
    include: { trades: { orderBy: { orderedAt: "desc" } } },
    orderBy: { createdAt: "desc" },
    take: options.take
  });

  return rows.map((row) => toDisclosure(row));
}

export async function readDisclosure(id: string) {
  const row = await prisma.disclosure.findUnique({
    where: { id },
    include: { trades: { orderBy: { orderedAt: "desc" } } }
  });

  return row ? toDisclosure(row) : null;
}

export async function upsertDisclosure(input: DisclosureInput) {
  const tradeData = input.trades.map((trade) => ({
    side: trade.side,
    symbol: trade.symbol.toUpperCase(),
    name: trade.name,
    alias: trade.alias?.trim() || null,
    marketCountry: trade.marketCountry,
    currency: trade.currency,
    quantity: trade.quantity,
    orderPrice: trade.orderPrice,
    exchangeRate: trade.currency === "USD" ? trade.exchangeRate : null,
    profitRate: trade.profitRate,
    feeKrw: Math.round(trade.feeKrw),
    taxKrw: Math.round(trade.taxKrw),
    orderedAt: trade.orderedAt
  }));

  const disclosure = await prisma.$transaction(async (db) => {
    const row = input.id ? await db.disclosure.update({
      where: { id: input.id },
      data: { title: input.title, body: input.body, trades: { deleteMany: {}, create: tradeData } },
      include: { trades: { orderBy: { orderedAt: "desc" } } }
    }) : await db.disclosure.create({
      data: { title: input.title, body: input.body, trades: { create: tradeData } },
      include: { trades: { orderBy: { orderedAt: "desc" } } }
    });
    const result = toDisclosure(row);
    await captureDisclosure(db, result, !input.id);
    return result;
  }, { timeout: 15_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  wakeNotifications();
  return disclosure;
}

export async function deleteDisclosure(id: string) {
  await prisma.$transaction(async (db) => {
    await cancelDisclosureNotifications(db, id);
    await db.disclosure.deleteMany({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
