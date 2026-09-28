export class NotificationRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
    this.name = "NotificationRequestError";
  }
}

export type NotificationDraftState = {
  id: string;
  mode: string;
  status: string;
  requestKey: string | null;
  parentId: string | null;
  reason: string | null;
};
export type DraftRecipientAddress = { userId: string | null; email?: string };
export type DraftSendDecision<T extends DraftRecipientAddress> =
  | { action: "ALREADY_REQUESTED"; status: string; recipients: [] }
  | { action: "ENQUEUE"; status: "READY"; recipients: T[] };

function requirePolicy(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new NotificationRequestError(code, message);
}
const nonblank = (value: string | null | undefined) => typeof value === "string" && value.trim().length > 0;

/** Call under the event lock. The expected mode is supplied by trusted server code. */
export function assertNotificationDraftRequest(input: { event: NotificationDraftState; mode: string; requestKey: string }): "ALREADY_REQUESTED" | "ENQUEUE" {
  const { event, mode, requestKey } = input;
  requirePolicy(event.mode === mode, "MODE_MISMATCH", "요청한 발송 모드와 원본이 다릅니다.");
  requirePolicy(nonblank(requestKey), "REQUEST_KEY_REQUIRED", "발송 요청 키가 필요합니다.");
  if (event.requestKey === requestKey && event.status !== "DRAFT") return "ALREADY_REQUESTED";
  requirePolicy(event.status === "DRAFT" && event.requestKey === null, "ALREADY_REQUESTED", "이미 발송 요청된 원본입니다.");
  return "ENQUEUE";
}

/** Only reviewed production corrections may enter the ordinary manual send path. */
export function planNotificationDraftSend<T extends DraftRecipientAddress>(input: {
  event: NotificationDraftState;
  requestKey: string;
  recipients: readonly T[];
}): DraftSendDecision<T> {
  const { event } = input;
  if (assertNotificationDraftRequest({ ...input, mode: "PRODUCTION" }) === "ALREADY_REQUESTED") {
    return { action: "ALREADY_REQUESTED", status: event.status, recipients: [] };
  }
  requirePolicy(nonblank(event.parentId) && event.parentId !== event.id && nonblank(event.reason),
    "CORRECTION_REQUIRED", "운영 수동 발송은 사유와 원본이 있는 정정 초안만 가능합니다.");
  requirePolicy(input.recipients.length > 0, "NO_RECIPIENTS", "발송할 대상자가 없습니다.");
  requirePolicy(input.recipients.every((recipient) => nonblank(recipient.userId)), "INVALID_PRODUCTION_RECIPIENT", "운영 메일에는 투자자 식별 정보가 필요합니다.");
  return { action: "ENQUEUE", status: "READY", recipients: input.recipients.map((recipient) => ({ ...recipient })) };
}

export type CorrectionSource = { id: string; parentId: string | null; mode: string; preparedAt: Date | string | null };
export function planNotificationCorrection(original: CorrectionSource | null, reason: string) {
  requirePolicy(original?.mode === "PRODUCTION" && original.preparedAt, "INVALID_CORRECTION", "준비된 운영 메일만 정정할 수 있습니다.");
  requirePolicy(nonblank(reason), "CORRECTION_REASON_REQUIRED", "정정 사유를 입력해 주세요.");
  return { rootId: original.parentId ?? original.id, reason: reason.trim() };
}
