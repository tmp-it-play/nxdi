import type { MonthlyPayoutRecipient } from "../domain/notifications/index.js";
import { NotificationRequestError } from "./notification-request-policy.js";

export type PriorNotificationRecipient = { userId: string | null; userName: string };
export type CorrectionRecipient = { userId: string; userName: string };

/** Supply the root event and previously queued revisions, excluding unsent drafts. */
export function retainedCorrectionRecipients(priorRecipients: readonly PriorNotificationRecipient[]): CorrectionRecipient[] {
  const recipients = new Map<string, CorrectionRecipient>();
  for (const recipient of priorRecipients) {
    if (!recipient.userId?.trim()) {
      throw new NotificationRequestError("INVALID_CORRECTION_RECIPIENT", "정정 대상의 투자자 식별 정보를 확인해 주세요.");
    }
    if (!recipients.has(recipient.userId)) {
      recipients.set(recipient.userId, { userId: recipient.userId, userName: recipient.userName });
    }
  }
  return [...recipients.values()];
}

/** A prior recipient must learn that a corrected amount is zero, not disappear. */
export function monthlyCorrectionRecipients(
  priorRecipients: readonly PriorNotificationRecipient[],
  recalculatedRecipients: readonly MonthlyPayoutRecipient[]
): MonthlyPayoutRecipient[] {
  const recipients = new Map<string, MonthlyPayoutRecipient>(retainedCorrectionRecipients(priorRecipients).map((recipient) => [
    recipient.userId,
    { ...recipient, investmentKrw: 0, allocationKrw: 0, displayedKrw: 0, managementFeeKrw: 0, reinvestmentKrw: 0 }
  ]));
  for (const recipient of recalculatedRecipients) {
    recipients.set(recipient.userId, { ...recipient });
  }
  return [...recipients.values()];
}
