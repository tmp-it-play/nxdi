"use client";

import { useMemo, useState } from "react";
import { Empty, List, ListRow, RowMeta } from "@/app/components/tds";
import { forecastLinePaymentAmount } from "@/lib/dividend-math";
import { formatKrw, formatNumber } from "@/lib/format";
import { stockPrimaryLabel, stockSecondaryLabel } from "@/lib/stock-display";
import type { DividendForecastLine } from "@/lib/types";

type ForecastView = "monthly" | "stock";
type DividendForecastViewMode = "simulation" | "holding";

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function formatOptionalKrw(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? formatKrw(value) : "-";
}

export function DividendForecastView({
  lines,
  mode = "simulation"
}: {
  lines: DividendForecastLine[];
  mode?: DividendForecastViewMode;
}) {
  const [view, setView] = useState<ForecastView>("monthly");
  const monthlyRows = useMemo(
    () =>
      MONTHS.map((month) => {
        const items = lines.filter((line) => line.expectedPaymentMonths.includes(month));
        return {
          month,
          items,
          amountKrw: items.reduce((sum, line) => sum + (forecastLinePaymentAmount(line) ?? 0), 0),
          hasMissingAmount: items.some((line) => typeof forecastLinePaymentAmount(line) !== "number")
        };
      }),
    [lines]
  );
  const unscheduledLines = lines.filter(
    (line) => typeof line.annualDividendKrw === "number" && line.annualDividendKrw > 0 && line.expectedPaymentMonths.length === 0
  );
  const hasMonthlyRows = monthlyRows.some((row) => row.items.length > 0);

  return (
    <section className="forecast-view">
      <div className="tabs" role="tablist" aria-label="예상 배당 보기">
        <button
          className={`tab ${view === "monthly" ? "active" : ""}`}
          type="button"
          role="tab"
          aria-selected={view === "monthly"}
          onClick={() => setView("monthly")}
        >
          월별
        </button>
        <button
          className={`tab ${view === "stock" ? "active" : ""}`}
          type="button"
          role="tab"
          aria-selected={view === "stock"}
          onClick={() => setView("stock")}
        >
          종목별
        </button>
      </div>

      {view === "monthly" ? (
        <div className="dividend-calendar" role="list" aria-label="월별 예상 배당 캘린더">
          {monthlyRows.map((row) => (
            <article
              className={`dividend-calendar-month ${row.items.length > 0 ? "has-dividend" : "empty"}`}
              key={row.month}
              role="listitem"
            >
              <header>
                <span>{row.month}월</span>
                {row.items.length > 0 ? <strong>{row.hasMissingAmount ? "-" : formatKrw(row.amountKrw)}</strong> : <em>예정 없음</em>}
              </header>
              <div className="dividend-calendar-items">
                {row.items.length > 0 ? (
                  <>
                    {row.items.slice(0, 3).map((line) => (
                      <span className="dividend-calendar-chip" key={line.symbol} title={stockPrimaryLabel(line)}>
                        {stockPrimaryLabel(line)}
                      </span>
                    ))}
                    {row.items.length > 3 ? (
                      <span className="dividend-calendar-more">+{row.items.length - 3}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="dividend-calendar-empty">배당 예정 종목 없음</span>
                )}
              </div>
              {row.items.length > 0 ? <footer>{row.items.length}개 종목</footer> : null}
            </article>
          ))}
          {unscheduledLines.length > 0 ? (
            <article className="dividend-calendar-unscheduled" role="listitem">
              <header>
                <span>지급월 없음</span>
                <strong>{formatKrw(unscheduledLines.reduce((sum, line) => sum + (line.annualDividendKrw ?? 0), 0))}</strong>
              </header>
              <div className="dividend-calendar-items">
                {unscheduledLines.slice(0, 6).map((line) => (
                  <span className="dividend-calendar-chip" key={line.symbol} title={stockPrimaryLabel(line)}>
                    {stockPrimaryLabel(line)}
                  </span>
                ))}
                {unscheduledLines.length > 6 ? (
                  <span className="dividend-calendar-more">+{unscheduledLines.length - 6}</span>
                ) : null}
              </div>
              <footer>{unscheduledLines.length}개 종목</footer>
            </article>
          ) : null}
          {!hasMonthlyRows && unscheduledLines.length === 0 ? <Empty>예상 배당 데이터가 없습니다.</Empty> : null}
        </div>
      ) : (
        <List>
          {lines.map((line) => {
            const secondaryLabel = stockSecondaryLabel(line);
            const quantityText =
              mode === "holding"
                ? `보유 ${formatNumber(line.estimatedQuantity, 5)}주`
                : `배정 ${formatKrw(line.allocationKrw)} · 예상 ${formatNumber(line.estimatedQuantity, 5)}주`;
            const primaryAmount =
              mode === "holding" && line.expectedPaymentMonths.length > 0
                ? forecastLinePaymentAmount(line)
                : line.monthlyAverageKrw;
            const amountLabel =
              mode === "holding" && line.expectedPaymentMonths.length > 0 ? "회당 예상" : "월평균";
            return (
              <ListRow
                key={line.symbol}
                title={stockPrimaryLabel(line)}
                description={`${secondaryLabel ? `${secondaryLabel} · ` : ""}${quantityText}`}
                value={
                  <>
                    {formatOptionalKrw(primaryAmount)}
                    <RowMeta>
                      {amountLabel} · 연 {formatOptionalKrw(line.annualDividendKrw)} ·{" "}
                      {line.expectedPaymentMonths.length > 0
                        ? line.expectedPaymentMonths.map((month) => `${month}월`).join(", ")
                        : "지급월 없음"}
                      {line.dividendDataMissing ? " · 배당 데이터 없음" : ""}
                      {mode === "holding" && typeof line.lastDividendKrw === "number"
                        ? ` · 최근 ${formatKrw(line.lastDividendKrw)}`
                        : ""}
                    </RowMeta>
                  </>
                }
              />
            );
          })}
          {lines.length === 0 ? <Empty>예상 배당 데이터가 없습니다.</Empty> : null}
        </List>
      )}
    </section>
  );
}
