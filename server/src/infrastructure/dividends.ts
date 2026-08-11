import { randomUUID } from "node:crypto";
import type {
  DividendForecast,
  DividendForecastLine,
  DividendRecord,
  MonthlyDividendRecord,
  PortfolioOverview
} from "../domain/types.js";
import { monthlyDividendRecordId } from "../domain/monthly-dividend-record.js";
import { portfolioCostBasisKrw } from "../domain/portfolio-math.js";
import { mapWithConcurrency } from "./concurrency.js";
import { fetchDividendRecordFromMarket } from "./market-data.js";
import { withMysqlNamedLock } from "./mysql-named-lock.js";
import { prisma } from "./prisma.js";

const DIVIDEND_RECORD_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function getNextPaymentMonth(months: number[]) {
  const currentMonth = new Date().getMonth() + 1;
  return months.find((month) => month >= currentMonth) ?? months[0];
}

function dividendPerShareKrw(record: DividendRecord, exchangeRate: number) {
  return record.currency === "USD"
    ? record.annualDividendPerShare * exchangeRate
    : record.annualDividendPerShare;
}

function lastDividendPerShareKrw(record: DividendRecord, exchangeRate: number) {
  if (typeof record.lastDividendPerShare !== "number") return undefined;
  return record.currency === "USD"
    ? record.lastDividendPerShare * exchangeRate
    : record.lastDividendPerShare;
}

function parsePaymentMonths(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((month) => Number(month)).filter((month) => month >= 1 && month <= 12);
    }
  } catch {
    return value
      .split(",")
      .map((month) => Number(month.trim()))
      .filter((month) => month >= 1 && month <= 12);
  }
  return value
    .split(",")
    .map((month) => Number(month.trim()))
    .filter((month) => month >= 1 && month <= 12);
}

function serializePaymentMonths(months: number[]) {
  return JSON.stringify([...new Set(months)].sort((a, b) => a - b));
}

function mapDividendRecord(row: {
  symbol: string;
  currency: string;
  annualDividendPerShare: number;
  trailingYield: number | null;
  expectedPaymentMonths: string;
  lastDividendPerShare: number | null;
  memo: string | null;
}): DividendRecord {
  return {
    symbol: row.symbol,
    currency: row.currency as "KRW" | "USD",
    annualDividendPerShare: row.annualDividendPerShare,
    trailingYield: row.trailingYield ?? undefined,
    expectedPaymentMonths: parsePaymentMonths(row.expectedPaymentMonths),
    lastDividendPerShare: row.lastDividendPerShare ?? undefined,
    memo: row.memo ?? undefined
  };
}

function mapMonthlyDividendRecord(row: {
  dividendMonth: string;
  recordId: string;
  actualDividendKrw: number;
  referenceMarketValueKrw: number | null;
  createdAt: Date;
  updatedAt: Date;
}): MonthlyDividendRecord {
  return {
    dividendMonth: row.dividendMonth,
    recordId: row.recordId,
    actualDividendKrw: row.actualDividendKrw,
    referenceMarketValueKrw: row.referenceMarketValueKrw ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function normalizeDividendMonth(value: string) {
  const month = value.trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
}

function dividendLookupKeys(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];

  const strippedKrSuffix = normalized.replace(/\.(KS|KQ)$/, "");
  const aliases = [normalized];
  if (strippedKrSuffix !== normalized || /^(?=.*\d)[0-9A-Z]{6}$/.test(strippedKrSuffix)) {
    aliases.push(strippedKrSuffix, `${strippedKrSuffix}.KS`, `${strippedKrSuffix}.KQ`);
  }

  return [...new Set(aliases)];
}

function dividendLockKey(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.(KS|KQ)$/, "");
}

function dividendRecordsBySymbol(records: DividendRecord[]) {
  const recordsBySymbol = new Map<string, DividendRecord>();
  for (const record of records) {
    for (const key of dividendLookupKeys(record.symbol)) {
      if (!recordsBySymbol.has(key)) recordsBySymbol.set(key, record);
    }
  }
  return recordsBySymbol;
}

function isMarketBackedDividendMemo(memo?: string | null) {
  return Boolean(memo && (memo.includes("Yahoo") || memo.includes("FMP") || memo.includes("OpenDART")));
}

export async function syncDividendRecordsForSymbols(symbols: string[]) {
  const normalizedSymbols = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (normalizedSymbols.length === 0) return;

  const staleSince = new Date(Date.now() - DIVIDEND_RECORD_STALE_MS);
  const existingRows = await prisma.dividendRecord.findMany({
    select: { symbol: true, memo: true, updatedAt: true }
  });
  const existingRowsByKey = new Map<string, { symbol: string; memo: string | null; updatedAt: Date }>();

  for (const row of existingRows) {
    for (const key of dividendLookupKeys(row.symbol)) {
      if (!existingRowsByKey.has(key)) existingRowsByKey.set(key, row);
    }
  }

  const results = await mapWithConcurrency(
    normalizedSymbols,
    3,
    async (symbol) => {
      try {
        const existingRow = dividendLookupKeys(symbol)
          .map((key) => existingRowsByKey.get(key))
          .find(Boolean);
        if (existingRow && !isMarketBackedDividendMemo(existingRow.memo)) return { symbol, status: "manual" as const };
        if (existingRow && existingRow.updatedAt >= staleSince) return { symbol, status: "fresh" as const };

        const record = await fetchDividendRecordFromMarket(symbol);
        if (!record) return { symbol, status: "not_found" as const };
        const locked = await withMysqlNamedLock(`nxdi:dividend:${dividendLockKey(symbol)}`, async () => {
          const current = await prisma.dividendRecord.findUnique({
            where: { symbol: record.symbol.toUpperCase() },
            select: { memo: true, updatedAt: true }
          });
          if (current && !isMarketBackedDividendMemo(current.memo)) return "manual" as const;
          if (current && current.updatedAt >= staleSince) return "fresh" as const;
          await writeDividendRecord(record);
          return "updated" as const;
        }, 5);
        return { symbol, status: locked.acquired ? locked.value : "error" as const };
      } catch {
        return { symbol, status: "error" as const };
      }
    }
  );
  return results;
}

export async function refreshStaleDividendRecords() {
  const staleSince = new Date(Date.now() - DIVIDEND_RECORD_STALE_MS);
  const staleRows = await prisma.dividendRecord.findMany({
    where: { updatedAt: { lt: staleSince } },
    select: { symbol: true, memo: true }
  });

  return syncDividendRecordsForSymbols(
    staleRows.filter((row) => isMarketBackedDividendMemo(row.memo)).map((row) => row.symbol)
  );
}

export async function syncScheduledDividendRecords() {
  const staleSince = new Date(Date.now() - DIVIDEND_RECORD_STALE_MS);
  const [holdings, staleRows] = await Promise.all([
    prisma.portfolioHolding.findMany({ select: { symbol: true } }),
    prisma.dividendRecord.findMany({
      where: { updatedAt: { lt: staleSince } },
      select: { symbol: true, memo: true }
    })
  ]);
  return syncDividendRecordsForSymbols([
    ...holdings.map((holding) => holding.symbol),
    ...staleRows.filter((row) => isMarketBackedDividendMemo(row.memo)).map((row) => row.symbol)
  ]);
}

export async function readDividendRecords(): Promise<DividendRecord[]> {
  const rows = await prisma.dividendRecord.findMany({ orderBy: { symbol: "asc" } });
  return rows.map(mapDividendRecord);
}

export async function upsertDividendRecord(record: DividendRecord) {
  const symbol = record.symbol.toUpperCase();
  const locked = await withMysqlNamedLock(`nxdi:dividend:${dividendLockKey(symbol)}`, () => writeDividendRecord(record), 5);
  if (!locked.acquired) throw new Error(`Could not acquire dividend lock: ${symbol}`);
}

async function writeDividendRecord(record: DividendRecord) {
  const symbol = record.symbol.toUpperCase();
  await prisma.dividendRecord.upsert({
    where: { symbol },
    create: {
      symbol,
      currency: record.currency,
      annualDividendPerShare: record.annualDividendPerShare,
      trailingYield: record.trailingYield,
      expectedPaymentMonths: serializePaymentMonths(record.expectedPaymentMonths),
      lastDividendPerShare: record.lastDividendPerShare,
      memo: record.memo
    },
    update: {
      currency: record.currency,
      annualDividendPerShare: record.annualDividendPerShare,
      trailingYield: record.trailingYield,
      expectedPaymentMonths: serializePaymentMonths(record.expectedPaymentMonths),
      lastDividendPerShare: record.lastDividendPerShare,
      memo: record.memo
    }
  });
}

export async function deleteDividendRecord(symbol: string) {
  await prisma.dividendRecord.deleteMany({
    where: { symbol: symbol.toUpperCase() }
  });
}

export async function readMonthlyDividendRecords(limit = 36): Promise<MonthlyDividendRecord[]> {
  const rows = await prisma.monthlyDividendRecord.findMany({
    orderBy: { dividendMonth: "desc" },
    take: limit
  });
  return rows.map(mapMonthlyDividendRecord);
}

export async function upsertMonthlyDividendRecord(record: {
  dividendMonth: string;
  actualDividendKrw: number;
  referenceMarketValueKrw: number;
}) {
  const dividendMonth = normalizeDividendMonth(record.dividendMonth);
  if (!dividendMonth) throw new Error("Invalid dividend month");

  const actualDividendKrw = Math.max(0, Math.round(record.actualDividendKrw));
  if (!Number.isFinite(record.referenceMarketValueKrw) || record.referenceMarketValueKrw <= 0) {
    throw new Error("Invalid reference market value");
  }
  const referenceMarketValueKrw = record.referenceMarketValueKrw;

  await prisma.monthlyDividendRecord.upsert({
    where: { dividendMonth },
    create: {
      dividendMonth,
      recordId: monthlyDividendRecordId(randomUUID()),
      actualDividendKrw,
      referenceMarketValueKrw
    },
    update: {
      actualDividendKrw,
      referenceMarketValueKrw
    }
  });
}

export async function deleteMonthlyDividendRecord(dividendMonth: string) {
  const normalizedMonth = normalizeDividendMonth(dividendMonth);
  if (!normalizedMonth) return;
  await prisma.monthlyDividendRecord.deleteMany({
    where: { dividendMonth: normalizedMonth }
  });
}

export async function getDividendRecord(symbol: string) {
  const records = await readDividendRecords();
  const recordsBySymbol = dividendRecordsBySymbol(records);
  return dividendLookupKeys(symbol)
    .map((key) => recordsBySymbol.get(key))
    .find(Boolean);
}

export async function forecastDividend(
  portfolio: PortfolioOverview,
  amountKrw: number
): Promise<DividendForecast> {
  const dividendRecords = await readDividendRecords();
  const recordsBySymbol = dividendRecordsBySymbol(dividendRecords);
  const total = portfolio.totalMarketValueKrw || 1;
  const lines: DividendForecastLine[] = portfolio.holdings.map((holding) => {
    const allocationKrw = amountKrw * (holding.marketValueKrw / total);
    const record = dividendLookupKeys(holding.symbol)
      .map((key) => recordsBySymbol.get(key))
      .find(Boolean);
    const priceKrw =
      holding.currency === "USD"
        ? holding.lastPrice * portfolio.exchangeRate
        : holding.lastPrice;

    const estimatedQuantity = priceKrw > 0 ? allocationKrw / priceKrw : 0;
    const annualDividendKrw = record
      ? estimatedQuantity * dividendPerShareKrw(record, portfolio.exchangeRate)
      : undefined;
    const lastDividendKrw = record
      ? lastDividendPerShareKrw(record, portfolio.exchangeRate)
      : undefined;

    return {
      symbol: holding.symbol,
      name: holding.name,
      alias: holding.alias,
      marketCountry: holding.marketCountry,
      currency: holding.currency,
      allocationKrw,
      estimatedQuantity,
      annualDividendKrw,
      dividendDataMissing: !record,
      lastDividendKrw:
        typeof lastDividendKrw === "number" ? estimatedQuantity * lastDividendKrw : undefined,
      monthlyAverageKrw: typeof annualDividendKrw === "number" ? annualDividendKrw / 12 : undefined,
      expectedPaymentMonths: record?.expectedPaymentMonths ?? [],
      nextPaymentMonth: record ? getNextPaymentMonth(record.expectedPaymentMonths) : undefined
    };
  });

  const dividendDataMissing = lines.some((line) => line.dividendDataMissing);
  const annualDividendKrw = dividendDataMissing
    ? undefined
    : lines.reduce((sum, line) => sum + (line.annualDividendKrw ?? 0), 0);
  return {
    amountKrw,
    annualDividendKrw,
    monthlyAverageKrw: typeof annualDividendKrw === "number" ? annualDividendKrw / 12 : undefined,
    dividendDataMissing,
    lines
  };
}

export async function summarizePortfolioDividend(portfolio: PortfolioOverview) {
  const dividendRecords = await readDividendRecords();
  const recordsBySymbol = dividendRecordsBySymbol(dividendRecords);

  let annualDividendKrw = 0;
  let dividendDataMissing = false;
  for (const holding of portfolio.holdings) {
    if (holding.quantity <= 0 || holding.marketValueKrw <= 0) continue;
    const record = dividendLookupKeys(holding.symbol)
      .map((key) => recordsBySymbol.get(key))
      .find(Boolean);
    if (!record) {
      dividendDataMissing = true;
      continue;
    }
    annualDividendKrw += holding.quantity * dividendPerShareKrw(record, portfolio.exchangeRate);
  }

  const costBasisKrw = portfolioCostBasisKrw(portfolio.holdings);
  const completeAnnualDividendKrw = dividendDataMissing ? undefined : annualDividendKrw;

  return {
    annualDividendKrw: completeAnnualDividendKrw,
    monthlyAverageKrw:
      typeof completeAnnualDividendKrw === "number" ? completeAnnualDividendKrw / 12 : undefined,
    dividendDataMissing,
    dividendYield:
      typeof completeAnnualDividendKrw === "number" && portfolio.totalMarketValueKrw > 0
        ? completeAnnualDividendKrw / portfolio.totalMarketValueKrw
        : undefined,
    costBasisKrw,
    totalReturnRate:
      typeof costBasisKrw === "number" && costBasisKrw > 0
        ? (portfolio.totalMarketValueKrw - costBasisKrw) / costBasisKrw
        : undefined
  };
}

export async function knownDividendRecords() {
  return readDividendRecords();
}
