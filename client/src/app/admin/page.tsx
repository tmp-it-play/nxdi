import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import { AdminHoldingForm } from "./AdminHoldingForm";
import { DisclosureForm } from "./DisclosureForm";
import { DividendAllocationCalculator } from "./DividendAllocationCalculator";
import { MonthlyDividendRecordForm } from "./MonthlyDividendRecordForm";
import { NotificationManager } from "./notifications/NotificationManager";
import { ApiMutationForm } from "@/app/components/api-mutation-form";
import { AuthNavActions, DataGsmLoginButton } from "@/app/components/auth-actions";
import { PaginatedPanelTable } from "@/app/components/client-pagination";
import { RoadmapEditor } from "@/app/components/roadmap-editor";
import { ToastStack } from "@/app/components/toast";
import {
  AppShell,
  Badge,
  CtaPanel,
  Grid,
  Metric,
  MutedText,
  Navigation,
  Panel,
  SectionHeader,
  TdsSelect,
  Top
} from "@/app/components/tds";
import { getAdminDashboard, getAdminNotifications, getSession } from "@/lib/api";
import { FLASH_COOKIE_NAME, getFlashMessages } from "@/lib/flash";
import { formatCurrency, formatDateTime, formatKrw, formatNumber, statusLabel } from "@/lib/format";
import { stockPrimaryLabel, stockSecondaryLabel } from "@/lib/stock-display";
import type { AppUser, IntentStatus } from "@/lib/types";

const ADMIN_DISCLOSURES_PAGE_SIZE = 8;
const ADMIN_PORTFOLIO_PAGE_SIZE = 8;
const ADMIN_DIVIDEND_PAGE_SIZE = 8;
const ADMIN_DETACHED_DIVIDEND_PAGE_SIZE = 8;
const ADMIN_MONTHLY_DIVIDEND_PAGE_SIZE = 12;
const ADMIN_INTENTS_PAGE_SIZE = 10;

function statusClass(status: string): "accepted" | "rejected" | "pending" {
  if (status === "COMPLETED") return "accepted";
  if (status === "REJECTED" || status === "WITHDRAWN") return "rejected";
  return "pending";
}

function formatDividendAmount(value: number, currency: "KRW" | "USD") {
  return formatCurrency(value, currency, 4);
}

function formatDividendMonth(value: string) {
  const [year, month] = value.split("-");
  return `${year}년 ${Number(month)}월`;
}

function StatusForm({
  type,
  id,
  current
}: {
  type: "INVESTMENT" | "WITHDRAWAL";
  id: string;
  current: IntentStatus;
}) {
  if (current === "WITHDRAWN") return <Badge tone="rejected">신청자 철회</Badge>;
  return (
    <ApiMutationForm className="split-actions" action="/api/admin/status" method="post">
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="id" value={id} />
      <TdsSelect name="status" defaultValue={current} aria-label="상태">
        <option value="PENDING">대기</option>
        <option value="COMPLETED">완료</option>
        <option value="REJECTED">거절</option>
      </TdsSelect>
      <button className="secondary" type="submit">
        저장
      </button>
    </ApiMutationForm>
  );
}

function AdminGate({ user }: { user: AppUser | null }) {
  const signedIn = Boolean(user);

  return (
    <AppShell>
      <Navigation
        actions={<AuthNavActions user={user} />}
      />

      <Top
        title="관리자 권한이 필요해요"
        description="DataGSM 인증 계정이 관리자 목록에 포함되어 있어야 운영 화면에 접근할 수 있습니다."
        backLink={{ href: "/" }}
      />

      <CtaPanel className="max-w-gate">
        <h2>
          <LockKeyhole size={18} /> 관리자 권한 필요
        </h2>
        <p className="lede">
          {signedIn
            ? "현재 DataGSM 계정 이메일은 관리자 환경변수에 포함되어 있지 않습니다."
            : "DataGSM으로 로그인한 뒤, 이메일이 ADMIN_EMAILS에 포함된 계정만 접근할 수 있습니다."}
        </p>
        {!signedIn ? (
          <DataGsmLoginButton />
        ) : null}
      </CtaPanel>
    </AppShell>
  );
}

export default async function AdminPage() {
  const dashboard = await getAdminDashboard();
  if (!dashboard) {
    const { user } = await getSession();
    return <AdminGate user={user} />;
  }
  const {
    user,
    store,
    portfolio,
    dividendRecords,
    monthlyDividendRecords,
    disclosures,
    roadmapEvents,
    roadmapToday,
    dividendPrincipalsByMonth,
    policy
  } = dashboard;
  const flashMessages = await getFlashMessages();
  const notifications = await getAdminNotifications().catch(() => null);
  const completedInvestment = store.investmentIntents
    .filter((intent) => intent.status === "COMPLETED")
    .reduce((sum, intent) => sum + intent.amountKrw, 0);
  const completedWithdrawal = store.withdrawalIntents
    .filter((intent) => intent.status === "COMPLETED")
    .reduce((sum, intent) => sum + intent.amountKrw, 0);
  const dividendRecordsBySymbol = new Map(
    dividendRecords.map((record) => [record.symbol.toUpperCase(), record])
  );
  const portfolioSymbols = new Set(portfolio.holdings.map((holding) => holding.symbol.toUpperCase()));
  const detachedDividendRecords = dividendRecords.filter(
    (record) => !portfolioSymbols.has(record.symbol.toUpperCase())
  );
  return (
    <AppShell>
      <ToastStack messages={flashMessages} clearCookieName={FLASH_COOKIE_NAME} />

      <Navigation
        actions={<AuthNavActions user={user} />}
      />

      <Top
        title="운영 관리"
        backLink={{ href: "/" }}
      />

      <Grid columns={4} className="mt-16">
        <Metric label="완료 투자 의향" value={formatKrw(completedInvestment)} />
        <Metric label="완료 출금 의향" value={formatKrw(completedWithdrawal)} />
        <Metric label="실배당 기록" value={`${monthlyDividendRecords.length}개월`} />
        <Metric label="포트폴리오 평가액" value={formatKrw(portfolio.totalMarketValueKrw)} />
      </Grid>

      <RoadmapEditor
        disclosures={disclosures}
        events={roadmapEvents}
        today={roadmapToday}
      />

      <SectionHeader
        id="admin-disclosures"
        title="공시"
      />

      <PaginatedPanelTable
          colSpan={4}
          emptyText="등록된 공시가 없습니다."
          header={
            <tr>
              <th>제목</th>
              <th>첨부 거래</th>
              <th>등록일</th>
              <th>관리</th>
            </tr>
          }
          label="관리자 공시 페이지"
          panelHeader={
            <div className="admin-panel-header">
              <h2>공시 목록</h2>
              <DisclosureForm />
            </div>
          }
          pageSize={ADMIN_DISCLOSURES_PAGE_SIZE}
        >
          {disclosures.map((disclosure) => (
            <tr key={disclosure.id}>
              <td>
                <strong>{disclosure.title}</strong>
                <br />
                <MutedText>
                  {disclosure.body.slice(0, 80)}
                  {disclosure.body.length > 80 ? "..." : ""}
                </MutedText>
              </td>
              <td>{disclosure.trades.length}건</td>
              <td>{formatDateTime(disclosure.createdAt)}</td>
              <td>
                <div className="split-actions">
                  <DisclosureForm disclosure={disclosure} />
                  <ApiMutationForm action="/api/admin/disclosures/delete" method="post">
                    <input type="hidden" name="id" value={disclosure.id} />
                    <button className="ghost" type="submit">
                      삭제
                    </button>
                  </ApiMutationForm>
                </div>
              </td>
            </tr>
          ))}
        </PaginatedPanelTable>

      <SectionHeader
        id="admin-portfolio"
        title="운영 포트폴리오"
      />

      <PaginatedPanelTable
          className="portfolio-table mt-16"
          colSpan={2}
          emptyText="포트폴리오 종목이 없습니다."
          footerRows={
            <tr>
              <td colSpan={2}>
                <AdminHoldingForm />
              </td>
            </tr>
          }
          header={
            <tr>
              <th>종목</th>
              <th>평가금액</th>
            </tr>
          }
          label="운영 포트폴리오 페이지"
          panelHeader={
            <div className="admin-panel-header">
              <h2>보유 종목</h2>
              <Link
                aria-label="운영종목 보유확인서 발급"
                className="button secondary portfolio-certificate-link"
                href="/admin/portfolio/certificate"
                rel="noopener noreferrer"
                target="_blank"
              >
                보유확인서 발급
              </Link>
            </div>
          }
          pageSize={ADMIN_PORTFOLIO_PAGE_SIZE}
          search={{
            ariaLabel: "운영 포트폴리오 종목 검색",
            noResultsText: "일치하는 운영 종목이 없습니다.",
            placeholder: "종목 검색",
            texts: portfolio.holdings.map((holding) => [
              holding.symbol,
              holding.name,
              holding.alias,
              stockPrimaryLabel(holding),
              stockSecondaryLabel(holding)
            ].filter(Boolean).join(" "))
          }}
        >
          {portfolio.holdings.map((holding) => (
            <tr key={holding.symbol}>
              <td>
                <AdminHoldingForm {...holding} />
              </td>
              <td>{formatKrw(holding.marketValueKrw)}</td>
            </tr>
          ))}
        </PaginatedPanelTable>

      <SectionHeader
        id="admin-dividends"
        title="배당 데이터"
      />

      <PaginatedPanelTable
          className="dividend-table"
          colSpan={7}
          emptyText="포트폴리오 종목이 없습니다."
          header={
            <tr>
              <th>종목</th>
              <th>연 배당/주</th>
              <th>배당수익률</th>
              <th>지급월</th>
              <th>최근 배당</th>
              <th>동기화</th>
            </tr>
          }
          label="배당 데이터 페이지"
          panelHeader={<h2>종목별 배당</h2>}
          pageSize={ADMIN_DIVIDEND_PAGE_SIZE}
        >
          {portfolio.holdings.map((holding) => {
            const record = dividendRecordsBySymbol.get(holding.symbol.toUpperCase());
            const secondaryLabel = stockSecondaryLabel(holding);
            return (
              <tr key={holding.symbol}>
                <td>
                  <strong>{stockPrimaryLabel(holding)}</strong>
                  <br />
                  {secondaryLabel ? <MutedText>{secondaryLabel}</MutedText> : null}
                </td>
                <td>{record ? formatDividendAmount(record.annualDividendPerShare, record.currency) : "-"}</td>
                <td>{record?.trailingYield ? `${formatNumber(record.trailingYield * 100, 2)}%` : "-"}</td>
                <td>
                  {record?.expectedPaymentMonths.map((month) => `${month}월`).join(", ") ?? "-"}
                </td>
                <td>
                  {record?.lastDividendPerShare
                    ? formatDividendAmount(record.lastDividendPerShare, record.currency)
                    : "-"}
                </td>
                <td>
                  <ApiMutationForm action="/api/admin/dividends/sync" method="post">
                    <input type="hidden" name="symbol" value={holding.symbol} />
                    <button className="secondary" type="submit">
                      외부 동기화
                    </button>
                  </ApiMutationForm>
                </td>
              </tr>
            );
          })}
        </PaginatedPanelTable>

      {detachedDividendRecords.length > 0 ? (
        <PaginatedPanelTable
            className="dividend-table compact"
            colSpan={3}
            emptyText="포트폴리오 외 배당 데이터가 없습니다."
            header={
              <tr>
                <th>종목</th>
                <th>연 배당/주</th>
                <th>삭제</th>
              </tr>
            }
            id="admin-detached-dividends"
            label="포트폴리오 외 배당 데이터 페이지"
            panelClassName="mt-12"
            panelHeader={<h2>포트폴리오 외 배당 데이터</h2>}
            pageSize={ADMIN_DETACHED_DIVIDEND_PAGE_SIZE}
          >
            {detachedDividendRecords.map((record) => (
              <tr key={record.symbol}>
                <td>{record.symbol}</td>
                <td>{formatDividendAmount(record.annualDividendPerShare, record.currency)}</td>
                <td>
                  <ApiMutationForm action="/api/admin/dividends/delete" method="post">
                    <input type="hidden" name="symbol" value={record.symbol} />
                    <button className="ghost" type="submit">
                      삭제
                    </button>
                  </ApiMutationForm>
                </td>
              </tr>
            ))}
          </PaginatedPanelTable>
      ) : null}

      <SectionHeader
        id="admin-monthly-dividends"
        title="월별 실배당"
      />

      <PaginatedPanelTable
          className="monthly-dividend-table"
          colSpan={6}
          emptyText="등록된 월별 실배당 합계가 없습니다."
          footerRows={
            <tr>
              <td colSpan={6}>
                <MonthlyDividendRecordForm />
              </td>
            </tr>
          }
          header={
            <tr>
              <th>배당월</th>
              <th>실배당 합계</th>
              <th>기록 ID</th>
              <th>갱신일</th>
              <th>확인서</th>
              <th>삭제</th>
            </tr>
          }
          label="월별 실배당 합계 페이지"
          panelHeader={<h2>월별 실배당</h2>}
          pageSize={ADMIN_MONTHLY_DIVIDEND_PAGE_SIZE}
        >
          {monthlyDividendRecords.map((record) => (
              <tr key={record.dividendMonth}>
                <td>{formatDividendMonth(record.dividendMonth)}</td>
                <td>{formatKrw(record.actualDividendKrw)}</td>
                <td>{record.recordId}</td>
                <td>{formatDateTime(record.updatedAt)}</td>
                <td>
                  <Link
                    aria-label={`${formatDividendMonth(record.dividendMonth)} 운용수익 발생확인서 발급`}
                    className="button secondary monthly-dividend-certificate-link"
                    href={`/admin/dividends/monthly/${encodeURIComponent(record.recordId)}/certificate`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    발급
                  </Link>
                </td>
                <td>
                  <ApiMutationForm action="/api/admin/dividends/monthly/delete" method="post">
                    <input type="hidden" name="dividendMonth" value={record.dividendMonth} />
                    <button className="ghost" type="submit">
                      삭제
                    </button>
                  </ApiMutationForm>
                </td>
              </tr>
          ))}
        </PaginatedPanelTable>

      <NotificationManager initialData={notifications} />

      <SectionHeader
        id="admin-investments"
        title="투자 의향서"
      />

      <PaginatedPanelTable
          colSpan={9}
          emptyText="투자 의향서가 없습니다."
          header={
            <tr>
              <th>신청자</th>
              <th>금액</th>
              <th>입금자명</th>
              <th>연락처</th>
              <th>보호자</th>
              <th>배당 정책</th>
              <th>상태</th>
              <th>제출일</th>
              <th>변경</th>
            </tr>
          }
          label="투자 의향서 페이지"
          panelHeader={<h2>투자 의향서</h2>}
          pageSize={ADMIN_INTENTS_PAGE_SIZE}
        >
          {store.investmentIntents.map((intent) => (
            <tr key={intent.id}>
              <td>
                <strong>{intent.userName}</strong>
                <br />
                <MutedText>{intent.userEmail}</MutedText>
              </td>
              <td>{formatKrw(intent.amountKrw)}</td>
              <td>{intent.depositorName}</td>
              <td>{intent.contact}</td>
              <td>{intent.guardianConfirmed ? "확인 예정" : "미확인"}</td>
              <td>{intent.dividendPolicyAgreed ? "동의" : "미동의"}</td>
              <td>
                <Badge tone={statusClass(intent.status)}>{statusLabel(intent.status)}</Badge>
              </td>
              <td>{formatDateTime(intent.createdAt)}<br /><MutedText>{intent.productDocumentVersion && intent.dividendPolicyVersion ? `상품 v${intent.productDocumentVersion} · 분배 v${intent.dividendPolicyVersion}` : "기존 동의 증빙 없음"}</MutedText></td>
              <td>
                <StatusForm type="INVESTMENT" id={intent.id} current={intent.status} />
              </td>
            </tr>
          ))}
        </PaginatedPanelTable>

      <SectionHeader
        id="admin-withdrawals"
        title="출금 의향서"
        description="완료 금액은 배당 계산 원금에서 차감됩니다."
      />

      <PaginatedPanelTable
        colSpan={8}
        emptyText="출금 의향서가 없습니다."
        header={
          <tr>
            <th>신청자</th>
            <th>금액</th>
            <th>입금 계좌</th>
            <th>예금주</th>
            <th>연락처</th>
            <th>상태</th>
            <th>제출일</th>
            <th>변경</th>
          </tr>
        }
        label="출금 의향서 페이지"
        panelHeader={<h2>출금 의향서</h2>}
        pageSize={ADMIN_INTENTS_PAGE_SIZE}
      >
        {store.withdrawalIntents.map((intent) => (
          <tr key={intent.id}>
            <td><strong>{intent.userName}</strong><br /><MutedText>{intent.userEmail}</MutedText></td>
            <td>{formatKrw(intent.amountKrw)}</td>
            <td>{intent.bankName}<br /><MutedText>{intent.accountNumber}</MutedText></td>
            <td>{intent.accountHolder}</td>
            <td>{intent.contact}</td>
            <td><Badge tone={statusClass(intent.status)}>{statusLabel(intent.status)}</Badge></td>
            <td>{formatDateTime(intent.createdAt)}</td>
            <td>
              <StatusForm type="WITHDRAWAL" id={intent.id} current={intent.status} />
            </td>
          </tr>
        ))}
      </PaginatedPanelTable>

      <SectionHeader
        title="배당 계산"
      />

      <Panel>
        <h2>의향별 지급액</h2>
        <DividendAllocationCalculator
          defaultDividendMonth={monthlyDividendRecords[0]?.dividendMonth ?? roadmapToday.slice(0, 7)}
          companyDividendTransferRate={policy.companyDividendTransferRate}
          managementFeeRate={policy.managementFeeRate}
          principalsByMonth={dividendPrincipalsByMonth}
          monthlyDividendRecords={monthlyDividendRecords}
          monthlyInvestorDividendCapRate={policy.monthlyInvestorDividendCapRate}
          totalMarketValueKrw={portfolio.totalMarketValueKrw}
        />
      </Panel>
    </AppShell>
  );
}
