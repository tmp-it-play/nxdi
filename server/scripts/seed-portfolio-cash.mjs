import { PrismaClient } from "@prisma/client";
import process from "node:process";
import console from "node:console";

const db = new PrismaClient();
try {
  const result = await db.$transaction(async (transaction) => transaction.portfolioCashAsset.createMany({
    data: [
      { currency: "KRW", balance: 55500, initialBalance: 55500, initialCostBasisKrw: 55500 },
      { currency: "USD", balance: 0, initialBalance: 0, initialCostBasisKrw: 0 }
    ],
    skipDuplicates: true
  }));
  console.log(`Cash initialization complete: ${result.count} new currencies`);
} catch {
  console.error("Cash initialization failed. Check database access and migrations.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
