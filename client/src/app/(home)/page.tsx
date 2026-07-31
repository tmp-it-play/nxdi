import { AuthNavActions } from "@/app/components/auth-actions";
import { RiskBadge } from "@/app/components/risk-badge";
import { PaginatedList } from "@/app/components/client-pagination";
import { DividendForecastView } from "@/app/components/dividend-forecast-view";
import { DisclosureTradeSummary } from "@/app/components/disclosure-trades";
import { IntentLink } from "@/app/components/intent-link";
import { SparkLineChart } from "@/app/components/stock-chart";
import { ToastStack } from "@/app/components/toast";
import {
  AppShell,
  ButtonLink,
  CompositionChart,
  Grid,
  List,
  ListRow,
  Metric,
  Navigation,
  Panel,
  RowMeta,
  SectionHeader,
  TextLink,
  Top,
  type CompositionChartItem
} from "@/app/components/tds";
import { getHome } from "@/lib/api";
import { FLASH_COOKIE_NAME, getFlashMessages } from "@/lib/flash";
import { formatDateTime, formatKrw, formatNumber } from "@/lib/format";
import { stockFullLabel, stockPrimaryLabel, stockSecondaryLabel } from "@/lib/stock-display";

const HOME_HOLDINGS_PAGE_SIZE = 8;
const PORTFOLIO_CHART_TOP_HOLDINGS = 19;

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

export default async function Home() {
  const [home, flashMessages] = await Promise.all([getHome(), getFlashMessages()]);
  const {
    user,
    isAdmin,
    portfolio,
    scheduledDividend,
    portfolioDividend,
    disclosures,
    portfolioDailyChangeRate,
    portfolioDailyPoints,
    holdingReturnPoints,
    dividendYieldPoints,
    holdingCharts
  } = home;
  const currentDividendYield = portfolioDividend.dividendYield;
  const sortedPortfolioAllocation = [...portfolio.holdings]
    .filter((holding) => holding.marketValueKrw > 0)
    .sort((a, b) => b.marketValueKrw - a.marketValueKrw || a.symbol.localeCompare(b.symbol));
  const otherPortfolioAllocation = sortedPortfolioAllocation.slice(PORTFOLIO_CHART_TOP_HOLDINGS);
  const portfolioAllocation: CompositionChartItem[] = sortedPortfolioAllocation
    .slice(0, PORTFOLIO_CHART_TOP_HOLDINGS)
    .map((holding) => ({
      id: holding.symbol,
      label: stockPrimaryLabel(holding),
      description: stockSecondaryLabel(holding),
      href: `/stocks/${encodeURIComponent(holding.symbol)}`,
      value: holding.marketValueKrw
    }));
  if (otherPortfolioAllocation.length > 0) {
    portfolioAllocation.push({
      id: "__other__",
      label: "기타",
      description: `${otherPortfolioAllocation.length}개 종목 합산`,
      href: undefined,
      value: otherPortfolioAllocation.reduce((sum, holding) => sum + holding.marketValueKrw, 0)
    });
  }
  return (
    <AppShell className="home-shell">
      <ToastStack messages={flashMessages} clearCookieName={FLASH_COOKIE_NAME} />

      <Navigation
        actions={<AuthNavActions user={user} isAdmin={isAdmin} />}
      />

      <Top
        title="NXDI 포트폴리오"
        description="공개 포트폴리오의 평가금액, 수익률, 배당수익률을 확인하고 참여 의향을 남길 수 있습니다."
        actions={
          <>
            <ButtonLink href="/product" variant="secondary">
              상품 설명
            </ButtonLink>
            <ButtonLink href="/dividend-policy" variant="secondary">
              배당 정책
            </ButtonLink>
            <ButtonLink href="/disclosures#roadmap" variant="secondary">
              공시
            </ButtonLink>
            <ButtonLink href="/simulation" variant="secondary">
              투자 시뮬레이션
            </ButtonLink>
            <IntentLink signedIn={Boolean(user)} />
          </>
        }
      />

      <Grid columns={4} className="mt-16">
        <Metric label="포트폴리오 평가금액" value={formatKrw(portfolio.totalMarketValueKrw)} />
        <Metric
          label={<TextLink className="metric-card-link" href="/metrics/daily-change">오늘 등락률</TextLink>}
          value={
            <div className="metric-detail">
              <RatePill value={portfolioDailyChangeRate} />
              <TextLink className="chart-link" href="/metrics/daily-change">
                <SparkLineChart
                  interactive={false}
                  label="포트폴리오 1년 평가금액 추세"
                  points={portfolioDailyPoints}
                  trendValue={portfolioDailyChangeRate}
                  valueFormat="krw"
                />
              </TextLink>
            </div>
          }
        />
        <Metric
          label={<TextLink className="metric-card-link" href="/metrics/holding-return">보유 수익률</TextLink>}
          value={
            <div className="metric-detail">
              <RatePill value={portfolioDividend.totalReturnRate} />
              <TextLink className="chart-link" href="/metrics/holding-return">
                <SparkLineChart
                  interactive={false}
                  label="보유 수익률 추세"
                  points={holdingReturnPoints}
                  trendValue={portfolioDividend.totalReturnRate}
                  valueFormat="percent"
                />
              </TextLink>
            </div>
          }
        />
        <Metric
          label={<TextLink className="metric-card-link" href="/metrics/dividend-yield">배당수익률</TextLink>}
          value={
            <div className="metric-detail">
              <RatePill value={currentDividendYield} />
              <TextLink className="chart-link" href="/metrics/dividend-yield">
                <SparkLineChart
                  interactive={false}
                  label="배당수익률 추세"
                  points={dividendYieldPoints}
                  trendValue={currentDividendYield}
                  valueFormat="percent"
                />
              </TextLink>
            </div>
          }
        />
      </Grid>

      <SectionHeader
        id="portfolio-section"
        title="현재 포트폴리오"
        description={`마지막 갱신 ${formatDateTime(portfolio.fetchedAt)} · USD/KRW ${formatNumber(portfolio.exchangeRate, 2)}원`}
      />

      <div className="home-dashboard-grid">
        <aside className="home-dashboard-aside">
          <Panel className="tds-composition-panel">
            <h2>구성 종목 비중</h2>
            <CompositionChart
              emptyText="포트폴리오 데이터 없음"
              items={portfolioAllocation}
              label="포트폴리오 구성 종목 비중"
            />
          </Panel>

          <section>
            <SectionHeader
              title="최근 공시"
              description="운영 변경과 첨부 거래 이력을 확인합니다."
              actions={<TextLink href="/disclosures">전체 공시</TextLink>}
            />

            <List className="disclosure-list">
              {disclosures.map((disclosure) => (
                <ListRow
                  key={disclosure.id}
                  title={<TextLink href={`/disclosures/${disclosure.id}`}>{disclosure.title}</TextLink>}
                  description={disclosure.body.slice(0, 96) + (disclosure.body.length > 96 ? "..." : "")}
                  value={<TextLink href={`/disclosures/${disclosure.id}`}>상세</TextLink>}
                >
                  <RowMeta>{formatDateTime(disclosure.createdAt)}</RowMeta>
                  <DisclosureTradeSummary trades={disclosure.trades} />
                </ListRow>
              ))}
              {disclosures.length === 0 ? (
                <ListRow title="등록된 공시가 없습니다." description="공시가 등록되면 이 영역에 표시됩니다." />
              ) : null}
            </List>
          </section>
        </aside>

        <div className="home-dashboard-main">
          <PaginatedList
            className="home-holdings-list"
            label="포트폴리오 종목 페이지"
            pageSize={HOME_HOLDINGS_PAGE_SIZE}
          >
            {portfolio.holdings.map((holding) => {
              const chart = holdingCharts[holding.symbol];
              const href = `/stocks/${encodeURIComponent(holding.symbol)}`;
              const secondaryLabel = stockSecondaryLabel(holding);
              const dailyChangeRate = chart?.dailyChangeRate;

              return (
                <ListRow
                  key={holding.symbol}
                  title={
                    <span className="holding-title-with-risk">
                      <TextLink href={href}>{stockPrimaryLabel(holding)}</TextLink>
                      <RiskBadge level={holding.riskLevel} />
                    </span>
                  }
                  description={`${secondaryLabel ? `${secondaryLabel} · ` : ""}${formatNumber(holding.quantity, 4)}주 · 원화 보유 수익률 ${formatPercent(holding.profitLossRate)}`}
                  value={
                    <div className="holding-row-value">
                      <TextLink className="chart-link" href={href}>
                        <SparkLineChart
                          interactive={false}
                          label={`${stockFullLabel(holding)} 최근 1년 가격 추세`}
                          points={chart?.points ?? []}
                          trendValue={dailyChangeRate}
                          valueFormat={holding.currency === "USD" ? "usd" : "krw"}
                        />
                      </TextLink>
                      <div className="holding-row-price">
                        <span>{formatKrw(holding.marketValueKrw)}</span>
                        <RatePill value={dailyChangeRate} />
                      </div>
                    </div>
                  }
                />
              );
            })}
          </PaginatedList>

          <section>
            <SectionHeader title="예정 배당" description="현재 펀드 보유 수량 기준으로 예정 배당을 월별 또는 종목별로 확인합니다." />

            <Grid columns={3} className="scheduled-dividend-summary">
              <Metric label="연 예정 배당" value={formatOptionalKrw(scheduledDividend.annualDividendKrw)} />
              <Metric label="월평균 예정 배당" value={formatOptionalKrw(scheduledDividend.monthlyAverageKrw)} />
              <Metric label="현재 배당수익률" value={formatPercent(currentDividendYield)} />
            </Grid>

            <DividendForecastView lines={scheduledDividend.lines} mode="holding" />
          </section>
        </div>
      </div>
    </AppShell>
  );
}
