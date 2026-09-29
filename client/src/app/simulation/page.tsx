import { RefreshCw } from "lucide-react";
import { AuthNavActions } from "@/app/components/auth-actions";
import { DividendForecastView } from "@/app/components/dividend-forecast-view";
import { FormattedNumberInput } from "@/app/components/formatted-number-input";
import {
  AppShell,
  ButtonLink,
  CtaPanel,
  Field,
  Form,
  Grid,
  List,
  ListRow,
  Navigation,
  SectionHeader,
  Top
} from "@/app/components/tds";
import { getSimulation } from "@/lib/api";
import { formatKrw, formatNumber } from "@/lib/format";

type SimulationPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${formatNumber(value * 100, 2)}%`;
}

function formatOptionalKrw(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? formatKrw(value) : "-";
}

export default async function SimulationPage({ searchParams }: SimulationPageProps) {
  const params = (await searchParams) ?? {};
  const requestedAmount = Number(firstParam(params.amountKrw) ?? 100000);
  const simulation = await getSimulation(requestedAmount);
  const {
    user,
    amount: normalizedAmount,
    forecast,
    annualPortfolioDividendYield,
    expectedPayout,
    policy
  } = simulation;

  return (
    <AppShell>
      <Navigation
        actions={<AuthNavActions user={user} />}
      />

      <Top
        title="투자 의향 배당 시뮬레이션"
        description="현재 운용종목과 완료된 투자·출금 의향 잔액을 참고해 정책 적용 예상치를 계산합니다. 의향이나 계산값은 계약·원금·지급권을 만들지 않습니다."
        backLink={{ href: "/" }}
        actions={
          <ButtonLink href="#forecast-section">
            결과 보기
          </ButtonLink>
        }
      />

      <SectionHeader title="정책 적용 참고 예상액" description={`운용보수 ${formatPercent(policy.managementFeeRate)}를 반영하고 세금·외부 비용은 반영하지 않은 비구속적 가정값입니다.`} />

      <Grid columns={2}>
        <CtaPanel>
          <Form method="get">
            <Field htmlFor="amountKrw" label="가정 투자금 (원화)">
              <FormattedNumberInput
                defaultValue={normalizedAmount}
                id="amountKrw"
                max={policy.maxInvestmentKrw}
                min={policy.minInvestmentKrw}
                name="amountKrw"
                placeholder="예: 100,000"
                required
              />
              <p className="field-help">
                {formatKrw(policy.minInvestmentKrw)} 이상 {formatKrw(policy.maxInvestmentKrw)} 이하로 입력하면 쉼표가 자동으로 표시됩니다.
              </p>
            </Field>
            <button type="submit">
              <RefreshCw size={17} />
              다시 계산
            </button>
          </Form>
        </CtaPanel>

        <List>
          <ListRow
            title="정책 적용 연 예상 지급액"
            description="월별 예상 지급액을 12개월로 단순 환산한 세전 금액"
            value={formatOptionalKrw(expectedPayout?.annualExpectedDividendKrw)}
          />
          <ListRow
            title="정책 적용 월평균 지급액"
            description={`실배당 기반 배분, 당사 몫 ${formatPercent(policy.companyDividendTransferRate)} 이전 및 월 ${formatPercent(policy.monthlyInvestorDividendCapRate)} 상한 적용`}
            value={formatOptionalKrw(expectedPayout?.monthlyExpectedDividendKrw)}
          />
          <ListRow
            title="정책 적용 예상 지급수익률"
            description={`가정 투자금 대비 연 예상 지급액, 단순 연 상한 ${formatPercent(policy.annualInvestorDividendCapRate)}`}
            value={formatPercent(expectedPayout?.expectedAnnualPayoutRate)}
          />
          <ListRow
            title="포트폴리오 원배당수익률"
            description="정책 배분 전 보유 종목의 연 예상 배당 기준"
            value={formatPercent(annualPortfolioDividendYield)}
          />
        </List>
      </Grid>

      <SectionHeader
        id="forecast-section"
        title="포트폴리오 원배당 전망"
        description="정책 배분 전 가정 투자금의 종목별 예상 배당입니다. 실제 지급액은 위 정책 적용 결과를 확인하세요."
      />

      <DividendForecastView lines={forecast.lines} />
    </AppShell>
  );
}
