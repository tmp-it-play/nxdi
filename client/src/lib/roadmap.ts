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

export type UpdateRoadmapEventInput = {
  eventDate?: string;
  kind?: RoadmapEventKind;
  category?: RoadmapEventCategory;
  label?: string;
};

export type RoadmapEventDateGroup = {
  dateKey: string;
  events: RoadmapEvent[];
};

export const ROADMAP_HORIZON_DAYS = 30;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

export function assertDateKey(dateKey: string) {
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

export function roadmapDateKeys(
  fromDateKey = kstDateKey(),
  throughDateKey = roadmapHorizonEndDate(fromDateKey)
) {
  assertDateKey(fromDateKey);
  assertDateKey(throughDateKey);
  if (throughDateKey < fromDateKey) return [];

  const keys: string[] = [];
  let dateKey = fromDateKey;
  while (dateKey <= throughDateKey) {
    keys.push(dateKey);
    if (dateKey === throughDateKey) break;
    dateKey = addDaysToDateKey(dateKey, 1);
  }
  return keys;
}

export function stripDisclosureTag(title: string) {
  return title
    .trim()
    .replace(/^(?:\[\s*(?:공지|공시)\s*\]\s*)+/u, "")
    .trim();
}

const ROADMAP_KIND_LABELS: Record<RoadmapEventKind, string> = {
  PLANNED: "예정",
  COMPLETED: "완료",
  DELAYED: "연기",
  CANCELLED: "취소"
};

const ROADMAP_CATEGORY_LABELS: Record<RoadmapEventCategory, string> = {
  CAPITAL_INCREASE: "증자",
  REDUCTION: "감자",
  REBALANCING: "리밸런싱",
  TRADE: "매매",
  OTHER: "기타"
};

export function roadmapKindLabel(kind: RoadmapEventKind) {
  return ROADMAP_KIND_LABELS[kind];
}

export function roadmapCategoryLabel(category: RoadmapEventCategory) {
  return ROADMAP_CATEGORY_LABELS[category];
}

export function sortRoadmapEvents(events: readonly RoadmapEvent[]) {
  return [...events].sort(
    (a, b) =>
      a.eventDate.localeCompare(b.eventDate) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  );
}

export function groupRoadmapEventsByDate(events: readonly RoadmapEvent[]): RoadmapEventDateGroup[] {
  const groups: RoadmapEventDateGroup[] = [];

  for (const event of sortRoadmapEvents(events)) {
    const lastGroup = groups.at(-1);
    if (lastGroup?.dateKey === event.eventDate) {
      lastGroup.events.push(event);
    } else {
      groups.push({ dateKey: event.eventDate, events: [event] });
    }
  }

  return groups;
}
