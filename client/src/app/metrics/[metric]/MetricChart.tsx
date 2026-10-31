"use client";

import { useState } from "react";
import { CandleChart } from "@/app/components/candle-chart";
import { SectionHeader } from "@/app/components/tds";
import type { MarketCandle } from "@/lib/types";

export function MetricChart({ title, candles, weeklyCandles, monthly, valueFormat }: {
  title: string;
  candles: MarketCandle[];
  weeklyCandles?: MarketCandle[];
  monthly: boolean;
  valueFormat: "krw" | "percent";
}) {
  const [showWeekly, setShowWeekly] = useState(true);
  const weekly = !monthly && weeklyCandles !== undefined && showWeekly;
  const period = monthly ? "월봉" : weekly ? "주봉" : "일봉";
  const description = monthly
    ? "꼬리는 월중 평가금액으로 계산한 배당수익률의 범위입니다. 확정된 달은 실배당을 연환산하고, 이번 달 배당이 미확정이면 연 예상 배당금을 사용합니다."
    : weekly
      ? "월요일부터 한 주 동안 기록한 값으로 주봉을 그립니다. 꼬리는 그 주의 최댓값과 최솟값을 표시합니다."
      : "꼬리는 하루 동안 수집한 평가값의 범위입니다. 장중 기록이 없는 과거 일봉은 전일 종가와 당일 종가를 연결합니다.";

  return (
    <>
      <SectionHeader
        title={`세부 차트 · ${period}`}
        description={description}
        actions={!monthly && weeklyCandles !== undefined ? (
          <div className="split-actions" role="group" aria-label="차트 기간">
            <button type="button" className={`tab ${weekly ? "" : "active"}`} aria-pressed={!weekly} onClick={() => setShowWeekly(false)}>일봉</button>
            <button type="button" className={`tab ${weekly ? "active" : ""}`} aria-pressed={weekly} onClick={() => setShowWeekly(true)}>주봉</button>
          </div>
        ) : undefined}
      />
      <CandleChart
        key={period}
        candles={weekly ? weeklyCandles : candles}
        label={`${title} ${period} 차트`}
        size="detail"
        valueFormat={valueFormat}
        dateGranularity={monthly ? "month" : "day"}
      />
    </>
  );
}
