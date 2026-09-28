"use client";

import { useRef, useState, type FormEvent } from "react";
import { Check, Mail, RefreshCw, Send } from "lucide-react";
import { FormattedNumberInput } from "@/app/components/formatted-number-input";
import { Badge, Field, Grid, Metric, Notice, Panel, SectionHeader, TdsSelect } from "@/app/components/tds";
import { formatDateTime, formatKrw } from "@/lib/format";
import type {
  EmailPreview,
  NotificationDelivery,
  NotificationDetail,
  NotificationsResponse,
  NotificationType,
  TestEmailInput
} from "@/lib/notification-types";
import styles from "./notifications.module.css";

const BASE = "/api/admin/notifications";
const TEST_RECIPIENT = "snowykte0426@naver.com";
const TYPE_LABELS: Record<NotificationType, string> = {
  DISCLOSURE: "새 공시",
  MONTHLY_PAYOUT: "월별 지급액",
  QUARTERLY_HOLDINGS: "분기 보유확인서"
};
const STATUS_LABELS: Record<string, string> = {
  DRAFT: "미리보기",
  WAITING_DATA: "데이터 대기",
  WAITING: "준비 대기",
  READY: "발송 준비",
  QUEUED: "발송 대기",
  PENDING: "발송 대기",
  PROCESSING: "처리 중",
  SENDING: "전송 중",
  COMPLETED: "처리 완료",
  ACCEPTED: "SMTP 접수됨",
  RETRYABLE: "재시도 대기",
  FAILED: "실패",
  PERMANENT_FAILURE: "영구 실패",
  UNKNOWN: "결과 불명",
  CANCELLED: "취소됨",
  CLAIMED: "처리 중",
  SUBMITTING: "전송 중",
  RETRY_WAIT: "재시도 대기",
  BLOCKED_ADDRESS: "이메일 확인 필요",
  PARTIAL_FAILURE: "일부 실패",
  NEEDS_REVIEW: "확인 필요",
  NO_RECIPIENTS: "대상자 없음",
  SKIPPED: "발송 제외",
  NOT_ACCEPTED: "미접수 확인"
};
const ERROR_LABELS: Record<string, string> = {
  MONTHLY_DIVIDEND_MISSING: "해당 월의 실배당 입력을 기다리고 있습니다.",
  MISSING_MONTHLY_DIVIDEND: "해당 월의 실배당 입력을 기다리고 있습니다.",
  CONTACT_MISSING: "사용자의 DataGSM 이메일을 확인해 주세요.",
  CONTACT_INVALID: "사용자의 DataGSM 이메일 형식을 확인해 주세요.",
  CONTACT_CONFLICT: "저장된 이메일이 서로 다릅니다. DataGSM 재로그인이 필요합니다.",
  RECIPIENT_ADDRESS_REQUIRED: "수신자의 DataGSM 이메일을 확인한 뒤 재시도해 주세요.",
  INVALID_EMAIL: "DataGSM 이메일 형식을 확인해 주세요.",
  SMTP_AUTH_OR_CONFIG: "SMTP 인증 정보 또는 서버 설정을 확인해 주세요.",
  SMTP_TLS: "SMTP 보안 연결을 확인하지 못했습니다.",
  SMTP_REJECTED: "메일 서버가 전송을 거절했습니다.",
  SMTP_TEMPORARY_REJECTION: "메일 서버의 일시적인 거절로 재시도를 기다립니다.",
  SMTP_CONNECTION_UNAVAILABLE: "메일 서버에 연결하지 못했습니다.",
  SMTP_INVALID_MESSAGE: "메일 형식을 확인해 주세요.",
  SMTP_ACCEPTANCE_UNKNOWN: "메일 서버의 접수 결과를 확인하지 못했습니다.",
  SMTP_UNCERTAIN: "메일 서버의 접수 결과를 확인하지 못했습니다.",
  RESULT_PERSIST_FAILED: "전송 결과를 저장하지 못했습니다. 서버 기록으로 접수 여부를 확인해 주세요.",
  WORKER_INTERRUPTED: "전송 작업이 중단되었습니다. 현재 상태와 서버 기록을 확인해 주세요.",
  CONFIRMED_NOT_ACCEPTED: "외부 기록으로 미접수를 확인했습니다.",
  DISCLOSURE_DELETED: "원본 공시가 삭제되었습니다."
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function Status({ status }: { status: string }) {
  const tone = status === "ACCEPTED" || status === "COMPLETED"
    ? "accepted"
    : ["FAILED", "PARTIAL_FAILURE", "NEEDS_REVIEW", "BLOCKED_ADDRESS", "UNKNOWN", "CANCELLED"].includes(status) ? "rejected" : "pending";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

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

function EmailBody({ subject, html, text }: Pick<EmailPreview, "subject" | "html" | "text">) {
  return (
    <div className={styles.emailBody}>
      <p className={styles.subject}><span>제목</span><strong>{subject}</strong></p>
      <iframe className={styles.preview} title={`이메일 미리보기: ${subject}`} sandbox="" srcDoc={html} referrerPolicy="no-referrer" />
      <details className={styles.textDetails}>
        <summary>일반 텍스트 보기</summary>
        <pre>{text}</pre>
      </details>
    </div>
  );
}

function Delivery({ delivery, disabled, onAction }: {
  delivery: NotificationDelivery;
  disabled: boolean;
  onAction: (path: string, body: Record<string, unknown>, successMessage: string) => Promise<void>;
}) {
  const [evidence, setEvidence] = useState("");
  const [outcome, setOutcome] = useState("ACCEPTED");
  const keys = useRef<Record<string, string>>({});

  function actionKey(action: string) {
    return keys.current[action] ??= crypto.randomUUID();
  }

  return (
    <article className={styles.delivery}>
      <div className={styles.row}>
        <div>
          <strong>{delivery.recipientName || "수신자"}</strong>
          <p className={styles.help}>{delivery.recipientEmail || (delivery.status === "DRAFT" ? "발송 시 최신 DataGSM 이메일 사용" : "이메일 확인 필요")}</p>
        </div>
        <Status status={delivery.status} />
      </div>
      {delivery.lastError ? <p className={styles.error}>{ERROR_LABELS[delivery.lastError] ?? delivery.lastError}</p> : null}
      {delivery.messageId ? <div className={styles.messageId}>
        <label htmlFor={`message-id-${delivery.id}`}>Message-ID · 메일 서버 기록 조회</label>
        <input id={`message-id-${delivery.id}`} readOnly value={delivery.messageId} onFocus={(event) => event.currentTarget.select()} aria-label="메일 서버 조회용 Message-ID" />
      </div> : null}
      {delivery.nextAttemptAt && ["PENDING", "RETRY_WAIT"].includes(delivery.status) ? <p className={styles.help}>다음 시도: {formatDateTime(delivery.nextAttemptAt)}</p> : null}
      {delivery.subject && delivery.html && delivery.text ? (
        <details className={styles.textDetails}>
          <summary>이 수신자에게 보낼 내용</summary>
          <EmailBody subject={delivery.subject} html={delivery.html} text={delivery.text} />
        </details>
      ) : null}
      {["RETRY_WAIT", "FAILED", "BLOCKED_ADDRESS"].includes(delivery.status) ? (
        <button className="secondary" disabled={disabled} type="button" onClick={() => onAction(
          `/api/admin/email-deliveries/${encodeURIComponent(delivery.id)}/retry`,
          { requestKey: actionKey("retry") },
          "저장된 내용으로 재시도를 예약했습니다."
        )}>동일 내용 재시도</button>
      ) : null}
      {delivery.status === "UNKNOWN" ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          void onAction(`/api/admin/email-deliveries/${encodeURIComponent(delivery.id)}/resolve`, {
            outcome, evidence: evidence.trim(), requestKey: actionKey(`resolve:${outcome}:${evidence.trim()}`)
          }, "외부 확인 결과를 기록했습니다.");
        }}>
          <fieldset className={styles.fieldset} disabled={disabled}>
            <p className={styles.help}>메일 서버 기록 등으로 접수 여부를 확인한 뒤 결과와 근거를 기록해 주세요. 미접수 확인 후 재시도를 선택할 수 있습니다.</p>
            <div className={styles.formGrid}>
              <Field htmlFor={`outcome-${delivery.id}`} label="확인 결과">
                <TdsSelect id={`outcome-${delivery.id}`} value={outcome} onChange={(event) => setOutcome(event.target.value)}>
                  <option value="ACCEPTED">SMTP 접수 확인</option>
                  <option value="NOT_ACCEPTED">미접수 확인</option>
                </TdsSelect>
              </Field>
              <Field htmlFor={`evidence-${delivery.id}`} label="확인 근거">
                <input id={`evidence-${delivery.id}`} value={evidence} onChange={(event) => setEvidence(event.target.value)} required minLength={5} maxLength={1000} placeholder="확인 시각, 서버 기록 등 (5자 이상)" />
              </Field>
            </div>
            <button className="secondary" type="submit" disabled={evidence.trim().length < 5}>확인 결과 저장</button>
          </fieldset>
        </form>
      ) : null}
      <details className={styles.textDetails}>
        <summary>시도 이력 {delivery.attempts.length}건</summary>
        {delivery.attempts.length ? <ol className={styles.attempts}>{delivery.attempts.map((attempt) => (
          <li key={attempt.id}>
            <div className={styles.row}><strong>{attempt.attemptNumber}번째 시도 · {statusLabel(attempt.status)}</strong><time>{formatDateTime(attempt.createdAt)}</time></div>
            {attempt.recipientEmail ? <p>{attempt.recipientEmail}</p> : null}
            {attempt.errorMessage ? <p className={styles.error}>{ERROR_LABELS[attempt.errorMessage] ?? attempt.errorMessage}</p> : null}
          </li>
        ))}</ol> : <p className={styles.help}>아직 SMTP 전송을 시도하지 않았습니다.</p>}
      </details>
    </article>
  );
}

export function NotificationManager({ initialData }: { initialData: NotificationsResponse }) {
  const [data, setData] = useState(initialData);
  const [type, setType] = useState<NotificationType>("DISCLOSURE");
  const [source, setSource] = useState<"sample" | "current">("sample");
  const [disclosureId, setDisclosureId] = useState(initialData.disclosures[0]?.id ?? "");
  const [dividendMonth, setDividendMonth] = useState(initialData.defaults.dividendMonth);
  const [totalMarketValueKrw, setTotalMarketValueKrw] = useState("");
  const [investmentKrw, setInvestmentKrw] = useState("");
  const [actualDividendKrw, setActualDividendKrw] = useState("");
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [testQueued, setTestQueued] = useState(false);
  const [detail, setDetail] = useState<NotificationDetail | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correction, setCorrection] = useState<EmailPreview | null>(null);
  const [correctionQueued, setCorrectionQueued] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState({ mode: "", type: "", status: "", period: "" });
  const activeQuery = useRef("");
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

  async function refreshList(query = activeQuery.current) {
    const result = await request<NotificationsResponse>(`${BASE}${query ? `?${query}` : ""}`);
    activeQuery.current = query;
    setData(result);
  }

  async function openDetail(id: string) {
    const result = await request<NotificationDetail>(`${BASE}/${encodeURIComponent(id)}`);
    const savedCorrection = result.event.mode === "PRODUCTION" && result.event.status === "DRAFT" && result.event.reason
      ? await request<EmailPreview>(`${BASE}/${encodeURIComponent(id)}/preview`)
      : null;
    setDetail(result);
    setCorrection(savedCorrection);
    setCorrectionReason(result.event.reason ?? "");
    setCorrectionQueued(false);
  }

  async function deliveryAction(path: string, body: Record<string, unknown>, successMessage: string) {
    await run("전송 상태 변경", async () => {
      await request(path, body);
      setMessage(successMessage);
      if (detail) setDetail(await request<NotificationDetail>(`${BASE}/${encodeURIComponent(detail.event.id)}`));
      await refreshList();
    });
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
      setPreview(await request<EmailPreview>(`${BASE}/tests/preview`, input));
      setTestQueued(false);
      setMessage("미리보기를 저장했습니다. 내용을 확인하고 테스트 메일을 보낼 수 있습니다.");
      await refreshList();
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
      setMessage("테스트 발송을 요청했습니다. SMTP 접수 여부는 아래 발송 이력에서 확인해 주세요.");
      await openDetail(id);
      await refreshList();
    });
  }

  async function filterList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    await run("이력 조회", () => refreshList(query.toString()));
  }

  function movePage(page: number) {
    const query = new URLSearchParams(activeQuery.current);
    query.set("page", String(page));
    void run("이력 조회", () => refreshList(query.toString()));
  }

  return (
    <div className={styles.manager}>
      <Grid columns={3} className="mt-16">
        <Metric label="새 공시" value="등록 후 자동 발송" />
        <Metric label="월별 지급액" value="매월 1일" />
        <Metric label="분기 보유확인서" value="1·4·7·10월 1일" />
      </Grid>
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
                  const result = await request<NotificationsResponse>(`${BASE}?dividendMonth=${encodeURIComponent(dividendMonth || initialData.defaults.dividendMonth)}`);
                  if (result.defaults.totalMarketValueKrw === undefined) throw new Error("현재 포트폴리오 총액을 불러올 수 없습니다.");
                  setTotalMarketValueKrw(String(Math.round(result.defaults.totalMarketValueKrw)));
                  invalidatePreview();
                })}>현재 포트폴리오 총액 불러오기</button>
                <button className="ghost" type="button" disabled={!dividendMonth} onClick={() => run("실배당 조회", async () => {
                  const result = await request<NotificationsResponse>(`${BASE}?dividendMonth=${encodeURIComponent(dividendMonth)}`);
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

      <SectionHeader title="발송 이력" description="SMTP 접수는 메일 서버가 접수했다는 뜻이며, 수신함 도착 여부와는 다를 수 있습니다."
        actions={<button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => run("이력 새로고침", async () => {
          await refreshList();
          if (detail) setDetail(await request<NotificationDetail>(`${BASE}/${encodeURIComponent(detail.event.id)}`));
        })}><RefreshCw size={16} aria-hidden="true" />새로고침</button>} />
      <Panel>
        <form onSubmit={filterList}>
          <fieldset className={`${styles.fieldset} ${styles.filters}`} disabled={Boolean(busy)}>
            <Field htmlFor="filter-mode" label="발송 모드"><TdsSelect id="filter-mode" value={filters.mode} onChange={(event) => setFilters({ ...filters, mode: event.target.value })}><option value="">전체</option><option value="TEST">테스트</option><option value="PRODUCTION">운영</option></TdsSelect></Field>
            <Field htmlFor="filter-type" label="종류"><TdsSelect id="filter-type" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">전체</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</TdsSelect></Field>
            <Field htmlFor="filter-status" label="준비 상태"><TdsSelect id="filter-status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">전체</option>{["DRAFT", "WAITING_DATA", "READY", "COMPLETED", "PARTIAL_FAILURE", "NEEDS_REVIEW", "NO_RECIPIENTS", "SKIPPED", "CANCELLED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</TdsSelect></Field>
            <Field htmlFor="filter-period" label="귀속 기간"><input id="filter-period" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })} placeholder="2026-09 또는 2026-Q4" /></Field>
            <button className="secondary" type="submit">조회</button>
          </fieldset>
        </form>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>종류 / 모드</th><th>기간 / 버전</th><th>준비 상태</th><th>전송 결과</th><th>생성일</th><th>관리</th></tr></thead>
            <tbody>{data.items.length ? data.items.map((item) => <tr key={item.id}>
              <td><strong>{TYPE_LABELS[item.type]}</strong><p className={styles.help}>{item.mode === "TEST" ? "테스트" : "운영"}</p></td>
              <td>{item.periodKey || "—"}<p className={styles.help}>v{item.version}</p></td>
              <td><Status status={item.status} />{item.preparationError ? <p className={styles.error}>{ERROR_LABELS[item.preparationError] ?? item.preparationError}</p> : null}</td>
              <td><span>접수 {item.acceptedCount} / 전체 {item.deliveryCount}</span><p className={styles.help}>실패 {item.failedCount} · 결과 불명 {item.unknownCount}</p></td>
              <td>{formatDateTime(item.createdAt)}</td>
              <td><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => run("상세 조회", () => openDetail(item.id))}>상세</button></td>
            </tr>) : <tr><td colSpan={6} className={styles.empty}>조건에 맞는 발송 이력이 없습니다.</td></tr>}</tbody>
          </table>
        </div>
        <div className={styles.pagination}>
          <span>전체 {data.total}건 · {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}페이지</span>
          <div className={styles.actions}><button type="button" className="secondary" disabled={Boolean(busy) || data.page <= 1} onClick={() => movePage(data.page - 1)}>이전</button><button type="button" className="secondary" disabled={Boolean(busy) || data.page * data.pageSize >= data.total} onClick={() => movePage(data.page + 1)}>다음</button></div>
        </div>
      </Panel>

      {detail ? <>
        <SectionHeader title={`${TYPE_LABELS[detail.event.type]} 상세`} description={`${detail.event.mode === "TEST" ? "테스트" : "운영"} · ${detail.event.periodKey || "기간 없음"} · v${detail.event.version}`} actions={<button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => setDetail(null)}>닫기</button>} />
        <Panel>
          <div className={styles.row}><Status status={detail.event.status} /><span className={styles.help}>{formatDateTime(detail.event.createdAt)}</span></div>
          {detail.event.preparationError ? <Notice>{ERROR_LABELS[detail.event.preparationError] ?? detail.event.preparationError}</Notice> : null}
          {detail.event.reason ? <p>정정 사유: {detail.event.reason}</p> : null}
          {detail.deliveries.length ? detail.deliveries.map((delivery) => <Delivery key={`${delivery.id}:${delivery.status}`} delivery={delivery} disabled={Boolean(busy)} onAction={deliveryAction} />) : <p className={styles.help}>준비된 수신자별 전송 항목이 없습니다.</p>}
          {detail.event.mode === "TEST" && detail.event.status === "DRAFT" ? <div className={styles.savedPreview}>
            <p className={styles.help}>위에 저장된 수신자별 내용을 그대로 {TEST_RECIPIENT}에 보냅니다.</p>
            <button type="button" disabled={Boolean(busy)} onClick={() => sendTest(detail.event.id)}><Send size={16} aria-hidden="true" />저장된 테스트 메일 보내기</button>
          </div> : null}
          {detail.event.mode === "PRODUCTION" && ["READY", "COMPLETED", "PARTIAL_FAILURE", "NEEDS_REVIEW", "DRAFT"].includes(detail.event.status) ? <div className={styles.correction}>
            <h3>정정 안내</h3>
            <p className={styles.help}>현재 원본 데이터로 새 버전을 준비합니다. 수신자별 내용과 정정 사유를 확인한 뒤 발송합니다.</p>
            <form onSubmit={(event) => { event.preventDefault(); void run("정정 미리보기 생성", async () => {
              setCorrection(await request<EmailPreview>(`${BASE}/${encodeURIComponent(detail.event.id)}/corrections`, { reason: correctionReason.trim() }));
              setCorrectionQueued(false);
              await refreshList();
            }); }}>
              <fieldset className={styles.fieldset} disabled={Boolean(busy)}>
                <Field htmlFor="correction-reason" label="정정 사유"><textarea id="correction-reason" required rows={3} maxLength={1000} value={correctionReason} onChange={(event) => { setCorrectionReason(event.target.value); setCorrection(null); setCorrectionQueued(false); }} /></Field>
                <button className="secondary" type="submit" disabled={!correctionReason.trim()}>정정 미리보기 만들기</button>
              </fieldset>
            </form>
            {correction ? <div className={styles.savedPreview}>
              <EmailBody {...correction} />
              <p className={styles.help}>월별 지급액은 대상자 한 명의 미리보기입니다. 전체 수신자별 금액은 이 새 버전의 상세 이력에서 확인할 수 있습니다.</p>
              <div className={styles.actions}>
                <button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => run("정정 상세 조회", () => openDetail(correction.id))}>새 버전 수신자별 상세</button>
                <button type="button" disabled={Boolean(busy) || correctionQueued} onClick={() => run("정정 발송 요청", async () => {
                  await request(`${BASE}/${encodeURIComponent(correction.id)}/send`, { requestKey: sendKey(correction.id) });
                  setCorrectionQueued(true);
                  setMessage("정정 안내 발송을 요청했습니다.");
                  await refreshList();
                })}>{correctionQueued ? "정정 발송 요청됨" : "확인한 정정 안내 발송"}</button>
              </div>
            </div> : null}
          </div> : null}
        </Panel>
      </> : null}
    </div>
  );
}
