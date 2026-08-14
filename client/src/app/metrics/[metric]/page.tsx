import { notFound } from "next/navigation";
import { AuthNavActions } from "@/app/components/auth-actions";
import { CandleChart } from "@/app/components/candle-chart";
import {
  AppShell,
  Grid,
  List,
  ListRow,
  Metric,
  Navigation,
  SectionHeader,
  TextLink,
  Top
} from "@/app/components/tds";
import { getMetric } from "@/lib/api";
import { formatKrw, formatNumber } from "@/lib/format";

type MetricDetailProps = {
  params: Promise<{
    metric: string;
  }>;
};

const METRIC_LABELS = {
  "daily-change": {
    title: "오늘 등락률",
    description: "현재 포트폴리오 평가금액과 보유 종목 전일 종가 합산액 기준으로 흐름을 보여줍니다."
  },
  "holding-return": {
    title: "보유 수익률",
    description: "일별 확정 평가금액과 매입환율 반영 원화 원가 기준으로 흐름을 보여줍니다."
  },
  "dividend-yield": {
    title: "배당수익률",
    description: "과거 월 실 배당금과 이번 달 예상 배당금 기준으로 흐름을 보여줍니다."
  }
} as const;

type MetricSlug = keyof typeof METRIC_LABELS;

function isMetricSlug(value: string): value is MetricSlug {
  return value in METRIC_LABELS;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${formatNumber(value * 100, 2)}%`;
}

function formatOptionalKrw(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? formatKrw(value) : "-";
}

function rateTone(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function RatePill({ value }: { value?: number }) {
  return <span className={`rate-pill ${rateTone(value)}`}>{formatPercent(value)}</span>;
}

export default async function MetricDetailPage({ params }: MetricDetailProps) {
  const { metric } = await params;
  if (!isMetricSlug(metric)) notFound();
  const result = await getMetric(metric);
  if (!result) notFound();
  const { user, portfolioDividend, candles, currentRate, totalMarketValueKrw } = result;
  const currentDividendYield = portfolioDividend.dividendYield;
  const valueFormat = metric === "daily-change" ? "krw" : "percent";
  const labels = METRIC_LABELS[metric];
  const linkedMetricTitle = (target: MetricSlug) =>
    metric === target ? (
      METRIC_LABELS[target].title
    ) : (
      <TextLink href={`/metrics/${target}`}>{METRIC_LABELS[target].title}</TextLink>
    );

  return (
    <AppShell>
      <Navigation
        actions={<AuthNavActions user={user} />}
      />

      <Top title={labels.title} description={labels.description} backLink={{ href: "/" }} />

      <Grid columns={4} className="mt-16">
        <Metric label="현재 지표" value={<RatePill value={currentRate} />} />
        <Metric label="평가금액" value={formatKrw(totalMarketValueKrw)} />
        <Metric label="매입원금" value={formatOptionalKrw(portfolioDividend.costBasisKrw)} />
        <Metric
          label="연 예상 배당"
          value={formatOptionalKrw(portfolioDividend.annualDividendKrw)}
        />
      </Grid>

      <SectionHeader title="세부 차트" />

      <CandleChart
        candles={candles}
        label={`${labels.title} 세부 차트`}
        size="detail"
        valueFormat={valueFormat}
        dateGranularity={metric === "dividend-yield" ? "month" : "day"}
      />

      <SectionHeader title="계산 기준" description="관리자 포트폴리오, 시장 가격, 일별 평가금액 스냅샷을 조합한 값입니다." />

      <List>
        {metric === "daily-change" ? (
          <ListRow
            title={linkedMetricTitle("daily-change")}
            description="현재 보유 평가금액 총합과 보유 종목별 전일 종가 기준 평가금액 총합 비교"
            value={<RatePill value={currentRate} />}
          />
        ) : null}
        <ListRow
          title={linkedMetricTitle("holding-return")}
          description="현재 평가금액과 매입환율이 반영된 원화 매입원금 기준"
          value={<RatePill value={portfolioDividend.totalReturnRate} />}
        />
        <ListRow
          title={linkedMetricTitle("dividend-yield")}
          description="과거 월 실 배당 기록의 연환산액 또는 현재 연 예상 배당금을 평가금액으로 나눈 값"
          value={<RatePill value={currentDividendYield} />}
        />
      </List>
    </AppShell>
  );
}
