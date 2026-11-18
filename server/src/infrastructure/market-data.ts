import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import type { DividendRecord, MarketCode } from "../domain/types.js";
import { mapWithConcurrency } from "./concurrency.js";
import { fetchExternal } from "./external-http.js";
import { StaleWhileRevalidateCache } from "./stale-while-revalidate-cache.js";

export type SymbolSearchResult = {
  symbol: string;
  name: string;
  exchange?: string;
  currency?: "KRW" | "USD";
  marketCountry?: MarketCode;
  source: "opendart" | "fmp" | "yahoo" | "krx";
};

export type MarketQuote = SymbolSearchResult & {
  lastPrice?: number;
};

export type MarketCandle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type MarketChart = {
  symbol: string;
  currency: "KRW" | "USD";
  marketCountry: MarketCode;
  candles: MarketCandle[];
  previousClose?: number;
  regularMarketPrice?: number;
  changeRate?: number;
};

type FmpSearchRow = {
  symbol?: string;
  name?: string;
  exchangeShortName?: string;
  stockExchange?: string;
  currency?: string;
};

type FmpDividendRow = {
  date?: string;
  label?: string;
  adjDividend?: number;
  dividend?: number;
  recordDate?: string;
  paymentDate?: string;
  declarationDate?: string;
};

type YahooQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchDisp?: string;
  exchange?: string;
  quoteType?: string;
  currency?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
};

type YahooChartMeta = {
  currency?: string;
  symbol?: string;
  exchangeName?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  longName?: string;
  shortName?: string;
};

type YahooChartResult = {
  meta?: YahooChartMeta;
  timestamp?: number[];
  events?: { dividends?: Record<string, YahooDividendEvent> };
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
    }>;
  };
};

type YahooDividendEvent = {
  amount?: number;
  date?: number;
};

type OpenDartCorpCodeRow = {
  corp_code?: string;
  corp_name?: string;
  stock_code?: string;
  modify_date?: string;
};

type OpenDartAlotMatterRow = {
  corp_name?: string;
  se?: string;
  stock_knd?: string;
  thstrm?: string;
  stlm_dt?: string;
};

type OpenDartAlotMatterResponse = {
  status?: string;
  message?: string;
  list?: OpenDartAlotMatterRow[];
};

type KrxOpenApiRow = {
  ISU_CD?: string;
  ISU_SRT_CD?: string;
  ISU_NM?: string;
  ISU_ABBRV?: string;
  MKT_NM?: string;
  TDD_CLSPRC?: string;
  CLSPRC?: string;
};

type KrxOpenApiResponse = {
  OutBlock_1?: KrxOpenApiRow[];
  respCode?: string;
  respMsg?: string;
};

type KrxOpenApiSource = {
  path: string;
  exchange: string;
  marketCountry: MarketCode;
  requiresBasDd?: boolean;
};

type KrxOpenApiRowsResult = {
  rows: KrxOpenApiRow[];
  unauthorized?: boolean;
};

const DART_REPORTS = [
  { code: "11011", paymentMonth: 4, label: "사업보고서" },
  { code: "11013", paymentMonth: 5, label: "1분기보고서" },
  { code: "11012", paymentMonth: 8, label: "반기보고서" },
  { code: "11014", paymentMonth: 11, label: "3분기보고서" }
] as const;

let cachedCorpCodes: OpenDartCorpCodeRow[] | null = null;
let cachedKrxSymbols: SymbolSearchResult[] | null = null;
let cachedKrxSymbolsAt = 0;

const KRX_SYMBOL_CACHE_MS = 60 * 60 * 1000;
const KRX_OPENAPI_TIMEOUT_MS = 4000;
const KRX_DAILY_LOOKBACK_DAYS = 10;
const OPENDART_SEARCH_TIMEOUT_MS = 1500;
const CHART_CACHE_MS = 5 * 60 * 1000;
const CHART_STALE_CACHE_MS = 6 * 60 * 60 * 1000;
const chartCache = new StaleWhileRevalidateCache<MarketChart>({
  freshTtlMs: CHART_CACHE_MS,
  staleTtlMs: CHART_STALE_CACHE_MS,
  backgroundConcurrency: 3,
  onBackgroundError(error, key) {
    console.warn(`Market chart background refresh failed: ${key}`, error instanceof Error ? error.name : "unknown");
  }
});
const KRX_OPENAPI_BASE_URL = "https://data-dbg.krx.co.kr/svc/apis";
const KRX_OPENAPI_PATHS: KrxOpenApiSource[] = [
  { path: "sto/stk_isu_base_info", exchange: "KOSPI", marketCountry: "KOSPI" },
  { path: "sto/ksq_isu_base_info", exchange: "KOSDAQ", marketCountry: "KOSDAQ" },
  { path: "etp/etf_bydd_trd", exchange: "ETF", marketCountry: "KOSPI", requiresBasDd: true }
];

function fmpApiKey() {
  return process.env.FMP_API_KEY?.trim();
}

function krxOpenApiKey() {
  return process.env.KRX_OPENAPI_AUTH_KEY?.trim() ?? process.env.KRX_AUTH_KEY?.trim();
}

function openDartApiKey() {
  return process.env.OPENDART_API_KEY?.trim() ?? process.env.DART_API_KEY?.trim();
}

async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 8000,
  retries = 2
) {
  return fetchExternal(input, init, { timeoutMs, retries });
}

function inferCurrency(symbol: string, currency?: string): "KRW" | "USD" {
  if (currency === "KRW" || symbol.endsWith(".KS") || symbol.endsWith(".KQ")) return "KRW";
  return "USD";
}

function inferMarketCode(symbol: string, currency?: string, exchange?: string): MarketCode {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const normalizedExchange = (exchange ?? "").toUpperCase();

  if (inferCurrency(symbol, currency) === "KRW") {
    if (normalizedSymbol.endsWith(".KQ") || normalizedExchange.includes("KOSDAQ")) return "KOSDAQ";
    return "KOSPI";
  }

  if (normalizedExchange.includes("NYSE") || normalizedExchange.includes("NEW YORK")) return "NYSE";
  if (normalizedExchange.includes("AMEX") || normalizedExchange.includes("AMERICAN")) return "AMEX";
  return "NASDAQ";
}

function normalizeKrStockCode(symbol: string) {
  const cleaned = symbol.trim().toUpperCase().replace(/\.(KS|KQ)$/, "");
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}

function normalizeKrSecurityCode(symbol: string) {
  const cleaned = symbol.trim().toUpperCase().replace(/\.(KS|KQ)$/, "");
  return /^(?=.*\d)[0-9A-Z]{6}$/.test(cleaned) ? cleaned : null;
}

function normalizeSearchText(value: string) {
  return value.trim().toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function shouldSearchOpenDart(query: string) {
  const normalized = query.trim().toUpperCase();
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(normalized) || /^\d{1,6}(\.(KS|KQ))?$/.test(normalized);
}

function normalizeSymbolForStorage(symbol: string, currency?: string) {
  const normalizedKr = normalizeKrStockCode(symbol);
  if (normalizedKr && inferCurrency(symbol, currency) === "KRW") {
    return symbol.trim().toUpperCase().endsWith(".KQ") ? `${normalizedKr}.KQ` : normalizedKr;
  }
  return symbol.trim().toUpperCase();
}

function yahooLookupSymbols(symbol: string) {
  const trimmed = symbol.trim().toUpperCase();
  const krSecurityCode = normalizeKrSecurityCode(trimmed);
  if (!krSecurityCode) return [trimmed];
  if (trimmed.endsWith(".KQ")) return [`${krSecurityCode}.KQ`];
  if (trimmed.endsWith(".KS")) return [`${krSecurityCode}.KS`];
  return [`${krSecurityCode}.KS`, `${krSecurityCode}.KQ`];
}

function parseNumber(value?: string | number) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).replace(/[,원%\s]/g, "");
  if (!normalized || normalized === "-" || normalized === "N/A") return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function krxOpenApiUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(`${KRX_OPENAPI_BASE_URL}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url;
}

function seoulDateAtUtcMidnight() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

function formatKrxBaseDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function recentKrxBusinessDates() {
  const dates: string[] = [];
  const cursor = seoulDateAtUtcMidnight();

  while (dates.length < KRX_DAILY_LOOKBACK_DAYS) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(formatKrxBaseDate(cursor));
    }
  }

  return dates;
}

async function readOpenDartCorpCodes(timeoutMs = 8000) {
  const apiKey = openDartApiKey();
  if (!apiKey) return [];
  if (cachedCorpCodes) return cachedCorpCodes;

  const url = new URL("https://opendart.fss.or.kr/api/corpCode.xml");
  url.searchParams.set("crtfc_key", apiKey);
  const response = await fetchWithTimeout(url, { cache: "no-store" }, timeoutMs);
  if (!response.ok) return [];

  const zip = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const entry = zip.getEntry("CORPCODE.xml");
  if (!entry) return [];

  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(entry.getData().toString("utf-8")) as {
    result?: { list?: OpenDartCorpCodeRow | OpenDartCorpCodeRow[] };
  };

  cachedCorpCodes = toArray(parsed.result?.list).filter((row) => row.stock_code);
  return cachedCorpCodes;
}

async function searchOpenDartSymbols(query: string, timeoutMs = 8000): Promise<SymbolSearchResult[]> {
  const normalized = query.trim().toUpperCase().replace(/\.(KS|KQ)$/, "");
  const explicitMarketCountry: MarketCode | undefined =
    query.trim().toUpperCase().endsWith(".KQ")
      ? "KOSDAQ"
      : query.trim().toUpperCase().endsWith(".KS")
        ? "KOSPI"
        : undefined;
  if (!openDartApiKey() || !normalized) return [];
  if (!cachedCorpCodes && timeoutMs < 8000) return [];

  const rows = await readOpenDartCorpCodes(timeoutMs);
  return rows
    .filter((row) => {
      const stockCode = String(row.stock_code ?? "").padStart(6, "0");
      const corpName = String(row.corp_name ?? "");
      return stockCode.includes(normalized) || corpName.toUpperCase().includes(normalized);
    })
    .slice(0, 15)
    .map((row) => ({
      symbol: String(row.stock_code ?? "").padStart(6, "0"),
      name: String(row.corp_name ?? row.stock_code ?? ""),
      exchange: "KRX",
      currency: "KRW" as const,
      marketCountry: explicitMarketCountry ?? "KOSPI",
      source: "opendart" as const
    }));
}

async function fetchKrxOpenApiRows(path: string, params: Record<string, string> = {}): Promise<KrxOpenApiRowsResult> {
  const authKey = krxOpenApiKey();
  if (!authKey) return { rows: [] };

  const response = await fetchWithTimeout(krxOpenApiUrl(path, params), {
    cache: "no-store",
    headers: { AUTH_KEY: authKey }
  }, KRX_OPENAPI_TIMEOUT_MS);
  if (!response.ok) {
    if (response.status === 401) {
      console.warn(`KRX OpenAPI unauthorized: ${path}`);
      return { rows: [], unauthorized: true };
    }
    return { rows: [] };
  }

  const json = (await response.json()) as KrxOpenApiResponse;
  if (json.respCode && json.respCode !== "0000") {
    console.warn(`KRX OpenAPI failed: ${json.respCode} ${json.respMsg ?? ""}`.trim());
    return { rows: [], unauthorized: json.respCode === "401" };
  }

  return { rows: json.OutBlock_1 ?? [] };
}

async function readKrxOpenApiRows(source: KrxOpenApiSource) {
  if (!source.requiresBasDd) {
    return (await fetchKrxOpenApiRows(source.path)).rows;
  }

  for (const basDd of recentKrxBusinessDates()) {
    const result = await fetchKrxOpenApiRows(source.path, { basDd });
    if (result.unauthorized) return [];
    if (result.rows.length > 0) return result.rows;
  }

  return [];
}

async function readKrxSymbols() {
  if (!krxOpenApiKey()) return [];

  const now = Date.now();
  if (cachedKrxSymbols && now - cachedKrxSymbolsAt < KRX_SYMBOL_CACHE_MS) {
    return cachedKrxSymbols;
  }

  const groups = await Promise.all(
    KRX_OPENAPI_PATHS.map(async (source) => {
      try {
        const rows = await readKrxOpenApiRows(source);
        return rows
          .map((row): SymbolSearchResult | null => {
            const symbol = normalizeKrStockCode(row.ISU_SRT_CD ?? row.ISU_CD ?? "");
            const name = row.ISU_NM ?? row.ISU_ABBRV ?? "";
            if (!symbol || !name) return null;

            return {
              symbol,
              name,
              exchange: row.MKT_NM ?? source.exchange,
              currency: "KRW" as const,
              marketCountry: source.marketCountry,
              source: "krx" as const
            };
          })
          .filter((row): row is SymbolSearchResult => Boolean(row));
      } catch (error) {
        console.warn(`KRX OpenAPI request failed: ${source.path}`, error instanceof Error ? error.name : "unknown");
        return [];
      }
    })
  );

  cachedKrxSymbols = mergeSearchResults([], groups.flat());
  cachedKrxSymbolsAt = now;
  return cachedKrxSymbols;
}

async function searchKrxSymbols(query: string): Promise<SymbolSearchResult[]> {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];

  const terms = query
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .map(normalizeSearchText)
    .filter(Boolean);
  const rows = await readKrxSymbols();

  return rows
    .filter((row) => {
      const searchable = normalizeSearchText([row.symbol, row.name, row.exchange].filter(Boolean).join(" "));
      return (
        searchable.includes(normalized) ||
        normalized.includes(normalizeSearchText(row.symbol)) ||
        terms.every((term) => searchable.includes(term))
      );
    })
    .slice(0, 15);
}

export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  let krxResults: SymbolSearchResult[] = [];
  try {
    krxResults = await searchKrxSymbols(trimmed);
  } catch (error) {
    console.warn(`KRX search failed: ${trimmed}`, error instanceof Error ? error.name : "unknown");
  }
  if (krxResults.length > 0) return krxResults;

  let openDartResults: SymbolSearchResult[] = [];
  if (shouldSearchOpenDart(trimmed)) {
    try {
      openDartResults = await searchOpenDartSymbols(trimmed, OPENDART_SEARCH_TIMEOUT_MS);
    } catch (error) {
      console.warn(`OpenDART search failed: ${trimmed}`, error instanceof Error ? error.name : "unknown");
    }
  }
  const primaryResults = mergeSearchResults(krxResults, openDartResults);
  if (primaryResults.length >= 15) return primaryResults;

  if (fmpApiKey()) {
    const url = new URL("https://financialmodelingprep.com/stable/search-symbol");
    url.searchParams.set("query", trimmed);
    url.searchParams.set("apikey", fmpApiKey() ?? "");
    const response = await fetchWithTimeout(url, { cache: "no-store" });
    if (response.ok) {
      const rows = (await response.json()) as FmpSearchRow[];
      const fmpResults = rows.slice(0, 15).map((row) => ({
        symbol: row.symbol ?? "",
        name: row.name ?? row.symbol ?? "",
        exchange: row.exchangeShortName ?? row.stockExchange,
        currency: inferCurrency(row.symbol ?? "", row.currency),
        marketCountry: inferMarketCode(row.symbol ?? "", row.currency, row.exchangeShortName ?? row.stockExchange),
        source: "fmp" as const
      }));
      const mergedResults = mergeSearchResults(primaryResults, fmpResults);
      if (mergedResults.length > 0) return mergedResults;
    }
  }

  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("quotesCount", "15");
  url.searchParams.set("newsCount", "0");
  const response = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store"
  });

  if (!response.ok) return primaryResults;

  const json = (await response.json()) as { quotes?: YahooQuote[] };
  const yahooResults = (json.quotes ?? [])
    .filter((quote) => quote.symbol)
    .slice(0, 15)
    .map((quote) => ({
      symbol: quote.symbol ?? "",
      name: quote.longname ?? quote.shortname ?? quote.symbol ?? "",
      exchange: quote.exchDisp ?? quote.exchange,
      currency: inferCurrency(quote.symbol ?? ""),
      marketCountry: inferMarketCode(quote.symbol ?? "", quote.currency, quote.exchDisp ?? quote.exchange),
      source: "yahoo" as const
    }));
  return mergeSearchResults(primaryResults, yahooResults);
}

export async function fetchMarketQuote(symbol: string): Promise<MarketQuote | null> {
  const trimmed = symbol.trim();
  if (!trimmed) return null;

  for (const yahooSymbol of yahooLookupSymbols(trimmed)) {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
    url.searchParams.set("range", "1d");
    url.searchParams.set("interval", "1d");
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store"
    });

    if (!response.ok) continue;

    const json = (await response.json()) as { chart?: { result?: Array<{ meta?: YahooChartMeta }> } };
    const quote = json.chart?.result?.[0]?.meta;
    if (!quote?.symbol) continue;

    const currency = inferCurrency(quote.symbol, quote.currency);
    return {
      symbol: normalizeSymbolForStorage(quote.symbol, quote.currency),
      name: quote.longName ?? quote.shortName ?? quote.symbol,
      exchange: quote.fullExchangeName ?? quote.exchangeName,
      currency,
      marketCountry: inferMarketCode(quote.symbol, quote.currency, quote.fullExchangeName ?? quote.exchangeName),
      lastPrice: quote.regularMarketPrice ?? quote.chartPreviousClose,
      source: "yahoo"
    };
  }

  return null;
}

export async function fetchMarketCandles(
  symbol: string,
  {
    range = "3mo",
    interval = "1d",
    limit = 24
  }: {
    range?: "1d" | "1mo" | "3mo" | "6mo" | "1y" | "5y";
    interval?: "1d" | "1wk" | "1mo";
    limit?: number;
  } = {}
): Promise<MarketChart | null> {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const cacheKey = `${trimmed.toUpperCase()}:${range}:${interval}:${limit}`;
  return chartCache.get(cacheKey, async () => {
    for (const yahooSymbol of yahooLookupSymbols(trimmed)) {
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
      url.searchParams.set("range", range);
      url.searchParams.set("interval", interval);
      const response = await fetchWithTimeout(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store"
      }, 3000, 0);

      if (!response.ok) continue;

      const json = (await response.json()) as { chart?: { result?: YahooChartResult[] } };
      const result = json.chart?.result?.[0];
      const meta = result?.meta;
      const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp || !meta?.symbol || !quote) continue;

      const candles = result.timestamp
      .map((timestamp, index) => {
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        if (
          typeof open !== "number" ||
          typeof high !== "number" ||
          typeof low !== "number" ||
          typeof close !== "number"
        ) {
          return null;
        }

        return {
          date: new Date(timestamp * 1000).toISOString(),
          open,
          high,
          low,
          close
        };
      })
      .filter((candle): candle is MarketCandle => Boolean(candle))
      .slice(-limit);

      if (candles.length === 0) continue;

      const previousClose = meta.chartPreviousClose;
      const lastClose = candles.at(-1)?.close;
      const previousCandleClose = candles.at(-2)?.close;
      const changeRate =
        typeof previousCandleClose === "number" && previousCandleClose > 0 && typeof lastClose === "number"
          ? (lastClose - previousCandleClose) / previousCandleClose
          : typeof previousClose === "number" && previousClose > 0 && typeof lastClose === "number"
            ? (lastClose - previousClose) / previousClose
            : undefined;

      return {
        symbol: normalizeSymbolForStorage(meta.symbol, meta.currency),
        currency: inferCurrency(meta.symbol, meta.currency),
        marketCountry: inferMarketCode(meta.symbol, meta.currency, meta.fullExchangeName ?? meta.exchangeName),
        candles,
        previousClose,
        regularMarketPrice: meta.regularMarketPrice,
        changeRate
      };
    }

    return null;
  });
}

function mergeSearchResults(
  primary: SymbolSearchResult[],
  secondary: SymbolSearchResult[]
): SymbolSearchResult[] {
  const seen = new Set<string>();
  return [...primary, ...secondary]
    .filter((result) => {
      const krCode = normalizeKrStockCode(result.symbol);
      const key = krCode ? `KR:${krCode}` : result.symbol.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 15);
}

function monthsFromDates(dates: string[]) {
  const months = dates
    .map((date) => new Date(date).getMonth() + 1)
    .filter((month) => month >= 1 && month <= 12);
  return [...new Set(months)].sort((a, b) => a - b);
}

function yahooDividendSymbols(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  const symbols = [normalized];
  const krSecurityCode = normalizeKrSecurityCode(normalized);
  if (krSecurityCode) {
    symbols.push(`${krSecurityCode}.KS`, `${krSecurityCode}.KQ`);
  }

  return [...new Set(symbols)];
}

function annualDividendFromYahooRows(rows: YahooDividendEvent[]) {
  const latestDate = Number(rows[0]?.date);
  if (!Number.isFinite(latestDate)) return 0;
  const trailingStart = latestDate - 365 * 24 * 60 * 60;

  return rows
    .filter((row) => Number(row.date) > trailingStart && Number(row.date) <= latestDate)
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

function annualDividendFromDatedRows<T extends { date?: string; adjDividend?: number; dividend?: number }>(rows: T[]) {
  const latestTime = rows[0]?.date ? new Date(rows[0].date).getTime() : NaN;
  if (!Number.isFinite(latestTime)) return 0;
  const trailingStart = latestTime - 365 * 24 * 60 * 60 * 1000;

  return rows
    .filter((row) => {
      const time = row.date ? new Date(row.date).getTime() : NaN;
      return Number.isFinite(time) && time > trailingStart && time <= latestTime;
    })
    .reduce((sum, row) => sum + Number(row.adjDividend ?? row.dividend ?? 0), 0);
}

async function fetchYahooDividendRecord(symbol: string): Promise<DividendRecord | null> {
  const normalized = symbol.trim().toUpperCase();
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - 60 * 60 * 24 * 365 * 5;

  for (const yahooSymbol of yahooDividendSymbols(normalized)) {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
    url.searchParams.set("period1", String(period1));
    url.searchParams.set("period2", String(period2));
    url.searchParams.set("interval", "1d");
    url.searchParams.set("events", "div");
    const response = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store"
    });
    if (!response.ok) continue;

    const json = await response.json() as { chart?: { result?: YahooChartResult[]; error?: unknown } };
    if (json.chart?.error) continue;

    const result = json.chart?.result?.[0];
    const dividends = result?.events?.dividends;
    const rows = Object.values(dividends ?? {})
      .filter((event) => event.date && event.amount)
      .sort((a, b) => Number(b.date) - Number(a.date))
      .slice(0, 12);

    const regularMarketPrice = result?.meta?.regularMarketPrice ?? result?.meta?.chartPreviousClose;
    if (rows.length === 0) {
      const verifiedSecurity = result?.meta?.symbol?.toUpperCase() === yahooSymbol &&
        Array.isArray(result.timestamp) &&
        result.timestamp.some((time) => Number.isFinite(time) && time > 0) &&
        typeof regularMarketPrice === "number" && Number.isFinite(regularMarketPrice) && regularMarketPrice > 0;
      if (!verifiedSecurity || Object.keys(dividends ?? {}).length > 0) continue;
    }

    const annualDividendPerShare = annualDividendFromYahooRows(rows);

    return {
      symbol: normalizeKrSecurityCode(normalized) ? normalizeKrSecurityCode(normalized) ?? normalized : normalized,
      currency: inferCurrency(yahooSymbol, result?.meta?.currency),
      annualDividendPerShare,
      trailingYield:
        typeof regularMarketPrice === "number" && regularMarketPrice > 0
          ? annualDividendPerShare / regularMarketPrice
          : undefined,
      expectedPaymentMonths: [
        ...new Set(rows.map((row) => new Date(Number(row.date) * 1000).getMonth() + 1))
      ].sort((a, b) => a - b),
      lastDividendPerShare: rows.length > 0 ? Number(rows[0]?.amount) : undefined,
      memo: rows.length > 0
        ? "Yahoo Finance 배당 이력에서 추정됨. 지급일/기준일은 별도 검증 필요"
        : "Yahoo Finance 시세 및 배당 이력 조회 완료. 지급 이력이 없어 연 배당 0원으로 반영"
    };
  }

  return null;
}

export async function fetchDividendRecordFromMarket(symbol: string): Promise<DividendRecord | null> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return null;

  if (normalizeKrSecurityCode(normalized)) {
    const openDartRecord = await fetchOpenDartDividendRecord(normalized);
    if (openDartRecord) return openDartRecord;
    return fetchYahooDividendRecord(normalized);
  }

  const openDartRecord = await fetchOpenDartDividendRecord(normalized);
  if (openDartRecord) return openDartRecord;

  if (fmpApiKey()) {
    const url = new URL("https://financialmodelingprep.com/stable/dividends");
    url.searchParams.set("symbol", normalized);
    url.searchParams.set("apikey", fmpApiKey() ?? "");
    const response = await fetchWithTimeout(url, { cache: "no-store" });
    if (response.ok) {
      const rows = ((await response.json()) as FmpDividendRow[])
        .filter((row) => row.date && (row.adjDividend || row.dividend))
        .sort((a, b) => new Date(b.date ?? "").getTime() - new Date(a.date ?? "").getTime())
        .slice(0, 12);
      if (rows.length > 0) {
        const annualDividendPerShare = annualDividendFromDatedRows(rows);
        return {
          symbol: normalized,
          currency: inferCurrency(normalized),
          annualDividendPerShare,
          expectedPaymentMonths: monthsFromDates(
            rows.map((row) => row.paymentDate ?? row.recordDate ?? row.date ?? "").filter(Boolean)
          ),
          lastDividendPerShare: Number(rows[0]?.adjDividend ?? rows[0]?.dividend ?? 0),
          memo: "FMP 배당 데이터에서 동기화됨"
        };
      }
    }
  }

  return fetchYahooDividendRecord(normalized);
}

async function fetchOpenDartDividendRecord(symbol: string): Promise<DividendRecord | null> {
  const apiKey = openDartApiKey();
  const stockCode = normalizeKrStockCode(symbol);
  if (!apiKey || !stockCode) return null;

  const corpCodes = await readOpenDartCorpCodes();
  const corp = corpCodes.find((row) => row.stock_code === stockCode);
  if (!corp?.corp_code) return null;

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
  const requests = years.flatMap((year) => DART_REPORTS.map((report) => ({ year, report })));
  const results = (
    await mapWithConcurrency(requests, 3, async ({ year, report }) => {
      const response = await fetchOpenDartAlotMatter(apiKey, corp.corp_code ?? "", year, report.code);
      const rows = response?.list ?? [];
      return rows.map((row) => ({ row, year, report }));
    })
  ).flat();

  const dividendRows = results
    .map((result) => ({
      ...result,
      amount: parseNumber(result.row.thstrm)
    }))
    .filter(({ row, amount }) => {
      const se = row.se ?? "";
      const stockKind = row.stock_knd ?? "";
      return (
        amount !== undefined &&
        amount > 0 &&
        se.includes("주당") &&
        se.includes("배당") &&
        (!stockKind || stockKind.includes("보통"))
      );
    })
    .sort((a, b) => b.year - a.year);

  const annualRow = dividendRows.find((result) => result.report.code === "11011") ?? dividendRows[0];
  if (!annualRow?.amount) return null;

  const yieldRows = results
    .map((result) => ({
      ...result,
      yieldRate: parseNumber(result.row.thstrm)
    }))
    .filter(({ row, yieldRate }) => {
      const se = row.se ?? "";
      const stockKind = row.stock_knd ?? "";
      return (
        yieldRate !== undefined &&
        yieldRate > 0 &&
        se.includes("배당수익률") &&
        (!stockKind || stockKind.includes("보통"))
      );
    })
    .sort((a, b) => b.year - a.year);

  const expectedPaymentMonths = [
    ...new Set(dividendRows.map((result) => result.report.paymentMonth))
  ].sort((a, b) => a - b);

  return {
    symbol: stockCode,
    currency: "KRW",
    annualDividendPerShare: annualRow.amount,
    trailingYield: yieldRows[0]?.yieldRate ? yieldRows[0].yieldRate / 100 : undefined,
    expectedPaymentMonths: expectedPaymentMonths.length > 0 ? expectedPaymentMonths : [4],
    lastDividendPerShare: dividendRows[0]?.amount,
    memo: `OpenDART ${annualRow.year} ${annualRow.report.label} 배당 데이터에서 동기화됨`
  };
}

async function fetchOpenDartAlotMatter(
  apiKey: string,
  corpCode: string,
  year: number,
  reportCode: string
): Promise<OpenDartAlotMatterResponse | null> {
  const url = new URL("https://opendart.fss.or.kr/api/alotMatter.json");
  url.searchParams.set("crtfc_key", apiKey);
  url.searchParams.set("corp_code", corpCode);
  url.searchParams.set("bsns_year", String(year));
  url.searchParams.set("reprt_code", reportCode);

  const response = await fetchWithTimeout(url, { cache: "no-store" });
  if (!response.ok) return null;

  const json = (await response.json()) as OpenDartAlotMatterResponse;
  return json.status === "000" ? json : null;
}
