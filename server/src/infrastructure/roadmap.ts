import { prisma } from "./prisma.js";

export const ROADMAP_EVENT_KINDS = [
  "PLANNED",
  "COMPLETED",
  "DELAYED",
  "CANCELLED"
] as const;

export type RoadmapEventKind = (typeof ROADMAP_EVENT_KINDS)[number];

export const ROADMAP_EVENT_CATEGORIES = [
  "CAPITAL_INCREASE",
  "REDUCTION",
  "REBALANCING",
  "TRADE",
  "OTHER"
] as const;

export type RoadmapEventCategory = (typeof ROADMAP_EVENT_CATEGORIES)[number];

export type RoadmapEvent = {
  id: string;
  disclosureId: string;
  eventDate: string;
  kind: RoadmapEventKind;
  category: RoadmapEventCategory;
  label?: string;
  createdAt: string;
  updatedAt: string;
  disclosure: {
    id: string;
    title: string;
    body: string;
    createdAt: string;
  };
};

export type CreateRoadmapEventInput = {
  disclosureId: string;
  eventDate: string;
  kind: RoadmapEventKind;
  category: RoadmapEventCategory;
  label?: string;
};

export type UpdateRoadmapEventInput = {
  eventDate?: string;
  kind?: RoadmapEventKind;
  category?: RoadmapEventCategory;
  label?: string;
};

export const ROADMAP_HORIZON_DAYS = 30;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DISCLOSURE_SELECT = {
  id: true,
  title: true,
  body: true,
  createdAt: true
} as const;
const ROADMAP_EVENT_INCLUDE = {
  disclosure: { select: DISCLOSURE_SELECT }
} as const;
const ROADMAP_KIND_SET = new Set<string>(ROADMAP_EVENT_KINDS);
const ROADMAP_CATEGORY_SET = new Set<string>(ROADMAP_EVENT_CATEGORIES);

type RoadmapEventRow = {
  id: string;
  disclosureId: string;
  eventDate: string;
  kind: string;
  category: string;
  label: string | null;
  createdAt: Date;
  updatedAt: Date;
  disclosure: {
    id: string;
    title: string;
    body: string;
    createdAt: Date;
  };
};

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function dateParts(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return { year, month, day };
}

function assertDateKey(dateKey: string) {
  const parts = dateParts(dateKey);
  if (!parts) throw new RangeError(`Invalid date key: ${dateKey}`);
  return parts;
}

function utcDateFromDateKey(dateKey: string) {
  const { year, month, day } = assertDateKey(dateKey);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function formatDateKey(date: Date) {
  if (Number.isNaN(date.getTime())) throw new RangeError("Date is outside the supported range");
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) throw new RangeError("Date is outside the supported YYYY range");
  return `${String(year).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function isValidDateKey(value: string) {
  return dateParts(value) !== null;
}

export function kstDateKey(date = new Date()) {
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date");
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  if (!Number.isSafeInteger(days)) throw new RangeError("days must be a safe integer");

  const date = utcDateFromDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

export function roadmapHorizonEndDate(fromDateKey = kstDateKey()) {
  return addDaysToDateKey(fromDateKey, ROADMAP_HORIZON_DAYS);
}

export function roadmapInitialStartDate(fromDateKey = kstDateKey()) {
  return addDaysToDateKey(fromDateKey, -ROADMAP_HORIZON_DAYS);
}

export function isRoadmapQueryWindow(fromDateKey: string, throughDateKey: string) {
  if (!isValidDateKey(fromDateKey) || !isValidDateKey(throughDateKey)) return false;
  if (throughDateKey < fromDateKey) return false;
  return throughDateKey <= addDaysToDateKey(fromDateKey, ROADMAP_HORIZON_DAYS - 1);
}

export function stripDisclosureTag(title: string) {
  return title
    .trim()
    .replace(/^(?:\[\s*(?:공지|공시)\s*\]\s*)+/u, "")
    .trim();
}

function matchesAny(text: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const CANCELLED_PATTERNS = [/취소/u, /철회/u, /중단/u, /백지화/u, /무산/u];
const DELAYED_PATTERNS = [/연기/u, /지연/u, /순연/u];
const COMPLETED_PATTERNS = [/체결/u, /완료/u, /실행\s*결과/u, /진행\s*결과/u, /운용\s*결과/u, /종료/u];
const PLANNED_PATTERNS = [/예정/u, /계획/u, /추진/u, /진행\s*안내/u, /시행\s*안내/u];

function deriveKindFromText(text: string): RoadmapEventKind | null {
  if (matchesAny(text, CANCELLED_PATTERNS)) return "CANCELLED";
  if (matchesAny(text, DELAYED_PATTERNS)) return "DELAYED";
  if (matchesAny(text, COMPLETED_PATTERNS)) return "COMPLETED";
  if (matchesAny(text, PLANNED_PATTERNS)) return "PLANNED";
  return null;
}

export function deriveRoadmapKind(title: string, body = ""): RoadmapEventKind {
  const fromTitle = deriveKindFromText(stripDisclosureTag(title));
  if (fromTitle) return fromTitle;

  const fromBody = deriveKindFromText(body);
  if (fromBody) return fromBody;

  if (/^\s*\[\s*공시\s*\]/u.test(title)) return "COMPLETED";
  return "PLANNED";
}

export function deriveRoadmapCategory(title: string, body = ""): RoadmapEventCategory {
  const text = `${stripDisclosureTag(title)}\n${body}`;
  if (/감자|자본\s*감소/u.test(text)) return "REDUCTION";
  if (/증자|자본금?\s*증가|출자/u.test(text)) return "CAPITAL_INCREASE";
  if (/리밸런싱|종목\s*조정|비중\s*조정|편입|편출/u.test(text)) return "REBALANCING";
  if (/매수|매도|매매|거래|주문|체결/u.test(text)) return "TRADE";
  return "OTHER";
}

export function normalizeRoadmapEventKind(value: string): RoadmapEventKind {
  return ROADMAP_KIND_SET.has(value) ? (value as RoadmapEventKind) : "PLANNED";
}

export function normalizeRoadmapEventCategory(value: string): RoadmapEventCategory {
  return ROADMAP_CATEGORY_SET.has(value) ? (value as RoadmapEventCategory) : "OTHER";
}

function toRoadmapEvent(row: RoadmapEventRow): RoadmapEvent {
  return {
    id: row.id,
    disclosureId: row.disclosureId,
    eventDate: row.eventDate,
    kind: normalizeRoadmapEventKind(row.kind),
    category: normalizeRoadmapEventCategory(row.category),
    label: row.label ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    disclosure: {
      id: row.disclosure.id,
      title: row.disclosure.title,
      body: row.disclosure.body,
      createdAt: row.disclosure.createdAt.toISOString()
    }
  };
}

export async function readRoadmapEvents(options: { from?: string; through?: string } = {}) {
  if (options.from) assertDateKey(options.from);
  if (options.through) assertDateKey(options.through);

  const rows = await prisma.roadmapEvent.findMany({
    where: options.from || options.through
      ? {
          eventDate: {
            gte: options.from,
            lte: options.through
          }
        }
      : undefined,
    include: ROADMAP_EVENT_INCLUDE,
    orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }, { id: "asc" }]
  });

  return rows.map((row) => toRoadmapEvent(row));
}

export async function createRoadmapEvent(input: CreateRoadmapEventInput) {
  assertDateKey(input.eventDate);
  const label = input.label?.trim() || null;
  const row = await prisma.roadmapEvent.create({
    data: {
      disclosureId: input.disclosureId,
      eventDate: input.eventDate,
      kind: input.kind,
      category: input.category,
      label
    },
    include: ROADMAP_EVENT_INCLUDE
  });

  return toRoadmapEvent(row);
}

export async function updateRoadmapEvent(id: string, input: UpdateRoadmapEventInput) {
  if (input.eventDate !== undefined) assertDateKey(input.eventDate);

  const row = await prisma.roadmapEvent.update({
    where: { id },
    data: {
      eventDate: input.eventDate,
      kind: input.kind,
      category: input.category,
      label: input.label === undefined ? undefined : input.label.trim() || null
    },
    include: ROADMAP_EVENT_INCLUDE
  });

  return toRoadmapEvent(row);
}

export async function deleteRoadmapEvent(id: string) {
  await prisma.roadmapEvent.delete({ where: { id } });
}
