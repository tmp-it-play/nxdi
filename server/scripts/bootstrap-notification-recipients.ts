import { PrismaClient, type Prisma } from "@prisma/client";
import { z } from "zod";

type HistoricalContact = { userId: string; userName: string; userEmail: string; updatedAt: Date };
type Candidate = { userId: string; name: string; nameUpdatedAt: Date; emails: Set<string> };
const addressSchema = z.string().email().max(254).refine((value) => !/[\s,;<>]/.test(value));

async function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--apply"].includes(mode) || process.argv.length > 3) {
    throw new Error("Use --check (read-only counts, default) or --apply (create missing contacts only).");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be provided through the environment.");
  const db = new PrismaClient();
  try {
    // No account, bank, contact-number, agreement or amount fields are fetched.
    const select = { userId: true, userName: true, userEmail: true, updatedAt: true } as const;
    const [investments, withdrawals, existing] = await Promise.all([
      db.investmentIntent.findMany({ select }),
      db.withdrawalIntent.findMany({ select }),
      db.notificationRecipient.findMany({ select: { userId: true } })
    ]);
    const candidates = new Map<string, Candidate>();
    function collect(row: HistoricalContact) {
      let candidate = candidates.get(row.userId);
      if (!candidate) {
        candidate = { userId: row.userId, name: row.userName, nameUpdatedAt: row.updatedAt, emails: new Set() };
        candidates.set(row.userId, candidate);
      }
      // updatedAt chooses only the display name; it is never an address confirmation time.
      if (row.updatedAt > candidate.nameUpdatedAt) {
        candidate.name = row.userName;
        candidate.nameUpdatedAt = row.updatedAt;
      }
      const email = row.userEmail.trim();
      if (addressSchema.safeParse(email).success) candidate.emails.add(email);
    }
    investments.forEach(collect);
    withdrawals.forEach(collect);
    const existingIds = new Set(existing.map((row) => row.userId));
    const missing = [...candidates.values()].filter((row) => !existingIds.has(row.userId));
    const data: Prisma.NotificationRecipientCreateManyInput[] = missing.map((row) => {
      const email = row.emails.size === 1 ? [...row.emails][0]! : null;
      return {
        userId: row.userId, name: row.name, email,
        source: email ? "HISTORICAL_SINGLE" : "HISTORICAL_UNRESOLVED",
        confirmedAt: null, errorCode: email ? null : "NEEDS_RELOGIN"
      };
    });
    console.log(JSON.stringify({
      mode: mode === "--apply" ? "APPLY" : "CHECK",
      historicalUsers: candidates.size,
      existingUsersUnchanged: candidates.size - missing.length,
      missingUsers: missing.length,
      singleValidAddress: data.filter((row) => row.email).length,
      needsRelogin: data.filter((row) => !row.email).length
    }));
    if (mode === "--check") return;
    let created = 0;
    for (let offset = 0; offset < data.length; offset += 250) {
      // Unique userId + skipDuplicates implements a create-only upsert, including
      // a DataGSM login that inserts a newer contact after the read above.
      const result = await db.notificationRecipient.createMany({ data: data.slice(offset, offset + 250), skipDuplicates: true });
      created += result.count;
    }
    console.log(JSON.stringify({ created, concurrentlyExistingUsersUnchanged: data.length - created }));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error && (/^Use --check/.test(error.message) || /^DATABASE_URL must/.test(error.message))
    ? error.message : "Recipient bootstrap failed. Check database connectivity and the notification migration; no addresses or credentials are printed.";
  console.error(message);
  process.exitCode = 1;
});
