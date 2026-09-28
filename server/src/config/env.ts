import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional()
);

const dataEncryptionKeySchema = z.string().trim().refine((value) => {
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value;
}, "must be canonical base64 encoding of exactly 32 bytes");

const mailboxSchema = z.string().trim().email().max(254).refine(
  (value) => !/[\r\n,;<>]/.test(value),
  "must be a single email address"
);

const mailFromSchema = z.string().trim().max(255).refine((value) => {
  if (/[\r\n]/.test(value)) return false;
  const namedAddress = value.match(/^NXDI <([^<>]+)>$/);
  return mailboxSchema.safeParse(namedAddress?.[1] ?? value).success;
}, "must be one email address or NXDI <email address>");

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    TZ: z.string().default("Asia/Seoul"),
    PUBLIC_APP_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    APP_SESSION_SECRET: z.string().min(32),
    DATA_ENCRYPTION_KEY_BASE64: dataEncryptionKeySchema,
    ADMIN_EMAILS: optionalString,
    ADMIN_EMAIL: optionalString,
    CRON_SECRET: optionalString,
    DATAGSM_CLIENT_ID: optionalString,
    DATAGSM_CLIENT_SECRET: optionalString,
    DATAGSM_REDIRECT_URI: z.string().url().optional(),
    ENABLE_DEV_LOGIN: z.enum(["true", "false"]).default("true"),
    FMP_API_KEY: optionalString,
    SMTP_HOST: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: z.enum(["true", "false"]),
    SMTP_USER: mailboxSchema,
    SMTP_PASSWORD: z.string().refine((value) => value.trim().length > 0, "must not be empty or whitespace"),
    MAIL_FROM: mailFromSchema,
    MAIL_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
    SMTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    SMTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(20_000),
    KRX_OPENAPI_AUTH_KEY: optionalString,
    KRX_AUTH_KEY: optionalString,
    OPENDART_API_KEY: optionalString,
    DART_API_KEY: optionalString
  })
  .superRefine((value, context) => {
    if (value.SMTP_PORT === 465 && value.SMTP_SECURE !== "true") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_SECURE"],
        message: "must be true for SMTP port 465"
      });
    }
    if (value.NODE_ENV === "production" && new URL(value.PUBLIC_APP_URL).protocol !== "https:") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PUBLIC_APP_URL"],
        message: "production PUBLIC_APP_URL must use https"
      });
    }
    if (value.DATAGSM_REDIRECT_URI && new URL(value.DATAGSM_REDIRECT_URI).origin !== new URL(value.PUBLIC_APP_URL).origin) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATAGSM_REDIRECT_URI"],
        message: "DATAGSM_REDIRECT_URI must share the PUBLIC_APP_URL origin"
      });
    }
    if (value.TZ !== "Asia/Seoul") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TZ"],
        message: "TZ must be Asia/Seoul so scheduled jobs run in KST"
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${details}`);
  }
  return parsed.data;
}
