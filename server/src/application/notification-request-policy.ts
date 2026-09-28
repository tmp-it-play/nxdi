import { TEST_RECIPIENT } from "../domain/notifications/index.js";

export class NotificationRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "NotificationRequestError";
  }
}

export type NotificationSendMode = "TEST" | "PRODUCTION";
export type NotificationDraftState = {
  id: string;
  mode: string;
  status: string;
  requestKey: string | null;
  parentId: string | null;
  reason: string | null;
};
export type DraftRecipientAddress = { userId: string | null; email?: string };
export type DraftSendRecipient<T extends DraftRecipientAddress> = Omit<T, "userId" | "email"> & DraftRecipientAddress;
export type DraftSendDecision<T extends DraftRecipientAddress> =
  | { action: "ALREADY_REQUESTED"; status: string; recipients: [] }
  | { action: "ENQUEUE"; status: "READY"; recipients: DraftSendRecipient<T>[] };

function requirePolicy(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new NotificationRequestError(code, message);
}

const nonblank = (value: string | null | undefined) => typeof value === "string" && value.trim().length > 0;

/** Evaluate under the event lock; the caller persists enqueue + request key atomically. */
export function planNotificationDraftSend<T extends DraftRecipientAddress>(input: {
  event: NotificationDraftState;
  mode: NotificationSendMode;
  requestKey: string;
  recipients: readonly T[];
}): DraftSendDecision<T> {
  const { event, mode, requestKey } = input;
  requirePolicy(event.mode === mode, "MODE_MISMATCH", "요청한 발송 모드와 원본이 다릅니다.");
  requirePolicy(nonblank(requestKey), "REQUEST_KEY_REQUIRED", "발송 요청 키가 필요합니다.");

  // A repeated request only observes the original operation. It neither changes
  // its status nor attempts a resend.
  if (event.requestKey === requestKey && event.status !== "DRAFT") {
    return { action: "ALREADY_REQUESTED", status: event.status, recipients: [] };
  }
  requirePolicy(event.status === "DRAFT" && event.requestKey === null, "ALREADY_REQUESTED", "이미 발송 요청된 원본입니다.");
  requirePolicy(mode === "TEST" || (nonblank(event.parentId) && event.parentId !== event.id && nonblank(event.reason)),
    "CORRECTION_REQUIRED", "운영 수동 발송은 사유와 원본이 있는 정정 초안만 가능합니다.");
  requirePolicy(input.recipients.length > 0, "NO_RECIPIENTS", "발송할 대상자가 없습니다.");
  requirePolicy(mode !== "TEST" || input.recipients.length === 1, "INVALID_TEST_RECIPIENTS", "테스트 메일은 고정된 수신자 한 명에게만 보낼 수 있습니다.");
  const recipients: DraftSendRecipient<T>[] = input.recipients.map((recipient) => mode === "TEST"
    ? { ...recipient, userId: null, email: TEST_RECIPIENT }
    : { ...recipient });
  return { action: "ENQUEUE", status: "READY", recipients };
}

export type CorrectionSource = {
  id: string;
  parentId: string | null;
  mode: string;
  preparedAt: Date | string | null;
};

/** Corrections may only refer to a previously prepared production original. */
export function planNotificationCorrection(original: CorrectionSource | null, reason: string) {
  requirePolicy(original?.mode === "PRODUCTION" && original.preparedAt,
    "INVALID_CORRECTION", "준비된 운영 메일만 정정할 수 있습니다.");
  requirePolicy(nonblank(reason), "CORRECTION_REASON_REQUIRED", "정정 사유를 입력해 주세요.");
  return { rootId: original.parentId ?? original.id, reason: reason.trim() };
}
