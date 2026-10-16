// One-off migration: sets every investor who already has an investment intent to TOTAL_RETURN.
// Remove this file and the `db:backfill-total-return` script in package.json once it has been applied.
import { PrismaClient } from "@prisma/client";

async function main() {
  const mode = process.argv[2] ?? "--check";
  if (!["--check", "--apply"].includes(mode) || process.argv.length > 3) {
    throw new Error("Use --check (read-only counts, default) or --apply (create missing TOTAL_RETURN preferences only).");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be provided through the environment.");
  const db = new PrismaClient();
  try {
    const [investors, existing] = await Promise.all([
      db.investmentIntent.findMany({ distinct: ["userId"], select: { userId: true } }),
      db.investorPayoutPreference.findMany({ select: { userId: true } })
    ]);
    const existingIds = new Set(existing.map((row) => row.userId));
    // Preferences that already exist were chosen explicitly on a new intent form and are kept.
    const missing = investors.map((row) => row.userId).filter((userId) => !existingIds.has(userId));
    console.log(JSON.stringify({ mode, investors: investors.length, alreadySet: investors.length - missing.length, toCreate: missing.length }));
    if (mode === "--apply" && missing.length) {
      const result = await db.investorPayoutPreference.createMany({
        data: missing.map((userId) => ({ userId, payoutMode: "TOTAL_RETURN" })),
        skipDuplicates: true
      });
      console.log(JSON.stringify({ created: result.count }));
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
