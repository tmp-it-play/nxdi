import { z } from "zod";

export type NotificationIntentAddress = {
  userId: string;
  userEmail: string;
  status: string;
};

export function validEmail(value: string | null | undefined): string | null {
  return value && z.string().email().max(254).safeParse(value).success && !/[\r\n]/.test(value)
    ? value
    : null;
}

export function selectNotificationAddresses(intents: readonly NotificationIntentAddress[], userId: string) {
  const emails = new Map<string, string>();
  let hasInvalidEmail = false;

  for (const intent of intents) {
    if (intent.userId !== userId || intent.status !== "COMPLETED") continue;
    const email = validEmail(intent.userEmail);
    if (!email) {
      hasInvalidEmail = true;
      continue;
    }
    const key = email.toLowerCase();
    if (!emails.has(key)) emails.set(key, email);
  }

  return {
    emails: [...emails.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, email]) => email),
    hasInvalidEmail
  };
}
