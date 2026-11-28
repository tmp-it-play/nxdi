"use client";

import React, { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { MarketCandle } from "@/lib/types";

type ChartPoint = {
  date: string;
  value: number;
};

type ValueFormat = "number" | "krw" | "usd" | "percent";
type DateGranularity = "day" | "month";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatExactDate(value: string, granularity: DateGranularity) {
  if (granularity === "month") {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long"
    }).format(new Date(value));
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(value));
}

function formatAxisDate(value: string, showYear: boolean, granularity: DateGranularity) {
  const date = new Date(value);
  if (granularity === "month") {
    return showYear ? `${String(date.getFullYear()).slice(2)}.${date.getMonth() + 1}` : `${date.getMonth() + 1}월`;
  }
  if (showYear) {
    return `${String(date.getFullYear()).slice(2)}.${date.getMonth() + 1}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatValue(value: number, format: ValueFormat) {
  if (format === "krw") return formatCurrency(value, "KRW");
  if (format === "usd") return formatCurrency(value, "USD");
  if (format === "percent") return `${formatNumber(value * 100)}%`;
  return formatNumber(value);
}

export function CandleChart({
  candles,
  size = "compact",
  label,
  valueFormat = "number",
  dateGranularity = "day"
}: {
  candles: MarketCandle[];
  size?: "compact" | "detail";
  label?: string;
  valueFormat?: ValueFormat;
  dateGranularity?: DateGranularity;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (activeIndex === null) return;

    function handleDocumentPointerMove(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && chartRef.current?.contains(target)) return;
      setActiveIndex(null);
    }

    document.addEventListener("pointermove", handleDocumentPointerMove);
    return () => document.removeEventListener("pointermove", handleDocumentPointerMove);
  }, [activeIndex]);

  const metrics = useMemo(() => {
    const width = size === "detail" ? 640 : 148;
    const height = size === "detail" ? 220 : 52;
    if (candles.length === 0) {
      return {
        width,
        height,
        min: 0,
        max: 1,
        range: 1,
        gap: 0,
        candleWidth: 0,
        sidePadding: 0,
        topPadding: size === "detail" ? 18 : 6,
        bottomPadding: size === "detail" ? 34 : 6,
        plotHeight: height - (size === "detail" ? 52 : 12),
        dense: false
      };
    }

    const min = Math.min(...candles.map((candle) => candle.low));
    const max = Math.max(...candles.map((candle) => candle.high));
    const range = max - min || 1;
    const dense = candles.length > (size === "detail" ? 90 : 40);
    const desiredGap = dense ? (size === "detail" ? 0.7 : 0.6) : size === "detail" ? 7 : 4;
    const sidePadding = dense ? (size === "detail" ? 8 : 2) : desiredGap;
    const plotWidth = Math.max(1, width - sidePadding * 2);
    const minCandleWidth = dense ? 0.45 : size === "detail" ? 5 : 3;
    let gap = desiredGap;
    let candleWidth = (plotWidth - gap * Math.max(0, candles.length - 1)) / candles.length;

    if (candleWidth < minCandleWidth && candles.length > 1) {
      const maxGapForMinWidth = (plotWidth - minCandleWidth * candles.length) / (candles.length - 1);
      if (maxGapForMinWidth >= 0) {
        gap = Math.min(desiredGap, maxGapForMinWidth);
        candleWidth = minCandleWidth;
      } else {
        gap = 0;
        candleWidth = plotWidth / candles.length;
      }
    } else {
      candleWidth = Math.max(minCandleWidth, candleWidth);
    }

    const topPadding = size === "detail" ? 18 : 6;
    const bottomPadding = size === "detail" ? 34 : 6;
    const plotHeight = height - topPadding - bottomPadding;

    return {
      width,
      height,
      min,
      max,
      range,
      gap,
      candleWidth,
      sidePadding,
      topPadding,
      bottomPadding,
      plotHeight,
      dense
    };
  }, [candles, size]);

  if (candles.length === 0) {
    return (
      <div className={size === "detail" ? "candle-chart detail empty-chart" : "candle-chart empty-chart"}>
        차트 데이터 없음
      </div>
    );
  }

  const activeCandle = activeIndex === null ? null : candles[activeIndex];

  function y(value: number) {
    return metrics.topPadding + ((metrics.max - value) / metrics.range) * metrics.plotHeight;
  }

  function x(index: number) {
    return metrics.sidePadding + index * (metrics.candleWidth + metrics.gap);
  }

  function handleMouseMove(event: MouseEvent<SVGSVGElement>) {
    if (candles.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / metrics.width, rect.height / metrics.height);
    const renderedWidth = metrics.width * scale;
    const renderedLeft = rect.left + (rect.width - renderedWidth) / 2;
    const svgX = Math.min(metrics.width, Math.max(0, (event.clientX - renderedLeft) / scale));
    const rawIndex = Math.round((svgX - metrics.sidePadding - metrics.candleWidth / 2) / (metrics.candleWidth + metrics.gap));
    setActiveIndex(Math.min(candles.length - 1, Math.max(0, rawIndex)));
  }

  const activeX =
    activeIndex !== null ? x(activeIndex) + metrics.candleWidth / 2 : 0;
  const axisY = metrics.height - metrics.bottomPadding;
  const spansMultipleYears =
    new Date(candles.at(-1)!.date).getFullYear() !== new Date(candles[0].date).getFullYear();
  const axisTickIndices = [...new Set(
    candles.length <= 4
      ? candles.map((_, index) => index)
      : [0, Math.floor((candles.length - 1) / 3), Math.floor(((candles.length - 1) * 2) / 3), candles.length - 1]
  )];
  const className = [
    "candle-chart",
    size === "detail" && "detail",
    metrics.dense && "dense"
  ].filter(Boolean).join(" ");

  return (
    <div
      ref={chartRef}
      className={className}
      aria-label={label}
      onMouseLeave={() => setActiveIndex(null)}
    >
      <svg
        onMouseLeave={() => setActiveIndex(null)}
        onMouseMove={handleMouseMove}
        role="img"
        viewBox={`0 0 ${metrics.width} ${metrics.height}`}
      >
        {size === "detail" ? (
          <>
            <line className="chart-grid" x1="0" x2={metrics.width} y1={metrics.topPadding} y2={metrics.topPadding} />
            <line className="chart-grid" x1="0" x2={metrics.width} y1={metrics.height / 2} y2={metrics.height / 2} />
            <line
              className="chart-grid"
              x1="0"
              x2={metrics.width}
              y1={axisY}
              y2={axisY}
            />
          </>
        ) : null}
        {candles.map((candle, index) => {
          const itemX = x(index);
          const center = itemX + metrics.candleWidth / 2;
          const direction = candle.close > candle.open
            ? "up"
            : candle.close < candle.open
              ? "down"
              : "flat";
          const openY = y(candle.open);
          const closeY = y(candle.close);
          const rawBodyHeight = Math.abs(openY - closeY);
          const bodyHeight = Math.max(2, rawBodyHeight);
          const centeredBodyY = Math.min(openY, closeY) - (bodyHeight - rawBodyHeight) / 2;
          const bodyY = Math.max(
            metrics.topPadding,
            Math.min(centeredBodyY, metrics.topPadding + metrics.plotHeight - bodyHeight)
          );

          return (
            <g
              className={`candle ${direction}`}
              key={`${candle.date}-${index}`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              tabIndex={size === "detail" ? 0 : -1}
            >
              <rect
                className="candle-hit-area"
                x={Math.max(0, itemX - metrics.gap / 2)}
                y="0"
                width={metrics.candleWidth + metrics.gap}
                height={metrics.height}
              />
              <line x1={center} x2={center} y1={y(candle.high)} y2={y(candle.low)} />
              <rect
                className="candle-body"
                x={itemX}
                y={bodyY}
                width={metrics.candleWidth}
                height={bodyHeight}
                rx={metrics.dense ? 0.8 : 2}
              />
            </g>
          );
        })}
        {size === "detail"
          ? axisTickIndices.map((index) => {
              const tickX = Math.min(metrics.width - 34, Math.max(34, x(index) + metrics.candleWidth / 2));
              return (
                <g className="chart-axis-tick" key={`${candles[index].date}-${index}`}>
                  <line x1={tickX} x2={tickX} y1={axisY} y2={axisY + 5} />
                  <text x={tickX} y={metrics.height - 8}>
                    {formatAxisDate(candles[index].date, spansMultipleYears, dateGranularity)}
                  </text>
                </g>
              );
            })
          : null}
        {size === "detail" && activeIndex !== null && activeCandle ? (
          <>
            <line
              className="chart-active-line"
              x1={activeX}
              x2={activeX}
              y1={metrics.topPadding}
              y2={axisY}
            />
          </>
        ) : null}
      </svg>
      {size === "detail" && activeCandle ? (
        <div className="chart-tooltip">
          <strong>{formatExactDate(activeCandle.date, dateGranularity)}</strong>
          <span>시가 {formatValue(activeCandle.open, valueFormat)}</span>
          <span>고가 {formatValue(activeCandle.high, valueFormat)}</span>
          <span>저가 {formatValue(activeCandle.low, valueFormat)}</span>
          <span>종가 {formatValue(activeCandle.close, valueFormat)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function SparkLineChart({
  points,
  label,
  valueFormat = "number",
  interactive = true,
  trendValue
}: {
  points: ChartPoint[];
  label?: string;
  valueFormat?: ValueFormat;
  interactive?: boolean;
  trendValue?: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return <div className="sparkline-chart empty-chart">데이터 없음</div>;
  }

  const width = 160;
  const height = 46;
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const hasFlatRange = max === min;
  const range = hasFlatRange ? 1 : max - min;
  const activePoint = interactive && activeIndex !== null ? points[activeIndex] : null;
  const singlePoint = points.length === 1;
  const visiblePoint = activePoint ?? (singlePoint ? points[0] : null);
  const visiblePointIndex = activePoint ? activeIndex ?? 0 : 0;

  function x(index: number) {
    return points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
  }

  function y(value: number) {
    if (hasFlatRange) return height / 2;
    return 5 + ((max - value) / range) * (height - 10);
  }

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point.value).toFixed(2)}`)
    .join(" ");

  const isUp = trendValue === undefined ? points.at(-1)!.value >= points[0]!.value : trendValue >= 0;

  return (
    <div className="sparkline-chart" aria-label={label} onMouseLeave={() => interactive && setActiveIndex(null)}>
      <svg role="img" viewBox={`0 0 ${width} ${height}`}>
        <path className={isUp ? "sparkline-path up" : "sparkline-path down"} d={path} />
        {interactive
          ? points.map((point, index) => (
              <rect
                className="sparkline-hit-area"
                key={`${point.date}-${index}`}
                x={Math.max(0, x(index) - width / points.length / 2)}
                y="0"
                width={Math.max(8, width / points.length)}
                height={height}
                onMouseEnter={() => setActiveIndex(index)}
              />
            ))
          : null}
        {visiblePoint ? (
          <circle
            className={isUp ? "sparkline-dot up" : "sparkline-dot down"}
            cx={x(visiblePointIndex)}
            cy={y(visiblePoint.value)}
            r={singlePoint ? "4" : "3"}
          />
        ) : null}
      </svg>
      {activePoint ? (
        <div className="sparkline-tooltip">
          {formatDate(activePoint.date)} · {formatValue(activePoint.value, valueFormat)}
        </div>
      ) : null}
    </div>
  );
}
