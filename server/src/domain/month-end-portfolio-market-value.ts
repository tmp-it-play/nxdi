const DIVIDEND_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type MonthEndReferencePeriod = {
  snapshotDate: string;
  closedAfter: Date;
};

export type MonthEndPortfolioSnapshot = {
  snapshotDate: string;
  totalMarketValueKrw: number;
  closeTotalMarketValueKrw: number | null;
  closedAt: Date | null;
};

export function monthEndReferencePeriod(dividendMonth: string): MonthEndReferencePeriod | undefined {
  if (!DIVIDEND_MONTH_PATTERN.test(dividendMonth)) return undefined;

  const year = Number(dividendMonth.slice(0, 4));
  const month = Number(dividendMonth.slice(5, 7));
  if (year < 1000 || year > 9998) return undefined;

  const nextMonth =
    month === 12
      ? `${year + 1}-01`
      : `${year}-${String(month + 1).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    snapshotDate: `${dividendMonth}-${String(lastDay).padStart(2, "0")}`,
    closedAfter: new Date(`${nextMonth}-01T00:00:00+09:00`)
  };
}

export function confirmedMonthEndPortfolioMarketValueKrw({
  period,
  snapshot,
  latestTradeCreatedAt
}: {
  period: MonthEndReferencePeriod;
  snapshot: MonthEndPortfolioSnapshot | null;
  latestTradeCreatedAt?: Date;
}) {
  if (
    !snapshot?.closedAt ||
    snapshot.snapshotDate !== period.snapshotDate ||
    snapshot.closedAt < period.closedAfter ||
    (latestTradeCreatedAt && snapshot.closedAt < latestTradeCreatedAt)
  ) {
    return undefined;
  }

  const marketValueKrw = snapshot.closeTotalMarketValueKrw ?? snapshot.totalMarketValueKrw;
  return Number.isFinite(marketValueKrw) && marketValueKrw > 0 ? marketValueKrw : undefined;
}
