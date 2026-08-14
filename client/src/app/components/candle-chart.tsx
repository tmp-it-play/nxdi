"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import type {
  BusinessDay,
  CandlestickData,
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time
} from "lightweight-charts";
import { CandleChart as SvgCandleChart } from "@/app/components/stock-chart";
import { formatCurrency } from "@/lib/format";
import type { MarketCandle } from "@/lib/types";

type ValueFormat = "number" | "krw" | "usd" | "percent";
type DateGranularity = "day" | "month";

type CandleChartProps = {
  candles: MarketCandle[];
  size?: "compact" | "detail";
  label?: string;
  valueFormat?: ValueFormat;
  dateGranularity?: DateGranularity;
};

type NormalizedCandle = MarketCandle & {
  date: string;
  time: BusinessDay;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatValue(value: number, format: ValueFormat) {
  if (format === "krw") return formatCurrency(value, "KRW");
  if (format === "usd") return formatCurrency(value, "USD");
  if (format === "percent") return `${formatNumber(value * 100)}%`;
  return formatNumber(value);
}

function formatExactDate(value: string, granularity: DateGranularity) {
  if (granularity === "month") {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      timeZone: "UTC"
    }).format(new Date(value));
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatAxisDate(value: string, showYear: boolean, granularity: DateGranularity) {
  const date = new Date(value);
  if (granularity === "month") {
    return showYear ? `${String(date.getUTCFullYear()).slice(2)}.${date.getUTCMonth() + 1}` : `${date.getUTCMonth() + 1}월`;
  }
  if (showYear) {
    return `${String(date.getUTCFullYear()).slice(2)}.${date.getUTCMonth() + 1}`;
  }
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

function parseBusinessDay(value: string): BusinessDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() + 1 !== month
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function dateKey(time: Time) {
  if (typeof time === "string") return time.slice(0, 10);
  if (typeof time === "number") return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

function normalizeCandles(candles: MarketCandle[]) {
  const uniqueCandles = new Map<string, NormalizedCandle>();

  for (const candle of candles) {
    const time = parseBusinessDay(candle.date);
    if (
      !time
      || ![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)
    ) {
      continue;
    }

    const date = dateKey(time);
    uniqueCandles.set(date, { ...candle, date, time });
  }

  return [...uniqueCandles.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function cssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function candleTone(candle: MarketCandle) {
  if (candle.close > candle.open) return "up";
  if (candle.close < candle.open) return "down";
  return "flat";
}

export function CandleChart(props: CandleChartProps) {
  const {
    candles,
    size = "compact",
    label = "캔들 차트",
    valueFormat = "number",
    dateGranularity = "day"
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesApiRef = useRef<ISeriesApi<"Candlestick", Time> | null>(null);
  const instructionsId = useId();
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [keyboardDate, setKeyboardDate] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const normalizedCandles = useMemo(() => normalizeCandles(candles), [candles]);
  const candleByDate = useMemo(
    () => new Map(normalizedCandles.map((candle) => [candle.date, candle])),
    [normalizedCandles]
  );
  const indexByDate = useMemo(
    () => new Map(normalizedCandles.map((candle, index) => [candle.date, index])),
    [normalizedCandles]
  );
  const firstCandle = normalizedCandles[0];
  const latestCandle = normalizedCandles.at(-1);
  const visibleCandle = (activeDate ? candleByDate.get(activeDate) : undefined) ?? latestCandle;
  const spansMultipleYears = Boolean(
    firstCandle
    && latestCandle
    && firstCandle.time.year !== latestCandle.time.year
  );

  useEffect(() => {
    if (size !== "detail" || normalizedCandles.length === 0) return;

    let disposed = false;
    let chart: IChartApi | null = null;
    let unsubscribeCrosshair: (() => void) | undefined;

    function destroyChart() {
      unsubscribeCrosshair?.();
      unsubscribeCrosshair = undefined;
      chart?.remove();
      chart = null;
      chartApiRef.current = null;
      seriesApiRef.current = null;
    }

    async function initializeChart() {
      const {
        CandlestickSeries,
        ColorType,
        CrosshairMode,
        LineStyle,
        createChart
      } = await import("lightweight-charts");
      const container = containerRef.current;
      if (disposed || !container) return;

      const colors = {
        accent: cssColor("--accent", "#5b50e6"),
        down: cssColor("--chart-down", "#3182f6"),
        flat: cssColor("--weak", "#9496a8"),
        grid: cssColor("--line", "#e5e5ef"),
        surface: cssColor("--surface", "#ffffff"),
        text: cssColor("--muted", "#6f7185"),
        up: cssColor("--danger", "#e5484d")
      };
      const priceFormatter = (value: number) => formatValue(value, valueFormat);

      chart = createChart(container, {
        autoSize: true,
        height: container.clientHeight || 300,
        layout: {
          attributionLogo: true,
          background: { type: ColorType.Solid, color: colors.surface },
          fontFamily: getComputedStyle(container).fontFamily,
          fontSize: 11,
          textColor: colors.text
        },
        grid: {
          horzLines: { color: colors.grid, style: LineStyle.Dotted },
          vertLines: { color: colors.grid, style: LineStyle.Dotted }
        },
        crosshair: {
          mode: CrosshairMode.MagnetOHLC,
          horzLine: {
            color: colors.accent,
            labelBackgroundColor: colors.accent,
            style: LineStyle.Dashed
          },
          vertLine: {
            color: colors.accent,
            labelBackgroundColor: colors.accent,
            style: LineStyle.Dashed
          }
        },
        localization: {
          locale: "ko-KR",
          priceFormatter,
          timeFormatter: (time: Time) => formatExactDate(dateKey(time), dateGranularity)
        },
        rightPriceScale: {
          borderColor: colors.grid,
          minimumWidth: 72,
          scaleMargins: { top: 0.08, bottom: 0.12 }
        },
        timeScale: {
          borderColor: colors.grid,
          minBarSpacing: 2,
          rightOffset: 1,
          tickMarkFormatter: (time: Time) => formatAxisDate(dateKey(time), spansMultipleYears, dateGranularity)
        },
        handleScroll: {
          horzTouchDrag: true,
          mouseWheel: true,
          pressedMouseMove: true,
          vertTouchDrag: false
        },
        handleScale: {
          axisDoubleClickReset: true,
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true
        }
      });

      const series = chart.addSeries(CandlestickSeries, {
        borderVisible: false,
        downColor: colors.down,
        lastValueVisible: true,
        priceFormat: {
          formatter: priceFormatter,
          minMove: valueFormat === "percent" ? 0.0001 : 0.01,
          type: "custom"
        },
        priceLineColor: colors.accent,
        priceLineStyle: LineStyle.Dotted,
        priceLineVisible: true,
        upColor: colors.up,
        wickDownColor: colors.down,
        wickUpColor: colors.up
      });
      const seriesData: CandlestickData<Time>[] = normalizedCandles.map((candle) => ({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        ...(candle.open === candle.close
          ? { color: colors.flat, borderColor: colors.flat, wickColor: colors.flat }
          : {})
      }));
      series.setData(seriesData);
      chart.timeScale().fitContent();

      const handleCrosshairMove = (event: MouseEventParams<Time>) => {
        setActiveDate(event.time ? dateKey(event.time) : null);
      };
      chart.subscribeCrosshairMove(handleCrosshairMove);
      unsubscribeCrosshair = () => chart?.unsubscribeCrosshairMove(handleCrosshairMove);
      chartApiRef.current = chart;
      seriesApiRef.current = series;
    }

    void initializeChart().catch(() => {
      if (!disposed) {
        destroyChart();
        setLoadFailed(true);
      }
    });

    return () => {
      disposed = true;
      destroyChart();
    };
  }, [dateGranularity, normalizedCandles, size, spansMultipleYears, valueFormat]);

  if (size !== "detail") {
    return <SvgCandleChart {...props} />;
  }

  if (normalizedCandles.length === 0) {
    return <div className="market-chart empty-chart">차트 데이터 없음</div>;
  }

  if (loadFailed) {
    return <SvgCandleChart {...props} size="detail" />;
  }

  function selectCandle(index: number) {
    const candle = normalizedCandles[index];
    if (!candle) return;

    setActiveDate(candle.date);
    setKeyboardDate(candle.date);
    const chart = chartApiRef.current;
    const series = seriesApiRef.current;
    if (chart && series) {
      chart.setCrosshairPosition(candle.close, candle.time, series);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const currentIndex = activeDate
      ? indexByDate.get(activeDate) ?? normalizedCandles.length - 1
      : normalizedCandles.length - 1;
    if (event.key === "Home") return selectCandle(0);
    if (event.key === "End") return selectCandle(normalizedCandles.length - 1);
    const offset = event.key === "ArrowLeft" ? -1 : 1;
    selectCandle(Math.min(normalizedCandles.length - 1, Math.max(0, currentIndex + offset)));
  }

  function clearKeyboardSelection() {
    setActiveDate(null);
    setKeyboardDate(null);
    chartApiRef.current?.clearCrosshairPosition();
  }

  const tone = candleTone(visibleCandle!);
  const keyboardCandle = keyboardDate ? candleByDate.get(keyboardDate) : undefined;

  return (
    <div className={`market-chart ${tone}`} aria-label={label} role="group">
      <div className="market-chart-readout">
        <time className="market-chart-date" dateTime={visibleCandle!.date}>
          {formatExactDate(visibleCandle!.date, dateGranularity)}
        </time>
        <dl className="market-chart-values">
          <div><dt>시가</dt><dd>{formatValue(visibleCandle!.open, valueFormat)}</dd></div>
          <div><dt>고가</dt><dd>{formatValue(visibleCandle!.high, valueFormat)}</dd></div>
          <div><dt>저가</dt><dd>{formatValue(visibleCandle!.low, valueFormat)}</dd></div>
          <div><dt>종가</dt><dd>{formatValue(visibleCandle!.close, valueFormat)}</dd></div>
        </dl>
      </div>

      <div
        ref={containerRef}
        aria-describedby={instructionsId}
        aria-label={`${label}. ${normalizedCandles.length}개 구간`}
        className="market-chart-viewport"
        onBlur={clearKeyboardSelection}
        onKeyDown={handleKeyDown}
        onPointerLeave={() => setActiveDate(null)}
        role="img"
        tabIndex={0}
      />
      <p className="visually-hidden" id={instructionsId}>
        좌우 화살표 키로 날짜별 시가, 고가, 저가, 종가를 확인할 수 있습니다. Home 키는 첫 구간, End 키는 최신 구간으로 이동합니다.
      </p>
      <p aria-atomic="true" aria-live="polite" className="visually-hidden" role="status">
        {keyboardCandle
          ? `${formatExactDate(keyboardCandle.date, dateGranularity)}, 시가 ${formatValue(keyboardCandle.open, valueFormat)}, 고가 ${formatValue(keyboardCandle.high, valueFormat)}, 저가 ${formatValue(keyboardCandle.low, valueFormat)}, 종가 ${formatValue(keyboardCandle.close, valueFormat)}`
          : ""}
      </p>

      <div className="market-chart-meta">
        <span>드래그 이동 · 휠/핀치 확대</span>
        <a href="https://www.tradingview.com/" rel="noreferrer" target="_blank">
          TradingView Lightweight Charts™ · Copyright (c) 2025 TradingView, Inc.
        </a>
      </div>
    </div>
  );
}
