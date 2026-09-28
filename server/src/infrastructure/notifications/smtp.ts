import { createTransport } from "nodemailer";
import { z } from "zod";
import type { Environment } from "../../config/env.js";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
}

export interface MailSender {
  send(message: OutgoingMail): Promise<{ messageId: string; response?: string }>;
  close(): Promise<void>;
}

export type MailFailureOutcome = "retryable" | "permanent" | "unknown";

/** Contains only application codes; never attach the original error or SMTP response. */
export class MailDeliveryError extends Error {
  constructor(
    readonly outcome: MailFailureOutcome,
    readonly code: string,
    readonly responseCode?: number
  ) {
    super(code);
    this.name = "MailDeliveryError";
  }
}

const singleAddressSchema = z.string().email().max(254).refine((value) => !/[\s,;<>]/.test(value));

export function normalizeSmtpError(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) return error;
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof details.code === "string" ? details.code : "";
  const command = typeof details.command === "string" ? details.command : "";
  const message = typeof details.message === "string" ? details.message : "";
  const responseCode = typeof details.responseCode === "number" && Number.isInteger(details.responseCode)
    && details.responseCode >= 100 && details.responseCode <= 599 ? details.responseCode : undefined;

  if (["EAUTH", "ENOAUTH", "EOAUTH2", "ECONFIG"].includes(code) || command.startsWith("AUTH")) {
    return new MailDeliveryError("permanent", "SMTP_AUTH_OR_CONFIG", responseCode);
  }
  if (["ETLS", "EREQUIRETLS", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)
    || /certificate|self.signed|hostname.*does not match/i.test(message)) {
    return new MailDeliveryError("permanent", "SMTP_TLS", responseCode);
  }
  if (responseCode !== undefined && responseCode >= 500) {
    return new MailDeliveryError("permanent", "SMTP_REJECTED", responseCode);
  }
  if (responseCode !== undefined && responseCode >= 400) {
    return new MailDeliveryError("retryable", "SMTP_TEMPORARY_REJECTION", responseCode);
  }
  if (["EDNS", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH"].includes(code)
    || details.syscall === "connect" || details.syscall === "getaddrinfo"
    || /^(?:Greeting never received|Connection timeout)$/.test(message)) {
    return new MailDeliveryError("retryable", "SMTP_CONNECTION_UNAVAILABLE");
  }
  if (["EENVELOPE", "EMAXRECIPIENTS", "EFILEACCESS", "EURLACCESS"].includes(code)) {
    return new MailDeliveryError("permanent", "SMTP_INVALID_MESSAGE");
  }
  // Nodemailer also labels mid-DATA socket failures as CONN. A missing final
  // response cannot safely be retried merely because command === "CONN".
  return new MailDeliveryError("unknown", "SMTP_ACCEPTANCE_UNKNOWN", responseCode);
}

function safeResponse(response: unknown): string | undefined {
  if (typeof response !== "string") return undefined;
  // Server prose may echo addresses or arbitrary content. Persist numeric codes only.
  const match = response.match(/^(\d{3})(?:[ -](\d\.\d{1,3}\.\d{1,3}))?/);
  return match ? `${match[1]}${match[2] ? ` ${match[2]}` : ""}` : undefined;
}

export function createSmtpMailSender(environment: Environment): MailSender {
  const active = new Set<Promise<unknown>>();
  let closed = false;
  // Startup validates all SMTP settings; constructing the transport opens no connection.
  const transport = createTransport({
    pool: true,
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: environment.SMTP_SECURE === "true",
    requireTLS: environment.SMTP_SECURE !== "true",
    auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD },
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    maxConnections: 1,
    maxMessages: 50,
    maxRequeues: 0,
    maxRecipients: 1,
    connectionTimeout: environment.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: environment.SMTP_CONNECTION_TIMEOUT_MS,
    dnsTimeout: environment.SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: environment.SMTP_SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true
  });

  return {
    async send(mail) {
      if (closed) throw new MailDeliveryError("permanent", "SMTP_CLOSED");
      if (!singleAddressSchema.safeParse(mail.to).success || /[\r\n]/.test(mail.subject)
        || !/^<[^<>\s@]+@[^<>\s@]+>$/.test(mail.messageId)) {
        throw new MailDeliveryError("permanent", "SMTP_INVALID_MESSAGE");
      }
      // The application owns the durable queue. Never accumulate another in-memory queue.
      if (active.size >= 1) throw new MailDeliveryError("retryable", "SMTP_BUSY");
      const operation = (async () => {
        try {
          const result = await transport.sendMail({
            from: environment.MAIL_FROM,
            replyTo: environment.SMTP_USER,
            to: { name: "", address: mail.to },
            envelope: { from: environment.SMTP_USER, to: [mail.to] },
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
            messageId: mail.messageId,
            disableFileAccess: true,
            disableUrlAccess: true
          });
          if (result.accepted.length !== 1 || result.rejected.length > 0) {
            throw new MailDeliveryError("unknown", "SMTP_ACCEPTANCE_UNKNOWN");
          }
          return { messageId: result.messageId, response: safeResponse(result.response) };
        } catch (error) {
          throw normalizeSmtpError(error);
        }
      })();
      active.add(operation);
      try {
        return await operation;
      } finally {
        active.delete(operation);
      }
    },
    async close() {
      closed = true;
      transport.close();
      await Promise.allSettled([...active]);
    }
  };
}
