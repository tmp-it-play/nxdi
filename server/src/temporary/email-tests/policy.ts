import { assertNotificationDraftRequest, NotificationRequestError, type NotificationDraftState } from "../../application/notification-request-policy.js";
import { TEST_RECIPIENT } from "./constants.js";

type Recipient = { userId: string | null; email?: string; recipientKey?: string };
type TestRecipient<T> = Omit<T, "userId" | "email" | "recipientKey"> & { userId: null; email: string; recipientKey: string };
type TestSendDecision<T> = { action: "ALREADY_REQUESTED"; status: string; recipients: [] }
  | { action: "ENQUEUE"; status: "READY"; recipients: TestRecipient<T>[] };

export function planTestDraftSend<T extends Recipient>(input: {
  event: NotificationDraftState;
  requestKey: string;
  recipients: readonly T[];
}): TestSendDecision<T> {
  const action = assertNotificationDraftRequest({ event: input.event, mode: "TEST", requestKey: input.requestKey });
  if (action === "ALREADY_REQUESTED") return { action, status: input.event.status, recipients: [] };
  if (!input.recipients.length) throw new NotificationRequestError("NO_RECIPIENTS", "발송할 대상자가 없습니다.");
  if (input.recipients.length !== 1) throw new NotificationRequestError("INVALID_TEST_RECIPIENTS", "테스트 메일은 고정된 수신자 한 명에게만 보낼 수 있습니다.");
  return {
    action: "ENQUEUE", status: "READY",
    recipients: input.recipients.map((recipient) => ({ ...recipient, userId: null, email: TEST_RECIPIENT, recipientKey: `test:${TEST_RECIPIENT}` }))
  };
}
