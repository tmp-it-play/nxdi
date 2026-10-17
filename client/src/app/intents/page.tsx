import { promises as fs } from "fs";
import path from "path";
import { ArrowDownToLine, ArrowUpRight, LockKeyhole } from "lucide-react";
import { AuthNavActions, DataGsmLoginButton } from "@/app/components/auth-actions";
import { ApiMutationForm } from "@/app/components/api-mutation-form";
import { ContactInput } from "@/app/components/contact-input";
import { FormattedNumberInput } from "@/app/components/formatted-number-input";
import { ToastStack, type ToastMessage } from "@/app/components/toast";
import {
  AppShell,
  Badge,
  CtaPanel,
  Empty,
  Field,
  Grid,
  List,
  ListRow,
  Navigation,
  Notice,
  Panel,
  RowMeta,
  SectionHeader,
  Top
} from "@/app/components/tds";
import { getMyIntents } from "@/lib/api";
import { formatDateTime, formatKrw, formatNumber, statusLabel } from "@/lib/format";
import { FLASH_COOKIE_NAME, getFlashMessages } from "@/lib/flash";
import type { PayoutMode } from "@/lib/types";
import { TermsAgreement } from "./TermsAgreement";

const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  TOTAL_RETURN: "토탈 리턴",
  MONTHLY_CASH: "월 현금 지급"
};

function statusClass(status: string): "accepted" | "rejected" | "pending" {
  if (status === "COMPLETED") return "accepted";
  if (status === "REJECTED" || status === "WITHDRAWN") return "rejected";
  return "pending";
}

async function readProductDescription() {
  const filePath = path.join(process.cwd(), "content", "product-description.md");
  return fs.readFile(filePath, "utf8");
}

async function readDividendPolicy() {
  const filePath = path.join(process.cwd(), "content", "dividend-policy.md");
  return fs.readFile(filePath, "utf8");
}

function IntentGate({ messages }: { messages: ToastMessage[] }) {
  return (
    <AppShell>
      <ToastStack messages={messages} clearCookieName={FLASH_COOKIE_NAME} />

      <Navigation
        actions={<AuthNavActions user={null} />}
      />

      <Top
        title="로그인이 필요해요"
        description="투자·출금 의향서는 DataGSM 인증 후 작성할 수 있습니다."
        backLink={{ href: "/" }}
      />

      <Notice>
        이 화면의 제출과 완료·거절 상태는 의향 관리 기능이며 계약 체결, 입금 승인, 실제 투자원금 또는 분배금의 법적 권리를 만들지 않습니다.
      </Notice>

      <CtaPanel className="max-w-gate">
        <h2>
          <LockKeyhole size={18} /> DataGSM 인증 필요
        </h2>
        <p className="lede">
          DataGSM으로 로그인한 뒤 의향서를 작성하고 제출 내역을 확인할 수 있습니다.
        </p>
        <DataGsmLoginButton />
      </CtaPanel>
    </AppShell>
  );
}

export default async function IntentsPage() {
  const [data, flashMessages] = await Promise.all([getMyIntents(), getFlashMessages()]);
  if (!data) return <IntentGate messages={flashMessages} />;
  const { user, store, payoutMode, totalReturnAccruedKrw, withdrawalReference, investmentAvailability, policy } = data;

  const [termsMarkdown, dividendPolicyMarkdown] = await Promise.all([
    readProductDescription(),
    readDividendPolicy()
  ]);
  const myInvestments = store.investmentIntents;
  const myWithdrawals = store.withdrawalIntents;
  const myIntents = [...myInvestments, ...myWithdrawals];
  const canRequestWithdrawal = withdrawalReference.maxRequestIntentKrw > 0;
  const isInvestmentPaused = investmentAvailability.isPaused;
  const investmentLimitPercent = formatNumber(policy.externalInvestmentLimitRate * 100, 0);

  return (
    <AppShell>
      <ToastStack messages={flashMessages} clearCookieName={FLASH_COOKIE_NAME} />

      <Navigation
        actions={<AuthNavActions user={user} />}
      />

      <Top
        backLink={{ href: "/", label: "포트폴리오" }}
        title="의향서 작성"
        description="투자·출금 의향을 제출할 수 있습니다. 관리자가 완료한 금액만 배당 계산에 반영됩니다."
      />

      <SectionHeader title="의향서 제출" description="연락처에는 전화번호 또는 이메일을 입력해주세요." />

      <Grid columns={2}>
        <Panel>
          <h2>
            <ArrowUpRight size={18} /> 투자 의향서
          </h2>
          <p className="lede">
            의향 금액은 1회 기준 최소 {formatKrw(policy.minInvestmentKrw)}부터 최대 {formatKrw(policy.maxInvestmentKrw)}까지 제출할 수 있습니다.
          </p>
          <ApiMutationForm action="/api/intents/invest" className="form" method="post" resetOnSuccess>
            <Field htmlFor="investAmount" label="의향 금액 (원화)">
              <FormattedNumberInput
                id="investAmount"
                max={policy.maxInvestmentKrw}
                min={policy.minInvestmentKrw}
                name="amountKrw"
                placeholder="예: 100,000"
                required
              />
              <p className="field-help">
                원화 기준 {formatKrw(policy.minInvestmentKrw)} 이상 {formatKrw(policy.maxInvestmentKrw)} 이하이며, 입력 중 쉼표가 자동으로 표시됩니다.
              </p>
            </Field>
            <Field htmlFor="depositorName" label="입금자명">
              <input id="depositorName" name="depositorName" defaultValue={user.name} required />
            </Field>
            <Field htmlFor="investContact" label="전화번호 또는 이메일">
              <ContactInput id="investContact" name="contact" placeholder="010-0000-0000 또는 name@example.com" required />
            </Field>
            {payoutMode ? (
              <Field htmlFor="investPayoutMode" label="배당 수령 방식">
                <input id="investPayoutMode" readOnly value={PAYOUT_MODE_LABELS[payoutMode]} />
                <p className="field-help">수령 방식은 계정별로 적용되며, 변경은 관리자에게 문의해 주세요.</p>
              </Field>
            ) : (
<div className="field">
                <span className="field-label" id="investPayoutModeLabel">배당 수령 방식</span>
                <div className="payout-mode-toggle" role="radiogroup" aria-labelledby="investPayoutModeLabel">
                  <label>
                    <input defaultChecked name="payoutMode" type="radio" value="TOTAL_RETURN" />
                    <span>{PAYOUT_MODE_LABELS.TOTAL_RETURN}</span>
                  </label>
                  <label>
                    <input name="payoutMode" type="radio" value="MONTHLY_CASH" />
                    <span>{PAYOUT_MODE_LABELS.MONTHLY_CASH}</span>
                  </label>
                </div>
                <p className="field-help">
                  토탈 리턴은 배분액을 다음 달부터 원금에 편입하고, 월 현금 지급은 매월 현금 지급 상한 범위에서 지급합니다.
                </p>
              </div>
            )}
            <TermsAgreement markdown={termsMarkdown} />
            <TermsAgreement
              markdown={dividendPolicyMarkdown}
              modalDescription="투자 의향서 제출 전 확인해야 하는 배당 산정 원문입니다."
              name="dividendPolicyAgreed"
              title="배당 정책"
              label="을 읽었고 배당금이 보장되지 않는다는 점에 동의합니다."
            />
            <Field htmlFor="investNote" label="메모">
              <textarea id="investNote" name="note" />
            </Field>
            {isInvestmentPaused ? (
              <Notice className="compact-notice">
                완료된 외부 투자 의향 합계가 현재 포트폴리오 평가금액의 {investmentLimitPercent}%를 초과해 신규 접수를 일시 중단했습니다.
              </Notice>
            ) : null}
            <button
              className={isInvestmentPaused ? "investment-intake-paused" : undefined}
              disabled={isInvestmentPaused}
              type="submit"
            >
              {isInvestmentPaused ? "외부 투자 접수 일시 중단" : "제출"}
            </button>
          </ApiMutationForm>
        </Panel>

        <Panel>
          <h2>
            <ArrowDownToLine size={18} /> 출금 의향서
          </h2>
          <p className="lede">
            완료된 투자 의향 잔액 범위에서 출금 의향을 제출할 수 있습니다.
            {totalReturnAccruedKrw > 0 ? ` 토탈 리턴 누적 편입액 ${formatKrw(totalReturnAccruedKrw)}이 포함됩니다.` : null}
          </p>
          <ApiMutationForm action="/api/intents/withdraw" className="form" method="post" resetOnSuccess>
            <Field htmlFor="withdrawAmount" label="출금 의향 금액 (원화)">
              <FormattedNumberInput
                disabled={!canRequestWithdrawal}
                id="withdrawAmount"
                max={withdrawalReference.maxRequestIntentKrw}
                min="1"
                name="amountKrw"
                required
              />
            </Field>
            {!canRequestWithdrawal ? (
              <Notice className="compact-notice">현재 완료된 투자 의향 잔액이 없습니다.</Notice>
            ) : null}
            <Field htmlFor="bankName" label="은행">
              <input disabled={!canRequestWithdrawal} id="bankName" name="bankName" required />
            </Field>
            <Field htmlFor="accountNumber" label="계좌번호">
              <input disabled={!canRequestWithdrawal} id="accountNumber" inputMode="numeric" name="accountNumber" required />
            </Field>
            <Field htmlFor="accountHolder" label="예금주">
              <input disabled={!canRequestWithdrawal} id="accountHolder" name="accountHolder" defaultValue={user.name} required />
            </Field>
            <Field htmlFor="withdrawContact" label="전화번호 또는 이메일">
              <ContactInput
                disabled={!canRequestWithdrawal}
                id="withdrawContact"
                name="contact"
                placeholder="010-0000-0000 또는 name@example.com"
                required
              />
            </Field>
            <Field htmlFor="withdrawNote" label="메모">
              <textarea disabled={!canRequestWithdrawal} id="withdrawNote" name="note" />
            </Field>
            <TermsAgreement markdown={termsMarkdown} disabled={!canRequestWithdrawal} />
            <button disabled={!canRequestWithdrawal} type="submit">제출</button>
          </ApiMutationForm>
        </Panel>
      </Grid>

      <SectionHeader title="내 제출 내역" description="투자·출금 의향서의 처리 상태를 확인합니다." />

      <List>
        {myIntents.map((intent) => (
          <ListRow
            key={intent.id}
            title={intent.type === "INVESTMENT" ? "투자 의향" : "출금 의향"}
            description={formatDateTime(intent.createdAt)}
            value={
              <>
                {formatKrw(intent.amountKrw)}
                <RowMeta>
                  <Badge tone={statusClass(intent.status)}>{statusLabel(intent.status)}</Badge>
                  {intent.status === "PENDING" || intent.status === "COMPLETED" ? (
                    <ApiMutationForm action="/api/intents/cancel" method="post">
                      <input name="type" type="hidden" value={intent.type} />
                      <input name="id" type="hidden" value={intent.id} />
                      <button className="ghost" type="submit">의향 철회</button>
                    </ApiMutationForm>
                  ) : null}
                </RowMeta>
              </>
            }
          />
        ))}
        {myIntents.length === 0 ? <Empty>제출 내역이 없습니다.</Empty> : null}
      </List>
    </AppShell>
  );
}
