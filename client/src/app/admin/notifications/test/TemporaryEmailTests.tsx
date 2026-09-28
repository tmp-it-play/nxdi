"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Mail, Send } from "lucide-react";
import { FormattedNumberInput } from "@/app/components/formatted-number-input";
import { Field, Grid, Metric, Panel, SectionHeader, TdsSelect } from "@/app/components/tds";
import { formatDateTime, formatKrw } from "@/lib/format";
import type { NotificationType } from "@/lib/notification-types";
import { EmailBody } from "../EmailBody";
import { TEST_RECIPIENT, type TestEmailInput, type TestEmailOptions, type TestEmailPreview } from "./types";
import styles from "./test-email.module.css";

const BASE = "/api/admin/notifications";
const TYPE_LABELS: Record<NotificationType, string> = {
  DISCLOSURE: "새 공시",
  MONTHLY_PAYOUT: "월별 지급액",
  QUARTERLY_HOLDINGS: "분기 보유확인서"
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? `요청을 처리하지 못했습니다 (${response.status}).`);
  if (!payload) throw new Error("서버 응답을 확인하지 못했습니다. 이력을 새로고침해 주세요.");
  return payload as T;
}

function numericInput(value: string, label: string, minimum = 0) {
  if (!value.trim()) throw new Error(`${label}을 입력해 주세요. 0원도 직접 입력할 수 있습니다.`);
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < minimum) throw new Error(`${label}은 ${minimum}원 이상의 안전한 정수로 입력해 주세요.`);
  return amount;
}

export function TemporaryEmailTests({ initialData }: { initialData: TestEmailOptions }) {
  const [data, setData] = useState(initialData);
  const [type, setType] = useState<NotificationType>("DISCLOSURE");
  const [source, setSource] = useState<"sample" | "current">("sample");
  const [disclosureId, setDisclosureId] = useState(initialData.disclosures[0]?.id ?? "");
  const [dividendMonth, setDividendMonth] = useState(initialData.defaults.dividendMonth);
  const [totalMarketValueKrw, setTotalMarketValueKrw] = useState("");
  const [investmentKrw, setInvestmentKrw] = useState("");
  const [actualDividendKrw, setActualDividendKrw] = useState("");
  const [preview, setPreview] = useState<TestEmailPreview | null>(null);
  const [testQueued, setTestQueued] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const sendKeys = useRef<Record<string, string>>({});

  function invalidatePreview() {
    setPreview(null);
    setTestQueued(false);
  }

  async function run(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError("");
    setMessage("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다."); }
    finally { busyRef.current = false; setBusy(null); }
  }

  async function refreshOptions() {
    const result = await request<TestEmailOptions>(`${BASE}/tests/options`);
    setData(result);
    setSelectedDraftId((current) => result.drafts.some((draft) => draft.id === current) ? current : "");
  }

  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("미리보기 생성", async () => {
      let input: TestEmailInput;
      if (type === "MONTHLY_PAYOUT") {
        input = { type, dividendMonth,
          totalMarketValueKrw: numericInput(totalMarketValueKrw, "포트폴리오 총액", 1),
          investmentKrw: numericInput(investmentKrw, "테스트 투자금액"),
          actualDividendKrw: numericInput(actualDividendKrw, "월 실배당 합계") };
      } else if (type === "DISCLOSURE") {
        if (source === "current" && !disclosureId) throw new Error("테스트에 사용할 공시를 선택해 주세요.");
        input = { type, source, ...(source === "current" ? { disclosureId } : {}) };
      } else input = { type, source };
      setPreview(await request<TestEmailPreview>(`${BASE}/tests/preview`, input));
      setTestQueued(false);
      setMessage("미리보기를 저장했습니다. 내용을 확인하고 테스트 메일을 보낼 수 있습니다.");
      await refreshOptions();
    });
  }

  function sendKey(id: string) {
    return sendKeys.current[id] ??= crypto.randomUUID();
  }

  async function sendTest(id = preview?.id) {
    if (!id) return;
    await run("테스트 발송 요청", async () => {
      await request(`${BASE}/tests/${encodeURIComponent(id)}/send`, { requestKey: sendKey(id) });
      if (preview?.id === id) setTestQueued(true);
      setMessage("테스트 발송을 요청했습니다. SMTP 접수 여부는 이메일 알림 관리의 발송 이력에서 확인해 주세요.");
      await refreshOptions();
    });
  }

  return (
    <div className={styles.manager}>
      <div aria-live="polite" className={styles.feedback}>
        {busy ? <p role="status">{busy} 중…</p> : null}
        {message ? <p className={styles.success}><Check size={16} aria-hidden="true" />{message}</p> : null}
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      </div>
      <SectionHeader title="테스트 발송" description="수신자 한 명에게 실제 이메일의 제목과 본문을 확인합니다." />
      <Panel>
        <div className={styles.recipient}><Mail size={18} aria-hidden="true" /><div><span>고정 수신 이메일</span><strong>{TEST_RECIPIENT}</strong></div></div>
        <form className={styles.testForm} onSubmit={createPreview}>
          <fieldset className={styles.fieldset} disabled={Boolean(busy)}>
            <Field htmlFor="test-email-type" label="이메일 종류">
              <TdsSelect id="test-email-type" value={type} onChange={(event) => { setType(event.target.value as NotificationType); invalidatePreview(); }}>
                {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </TdsSelect>
            </Field>
            {type === "MONTHLY_PAYOUT" ? <>
              <div className={styles.formGrid}>
                <Field htmlFor="test-dividend-month" label="표시 배당월"><input id="test-dividend-month" type="month" required value={dividendMonth} onChange={(event) => { setDividendMonth(event.target.value); invalidatePreview(); }} /></Field>
                <Field htmlFor="test-market-value" label="포트폴리오 총액 (원)"><FormattedNumberInput id="test-market-value" required value={totalMarketValueKrw} onValueChange={(value) => { setTotalMarketValueKrw(value); invalidatePreview(); }} placeholder="예: 1,000,000" /></Field>
                <Field htmlFor="test-investment" label="테스트 투자금액 (원)"><FormattedNumberInput id="test-investment" required value={investmentKrw} onValueChange={(value) => { setInvestmentKrw(value); invalidatePreview(); }} placeholder="예: 100,000" /></Field>
                <Field htmlFor="test-dividend" label="월 실배당 합계 (원)"><FormattedNumberInput id="test-dividend" required value={actualDividendKrw} onValueChange={(value) => { setActualDividendKrw(value); invalidatePreview(); }} placeholder="예: 10,000 (0원 입력 가능)" /></Field>
              </div>
              <div className={styles.actions}>
                <button className="secondary" type="button" onClick={() => { setTotalMarketValueKrw("1000000"); setInvestmentKrw("100000"); setActualDividendKrw("10000"); invalidatePreview(); }}>샘플 값 채우기</button>
                <button className="ghost" type="button" onClick={() => run("현재 포트폴리오 조회", async () => {
                  const result = await request<TestEmailOptions>(`${BASE}/tests/options?dividendMonth=${encodeURIComponent(dividendMonth || initialData.defaults.dividendMonth)}`);
                  if (result.defaults.totalMarketValueKrw === undefined) throw new Error("현재 포트폴리오 총액을 불러올 수 없습니다.");
                  setTotalMarketValueKrw(String(Math.round(result.defaults.totalMarketValueKrw)));
                  invalidatePreview();
                })}>현재 포트폴리오 총액 불러오기</button>
                <button className="ghost" type="button" disabled={!dividendMonth} onClick={() => run("실배당 조회", async () => {
                  const result = await request<TestEmailOptions>(`${BASE}/tests/options?dividendMonth=${encodeURIComponent(dividendMonth)}`);
                  if (result.defaults.actualDividendKrw === undefined) throw new Error("선택한 월의 실배당 기록이 없습니다. 금액을 직접 입력해 주세요.");
                  setActualDividendKrw(String(result.defaults.actualDividendKrw));
                  invalidatePreview();
                })}>선택 월 실배당 불러오기</button>
              </div>
              <p className={styles.help}>가상 투자자 한 명의 입력값으로 지급액·보수·재투자액을 계산합니다. 실배당 0원도 테스트할 수 있습니다.</p>
            </> : <>
              <Field htmlFor="test-email-source" label="테스트 데이터">
                <TdsSelect id="test-email-source" value={source} onChange={(event) => { setSource(event.target.value as "sample" | "current"); invalidatePreview(); }}>
                  <option value="sample">내장 샘플 {type === "DISCLOSURE" ? "공시" : "포트폴리오"}</option>
                  <option value="current">{type === "DISCLOSURE" ? "등록된 공시 선택" : "현재 포트폴리오"}</option>
                </TdsSelect>
              </Field>
              {type === "DISCLOSURE" && source === "current" ? <Field htmlFor="test-disclosure" label="등록된 공시">
                <TdsSelect id="test-disclosure" required value={disclosureId} onChange={(event) => { setDisclosureId(event.target.value); invalidatePreview(); }}>
                  <option value="" disabled>공시를 선택해 주세요</option>
                  {data.disclosures.map((disclosure) => <option key={disclosure.id} value={disclosure.id}>{disclosure.title}</option>)}
                </TdsSelect>
                {!data.disclosures.length ? <p className={styles.help}>등록된 공시가 없습니다. 내장 샘플을 선택해 주세요.</p> : null}
              </Field> : null}
            </>}
            <div className={styles.actions}><button type="submit">미리보기 만들기</button><span className={styles.help}>입력값을 바꾸면 미리보기를 다시 만듭니다.</span></div>
          </fieldset>
        </form>
        {preview ? <div className={styles.savedPreview}>
          <h3>저장된 테스트 미리보기</h3>
          {preview.calculation ? <>
            <Grid columns={3}>
              <Metric label="현금 지급액" value={formatKrw(preview.calculation.cashPayoutKrw)} />
              <Metric label="운용 보수" value={formatKrw(preview.calculation.feeKrw)} />
              <Metric label="재투자액" value={formatKrw(preview.calculation.reinvestmentKrw)} />
            </Grid>
            <p className={styles.help}>포트폴리오 {formatKrw(preview.calculation.totalMarketValueKrw)} · 투자금 {formatKrw(preview.calculation.investmentKrw)} · 실배당 {formatKrw(preview.calculation.actualDividendKrw)}</p>
          </> : null}
          <EmailBody {...preview} />
          <div className={styles.actions}><button type="button" disabled={Boolean(busy) || testQueued} onClick={() => sendTest()}><Send size={16} aria-hidden="true" />{testQueued ? "발송 요청됨" : "테스트 메일 보내기"}</button></div>
          {testQueued ? <p className={styles.help}>같은 입력으로 새 테스트를 보내려면 미리보기를 다시 만들어 주세요.</p> : null}
        </div> : null}
      </Panel>

      {data.drafts.length ? <>
        <SectionHeader title="저장된 테스트 미리보기" description="이전에 확인한 내용을 불러와 같은 원본으로 발송합니다." />
        <Panel>
          <form onSubmit={(event) => {
            event.preventDefault();
            void run("저장된 미리보기 조회", async () => {
              setPreview(await request<TestEmailPreview>(`${BASE}/${encodeURIComponent(selectedDraftId)}/preview`));
              setTestQueued(false);
              setMessage("저장된 원본을 불러왔습니다. 위 미리보기의 내용으로 테스트 메일을 보낼 수 있습니다.");
            });
          }}>
            <fieldset className={styles.fieldset} disabled={Boolean(busy)}>
              <Field htmlFor="saved-test-draft" label="미발송 테스트 원본">
                <TdsSelect id="saved-test-draft" required value={selectedDraftId} onChange={(event) => { setSelectedDraftId(event.target.value); invalidatePreview(); }}>
                  <option value="" disabled>미리보기를 선택해 주세요</option>
                  {data.drafts.map((draft) => <option key={draft.id} value={draft.id}>{TYPE_LABELS[draft.type]} · {draft.subject ?? "미리보기"} · {formatDateTime(draft.createdAt)}</option>)}
                </TdsSelect>
              </Field>
              <button className="secondary" type="submit" disabled={!selectedDraftId}>저장된 미리보기 불러오기</button>
            </fieldset>
          </form>
        </Panel>
      </> : null}
      <div className={styles.historyLink}><Link className="button secondary" href="/admin/notifications">발송 이력 확인</Link></div>
    </div>
  );
}
