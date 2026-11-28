const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DIVIDEND_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function dividendCompletionMonth(completedAt: string) {
  const completedDate = new Date(completedAt);
  if (Number.isNaN(completedDate.getTime())) return undefined;
  return new Date(completedDate.getTime() + KST_OFFSET_MS).toISOString().slice(0, 7);
}

export function dividendEligibleFromMonth(completedAt: string) {
  const completionMonth = dividendCompletionMonth(completedAt);
  if (!completionMonth) return undefined;

  const year = Number(completionMonth.slice(0, 4));
  const month = Number(completionMonth.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

export function isEligibleForDividendMonth(completedAt: string, dividendMonth: string) {
  if (!DIVIDEND_MONTH_PATTERN.test(dividendMonth)) return false;
  const eligibleFromMonth = dividendEligibleFromMonth(completedAt);
  return typeof eligibleFromMonth === "string" && eligibleFromMonth <= dividendMonth;
}
