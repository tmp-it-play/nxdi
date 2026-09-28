export type NotificationType = "DISCLOSURE" | "MONTHLY_PAYOUT" | "QUARTERLY_HOLDINGS";
export type NotificationMode = "TEST" | "PRODUCTION";
export type NotificationStatus = "DRAFT" | "WAITING_DATA" | "READY" | "COMPLETED" | "PARTIAL_FAILURE" | "NEEDS_REVIEW" | "NO_RECIPIENTS" | "SKIPPED" | "CANCELLED";
export type DeliveryStatus = "DRAFT" | "PENDING" | "CLAIMED" | "SUBMITTING" | "RETRY_WAIT" | "ACCEPTED" | "FAILED" | "UNKNOWN" | "BLOCKED_ADDRESS" | "CANCELLED";

export type NotificationItem = {
  id: string;
  type: NotificationType;
  mode: NotificationMode;
  status: NotificationStatus;
  periodKey: string;
  version: number;
  createdAt: string;
  updatedAt?: string;
  reason?: string | null;
  preparationError?: string | null;
  deliveryCount: number;
  acceptedCount: number;
  failedCount: number;
  unknownCount: number;
};

export type NotificationsResponse = {
  items: NotificationItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type EmailPreview = {
  id: string;
  subject: string;
  html: string;
  text: string;
};

export type NotificationDelivery = {
  id: string;
  userId?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  messageId?: string | null;
  status: DeliveryStatus;
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    recipientEmail?: string | null;
    errorMessage?: string | null;
    createdAt: string;
  }>;
};

export type NotificationDetail = {
  event: NotificationItem;
  deliveries: NotificationDelivery[];
};
