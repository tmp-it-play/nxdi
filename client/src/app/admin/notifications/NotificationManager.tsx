"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Check, RefreshCw, X } from "lucide-react";
import { Badge, Field, Notice, Panel, SectionHeader, TdsSelect } from "@/app/components/tds";
import { formatDateTime } from "@/lib/format";
import type {
  EmailPreview,
  NotificationDelivery,
  NotificationDetail,
  NotificationsResponse,
  NotificationType
} from "@/lib/notification-types";
import styles from "./notifications.module.css";
import { EmailBody } from "./EmailBody";

const BASE = "/api/admin/notifications";
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

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message ?? payload?.error ?? `요청을 처리하지 못했습니다 (${response.status}).`);
  if (!payload) throw new Error("서버 응답을 확인하지 못했습니다. 이력을 새로고침해 주세요.");
  return payload as T;
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
      {delivery.subject && (delivery.html || delivery.text) ? (
        <EmailBody subject={delivery.subject} html={delivery.html ?? ""} text={delivery.text ?? ""} />
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
      <section className={styles.attemptHistory}>
        <h4>시도 이력 {delivery.attempts.length}건</h4>
        {delivery.attempts.length ? <ol className={styles.attempts}>{delivery.attempts.map((attempt) => (
          <li key={attempt.id}>
            <div className={styles.row}><strong>{attempt.attemptNumber}번째 시도 · {statusLabel(attempt.status)}</strong><time>{formatDateTime(attempt.createdAt)}</time></div>
            {attempt.recipientEmail ? <p>{attempt.recipientEmail}</p> : null}
            {attempt.errorMessage ? <p className={styles.error}>{ERROR_LABELS[attempt.errorMessage] ?? attempt.errorMessage}</p> : null}
          </li>
        ))}</ol> : <p className={styles.help}>아직 SMTP 전송을 시도하지 않았습니다.</p>}
      </section>
    </article>
  );
}

function Feedback({ busy, message, error }: { busy: string | null; message: string; error: string }) {
  return (
    <div aria-live="polite" className={styles.feedback}>
      {busy ? <p role="status">{busy} 중…</p> : null}
      {message ? <p className={styles.success}><Check size={16} aria-hidden="true" />{message}</p> : null}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    </div>
  );
}

function NotificationDetailContent({ eventId, onChanged, onOpenDetail }: {
  eventId: string;
  onChanged: () => Promise<void>;
  onOpenDetail: (id: string) => void;
}) {
  const [detail, setDetail] = useState<NotificationDetail | null>(null);
  const [correctionReason, setCorrectionReason] = useState("");
  const [correction, setCorrection] = useState<EmailPreview | null>(null);
  const [correctionQueued, setCorrectionQueued] = useState(false);
  const [busy, setBusy] = useState<string | null>("상세 조회");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const sendKeys = useRef<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const result = await request<NotificationDetail>(`${BASE}/${encodeURIComponent(eventId)}`, undefined, controller.signal);
        if (result.event.mode !== "PRODUCTION") throw new Error("운영 발송 이력만 확인할 수 있습니다.");
        const savedCorrection = result.event.status === "DRAFT" && result.event.reason
          ? await request<EmailPreview>(`${BASE}/${encodeURIComponent(eventId)}/preview`, undefined, controller.signal)
          : null;
        if (controller.signal.aborted) return;
        setDetail(result);
        setCorrection(savedCorrection);
        setCorrectionReason(result.event.reason ?? "");
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "상세 이력을 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setBusy(null);
      }
    }
    void load();
    return () => controller.abort();
  }, [eventId]);

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

  async function deliveryAction(path: string, body: Record<string, unknown>, successMessage: string) {
    await run("전송 상태 변경", async () => {
      await request(path, body);
      setMessage(successMessage);
      setDetail(await request<NotificationDetail>(`${BASE}/${encodeURIComponent(eventId)}`));
      await onChanged();
    });
  }

  return (
    <>
      <Feedback busy={busy} message={message} error={error} />
      {detail ? <>
        <div className={styles.row}>
          <div><strong>{TYPE_LABELS[detail.event.type]}</strong><p className={styles.help}>{detail.event.periodKey || "기간 없음"} · v{detail.event.version} · {formatDateTime(detail.event.createdAt)}</p></div>
          <div className={styles.actions}>
            <Status status={detail.event.status} />
            <button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => run("상세 새로고침", async () => {
              setDetail(await request<NotificationDetail>(`${BASE}/${encodeURIComponent(eventId)}`));
              await onChanged();
            })}><RefreshCw size={16} aria-hidden="true" />새로고침</button>
          </div>
        </div>
        {detail.event.preparationError ? <Notice>{ERROR_LABELS[detail.event.preparationError] ?? detail.event.preparationError}</Notice> : null}
        {detail.event.reason ? <p>정정 사유: {detail.event.reason}</p> : null}
        {detail.deliveries.length ? detail.deliveries.map((delivery) => (
          <Delivery key={`${delivery.id}:${delivery.status}`} delivery={delivery} disabled={Boolean(busy)} onAction={deliveryAction} />
        )) : <p className={styles.help}>준비된 수신자별 전송 항목이 없습니다.</p>}
        {["READY", "COMPLETED", "PARTIAL_FAILURE", "NEEDS_REVIEW", "DRAFT"].includes(detail.event.status) ? <div className={styles.correction}>
          <h3>정정 안내</h3>
          <p className={styles.help}>현재 원본 데이터로 새 버전을 준비합니다. 수신자별 내용과 정정 사유를 확인한 뒤 발송합니다.</p>
          <form onSubmit={(event) => {
            event.preventDefault();
            void run("정정 미리보기 생성", async () => {
              setCorrection(await request<EmailPreview>(`${BASE}/${encodeURIComponent(eventId)}/corrections`, { reason: correctionReason.trim() }));
              setCorrectionQueued(false);
              await onChanged();
            });
          }}>
            <fieldset className={styles.fieldset} disabled={Boolean(busy)}>
              <Field htmlFor="correction-reason" label="정정 사유"><textarea id="correction-reason" required rows={3} maxLength={1000} value={correctionReason} onChange={(event) => { setCorrectionReason(event.target.value); setCorrection(null); setCorrectionQueued(false); }} /></Field>
              <button className="secondary" type="submit" disabled={!correctionReason.trim()}>정정 미리보기 만들기</button>
            </fieldset>
          </form>
          {correction ? <div className={styles.savedPreview}>
            <EmailBody {...correction} />
            <p className={styles.help}>월별 지급액은 대상자 한 명의 미리보기입니다. 전체 수신자별 금액은 이 새 버전의 상세 이력에서 확인할 수 있습니다.</p>
            <div className={styles.actions}>
              <button className="secondary" type="button" disabled={Boolean(busy)} onClick={() => onOpenDetail(correction.id)}>새 버전 수신자별 상세</button>
              <button type="button" disabled={Boolean(busy) || correctionQueued} onClick={() => run("정정 발송 요청", async () => {
                const requestKey = sendKeys.current[correction.id] ??= crypto.randomUUID();
                await request(`${BASE}/${encodeURIComponent(correction.id)}/send`, { requestKey });
                setCorrectionQueued(true);
                setMessage("정정 안내 발송을 요청했습니다.");
                setDetail(await request<NotificationDetail>(`${BASE}/${encodeURIComponent(eventId)}`));
                await onChanged();
              })}>{correctionQueued ? "정정 발송 요청됨" : "확인한 정정 안내 발송"}</button>
            </div>
          </div> : null}
        </div> : null}
      </> : null}
    </>
  );
}

function NotificationDetailDialog({ eventId, onClose, onChanged, onOpenDetail }: {
  eventId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenDetail: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const alreadyLocked = document.body.classList.contains("modal-open");
    document.body.classList.add("modal-open");
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      if (!alreadyLocked) document.body.classList.remove("modal-open");
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    dialogRef.current?.scrollTo({ top: 0 });
    closeRef.current?.focus({ preventScroll: true });
  }, [eventId]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="notification-detail-title"
      className={`holding-modal ${styles.modal}`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
      <header className="holding-modal-header">
        <div><h3 id="notification-detail-title">이메일 발송 상세</h3><p>수신자별 본문과 전송 결과를 확인합니다.</p></div>
        <button ref={closeRef} aria-label="닫기" className="ghost holding-modal-close" type="button" onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      {/* Each selection owns its async state; a closed or replaced detail cannot reopen the dialog. */}
      <NotificationDetailContent key={eventId} eventId={eventId} onChanged={onChanged} onOpenDetail={onOpenDetail} />
    </dialog>,
    document.body
  );
}

export function NotificationManager({ initialData }: { initialData: NotificationsResponse | null }) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(initialData ? "" : "발송 이력을 불러오지 못했습니다. 새로고침해 주세요.");
  const [filters, setFilters] = useState({ type: "", status: "", period: "" });
  const activeQuery = useRef("mode=PRODUCTION");
  const busyRef = useRef(false);
  const listRequest = useRef(0);

  async function refreshList(query = activeQuery.current) {
    const requestId = ++listRequest.current;
    const params = new URLSearchParams(query);
    params.set("mode", "PRODUCTION");
    const result = await request<NotificationsResponse>(`${BASE}?${params}`);
    if (requestId !== listRequest.current) return;
    activeQuery.current = params.toString();
    setData(result);
  }

  async function loadList(query = activeQuery.current) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("이력 조회");
    setError("");
    try { await refreshList(query); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "이력을 불러오지 못했습니다."); }
    finally { busyRef.current = false; setBusy(null); }
  }

  function filterList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value.trim()) query.set(key, value.trim()); });
    void loadList(query.toString());
  }

  function movePage(page: number) {
    const query = new URLSearchParams(activeQuery.current);
    query.set("page", String(page));
    void loadList(query.toString());
  }

  return (
    <div className={styles.manager}>
      <SectionHeader id="admin-notifications" title="이메일 발송 이력" />
      <Panel>
        <div className="admin-panel-header">
          <h2>발송 이력</h2>
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => loadList()}><RefreshCw size={16} aria-hidden="true" />새로고침</button>
        </div>
        <p className={styles.help}>SMTP 접수는 메일 서버가 접수했다는 뜻이며, 수신함 도착 여부와는 다를 수 있습니다.</p>
        <Feedback busy={busy} message="" error={error} />
        <form onSubmit={filterList}>
          <fieldset className={`${styles.fieldset} ${styles.filters}`} disabled={Boolean(busy)}>
            <Field htmlFor="notification-filter-type" label="종류"><TdsSelect id="notification-filter-type" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}><option value="">전체</option>{Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</TdsSelect></Field>
            <Field htmlFor="notification-filter-status" label="준비 상태"><TdsSelect id="notification-filter-status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">전체</option>{["DRAFT", "WAITING_DATA", "READY", "COMPLETED", "PARTIAL_FAILURE", "NEEDS_REVIEW", "NO_RECIPIENTS", "SKIPPED", "CANCELLED"].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</TdsSelect></Field>
            <Field htmlFor="notification-filter-period" label="귀속 기간"><input id="notification-filter-period" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value })} placeholder="2026-09 또는 2026-Q4" /></Field>
            <button className="secondary" type="submit">조회</button>
          </fieldset>
        </form>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead><tr><th>종류</th><th>기간 / 버전</th><th>준비 상태</th><th>전송 결과</th><th>생성일</th><th>관리</th></tr></thead>
            <tbody>{data?.items.length ? data.items.map((item) => <tr key={item.id}>
              <td><strong>{TYPE_LABELS[item.type]}</strong></td>
              <td>{item.periodKey || "—"}<p className={styles.help}>v{item.version}</p></td>
              <td><Status status={item.status} />{item.preparationError ? <p className={styles.error}>{ERROR_LABELS[item.preparationError] ?? item.preparationError}</p> : null}</td>
              <td><span>접수 {item.acceptedCount} / 전체 {item.deliveryCount}</span><p className={styles.help}>실패 {item.failedCount} · 결과 불명 {item.unknownCount}</p></td>
              <td>{formatDateTime(item.createdAt)}</td>
              <td><button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => setSelectedId(item.id)}>상세</button></td>
            </tr>) : <tr><td colSpan={6} className={styles.empty}>{data ? "조건에 맞는 발송 이력이 없습니다." : "발송 이력을 불러올 수 없습니다."}</td></tr>}</tbody>
          </table>
        </div>
        {data ? <div className={styles.pagination}>
          <span>전체 {data.total}건 · {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}페이지</span>
          <div className={styles.actions}><button type="button" className="secondary" disabled={Boolean(busy) || data.page <= 1} onClick={() => movePage(data.page - 1)}>이전</button><button type="button" className="secondary" disabled={Boolean(busy) || data.page * data.pageSize >= data.total} onClick={() => movePage(data.page + 1)}>다음</button></div>
        </div> : null}
      </Panel>
      {selectedId ? <NotificationDetailDialog eventId={selectedId} onClose={() => setSelectedId(null)} onChanged={refreshList} onOpenDetail={setSelectedId} /> : null}
    </div>
  );
}
