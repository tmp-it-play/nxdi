import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { createConnection } from "mysql2/promise";

const baseline = "20260927000000_existing_schema_baseline";
const serverDirectory = fileURLToPath(new URL("../", import.meta.url));
const baselineSchema = `prisma/migrations/${baseline}/schema.prisma`;
const require = createRequire(import.meta.url);
const mode = process.argv[2] ?? "--check";

function runPrisma(args) {
  return spawnSync(process.execPath, [require.resolve("prisma"), ...args], {
    cwd: serverDirectory,
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024
  });
}

async function main() {
  if (!["--check", "--mark-applied"].includes(mode) || process.argv.length > 3) {
    throw new Error("Use --check (read only) or --mark-applied (record verified baseline).");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be provided through the environment.");

  const connection = await createConnection(process.env.DATABASE_URL);
  try {
    const [tables] = await connection.query(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
    );
    if (tables.length === 0) {
      throw new Error("Database is empty. Use npm run db:migrate to apply both migrations; do not baseline an empty database.");
    }
    if (tables.some((table) => table.name === "_prisma_migrations")) {
      const [history] = await connection.query(
        "SELECT migration_name AS name, finished_at AS finishedAt, rolled_back_at AS rolledBackAt FROM _prisma_migrations"
      );
      if (history.some((migration) => migration.name === baseline && migration.finishedAt && !migration.rolledBackAt)) {
        console.log("The existing schema baseline is already recorded. Use npm run db:migrate for pending migrations.");
        return;
      }
      if (history.length > 0) {
        throw new Error("Existing migration history needs operator reconciliation; refusing to assume a new baseline.");
      }
    }

    const diff = runPrisma([
      "migrate", "diff", "--from-schema-datasource", baselineSchema,
      "--to-schema-datamodel", baselineSchema, "--exit-code"
    ]);
    if (diff.status === 2) {
      // The diff contains schema metadata only, never user rows or environment values.
      process.stdout.write(diff.stdout);
      throw new Error("Live schema differs from the preserved pre-notification schema. Review and reconcile it before baselining.");
    }
    if (diff.status !== 0) {
      throw new Error("Read-only schema comparison failed. Check database access and Prisma CLI configuration.");
    }
    console.log("Live schema matches the preserved pre-notification schema; no application tables or rows were changed.");
    if (mode === "--check") {
      console.log("After a verified backup and review, rerun with --mark-applied to record only the baseline migration history.");
      return;
    }
    const resolution = runPrisma(["migrate", "resolve", "--applied", baseline]);
    if (resolution.status !== 0) throw new Error("Baseline history could not be recorded. Review Prisma migration status before retrying.");
    console.log("Baseline migration history recorded. Run npm run db:migrate to create notification tables.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  // Database driver errors may include connection details; expose only our known messages.
  const knownMessages = [
    "Use --check", "DATABASE_URL must", "Database is empty", "Existing migration history",
    "Live schema differs", "Read-only schema comparison", "Baseline history could"
  ];
  const message = error instanceof Error && knownMessages.some((prefix) => error.message.startsWith(prefix))
    ? error.message : "Database baseline check failed. Check connectivity and permissions; no credentials are printed.";
  console.error(message);
  process.exitCode = 1;
});
