export type DeliveryClaim = { id: string; token: string };
export type Submission = DeliveryClaim & {
  attemptNumber: number;
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
};
export type DeliveryOutcome = {
  status: "ACCEPTED" | "RETRY_WAIT" | "FAILED" | "UNKNOWN";
  errorCode?: string;
  responseCode?: number;
  response?: string;
  nextAttemptAt?: Date;
};
export interface DeliveryRepository {
  claim(now: Date): Promise<DeliveryClaim | null>;
  begin(claim: DeliveryClaim, now: Date): Promise<Submission | null>;
  finish(submission: Submission, outcome: DeliveryOutcome, now: Date): Promise<void>;
}
export interface MailTransport {
  send(input: { to: string; subject: string; html: string; text: string; messageId: string }): Promise<unknown>;
}

const RETRY_MINUTES = [1, 5, 30, 120];

export function deliveryFailure(error: unknown, attemptNumber: number, now: Date): DeliveryOutcome {
  const failure = error as { outcome?: unknown; code?: unknown; responseCode?: unknown } | null;
  const errorCode = typeof failure?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(failure.code)
    ? failure.code : "SMTP_UNCERTAIN";
  const responseCode = typeof failure?.responseCode === "number" ? failure.responseCode : undefined;
  const retryMinutes = RETRY_MINUTES[attemptNumber - 1];
  if (failure?.outcome === "retryable" && retryMinutes !== undefined) {
    return { status: "RETRY_WAIT", errorCode, responseCode, nextAttemptAt: new Date(now.getTime() + retryMinutes * 60_000) };
  }
  return { status: failure?.outcome === "permanent" || failure?.outcome === "retryable" ? "FAILED" : "UNKNOWN", errorCode, responseCode };
}

/** SMTP and durable acceptance are separate: a save failure must never cause a new send. */
export class EmailDeliveryService {
  constructor(private readonly repository: DeliveryRepository, private readonly sender: MailTransport, private readonly now = () => new Date()) {}

  async runOne(): Promise<boolean> {
    const claim = await this.repository.claim(this.now());
    if (!claim) return false;
    const submission = await this.repository.begin(claim, this.now());
    if (!submission) return true;
    let outcome: DeliveryOutcome;
    try {
      const accepted = await this.sender.send(submission);
      outcome = { status: "ACCEPTED" };
      const response = accepted && typeof accepted === "object" && "response" in accepted ? accepted.response : undefined;
      if (typeof response === "string" && /^2\d{2}(?: \d\.\d{1,3}\.\d{1,3})?$/.test(response)) {
        outcome.response = response;
        outcome.responseCode = Number(response.slice(0, 3));
      }
    } catch (error) {
      outcome = deliveryFailure(error, submission.attemptNumber, this.now());
    }
    try {
      await this.repository.finish(submission, outcome, this.now());
    } catch {
      // If persistence is unavailable, the expired SUBMITTING lease is also recovered as UNKNOWN.
      await this.repository.finish(submission, { status: "UNKNOWN", errorCode: "RESULT_PERSIST_FAILED" }, this.now()).catch(() => undefined);
    }
    return true;
  }
}
