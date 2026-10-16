import type { Prisma } from "@prisma/client";
import {
  rebuildMonthlyInvestorPayouts,
  totalReturnAccrualsFromRows,
  type MonthlyInvestorPayoutRow,
  type PayoutPrincipalEntry
} from "../domain/monthly-investor-payouts.js";
import { DEFAULT_PAYOUT_MODE, parsePayoutMode, type PayoutMode } from "../domain/payout-mode.js";
import { withMysqlNamedLock } from "./mysql-named-lock.js";
import { prisma } from "./prisma.js";

type PayoutDb = Prisma.TransactionClient;

const PAYOUT_LEDGER_LOCK = "nxdi:monthly-investor-payouts";

function toPayoutRow(row: {
  dividendMonth: string;
  userId: string;
  payoutMode: string;
  eligiblePrincipalKrw: number;
  cashPayoutKrw: number;
  totalReturnAccrualKrw: number;
}): MonthlyInvestorPayoutRow {
  return {
    dividendMonth: row.dividendMonth,
    userId: row.userId,
    payoutMode: parsePayoutMode(row.payoutMode) ?? DEFAULT_PAYOUT_MODE,
    eligiblePrincipalKrw: row.eligiblePrincipalKrw,
    cashPayoutKrw: row.cashPayoutKrw,
    totalReturnAccrualKrw: row.totalReturnAccrualKrw
  };
}

export async function readPayoutModes(db: PayoutDb = prisma) {
  const rows = await db.investorPayoutPreference.findMany();
  return new Map(rows.map((row) => [row.userId, parsePayoutMode(row.payoutMode) ?? DEFAULT_PAYOUT_MODE]));
}

export async function readPayoutMode(userId: string, db: PayoutDb = prisma): Promise<PayoutMode | null> {
  const row = await db.investorPayoutPreference.findUnique({ where: { userId } });
  return row ? parsePayoutMode(row.payoutMode) ?? DEFAULT_PAYOUT_MODE : null;
}

/** Records the first choice only; later changes are made directly in the database. */
export async function createPayoutModeIfMissing(userId: string, payoutMode: PayoutMode, db: PayoutDb = prisma) {
  await db.investorPayoutPreference.upsert({
    where: { userId },
    create: { userId, payoutMode },
    update: {}
  });
}

export async function readMonthlyInvestorPayouts(db: PayoutDb = prisma) {
  const rows = await db.monthlyInvestorPayout.findMany({ orderBy: [{ dividendMonth: "asc" }, { userId: "asc" }] });
  return rows.map(toPayoutRow);
}

export async function readTotalReturnAccruedKrw(userId?: string, db: PayoutDb = prisma) {
  const result = await db.monthlyInvestorPayout.aggregate({
    where: userId === undefined ? {} : { userId },
    _sum: { totalReturnAccrualKrw: true }
  });
  return Math.max(result._sum.totalReturnAccrualKrw ?? 0, 0);
}

/** Inputs for a month's payout: accruals booked before it and the modes to apply in it. */
export async function readPayoutContext(dividendMonth: string, db: PayoutDb = prisma) {
  const [rows, currentModes] = await Promise.all([readMonthlyInvestorPayouts(db), readPayoutModes(db)]);
  const bookedModes = new Map(
    rows.filter((row) => row.dividendMonth === dividendMonth).map((row) => [row.userId, row.payoutMode])
  );
  return {
    totalReturnAccruals: totalReturnAccrualsFromRows(rows.filter((row) => row.dividendMonth < dividendMonth)),
    payoutModeOf: (userId: string) => bookedModes.get(userId) ?? currentModes.get(userId) ?? DEFAULT_PAYOUT_MODE
  };
}

async function completedPrincipalEntries(db: PayoutDb) {
  const select = { id: true, userId: true, amountKrw: true, updatedAt: true } as const;
  const [investments, withdrawals] = await Promise.all([
    db.investmentIntent.findMany({ where: { status: "COMPLETED" }, select }),
    db.withdrawalIntent.findMany({ where: { status: "COMPLETED" }, select })
  ]);
  const toEntry = (row: (typeof investments)[number]): PayoutPrincipalEntry => ({
    id: row.id,
    userId: row.userId,
    amountKrw: row.amountKrw,
    completedAt: row.updatedAt.toISOString()
  });
  return { investments: investments.map(toEntry), withdrawals: withdrawals.map(toEntry) };
}

/** Re-books every recorded month from `fromMonth`, since later months compound on it. */
export async function rebuildMonthlyInvestorPayoutsFrom(fromMonth: string) {
  const locked = await withMysqlNamedLock(PAYOUT_LEDGER_LOCK, () =>
    prisma.$transaction(async (db) => {
      const [records, existingRows, currentModes, principals] = await Promise.all([
        db.monthlyDividendRecord.findMany({
          select: { dividendMonth: true, actualDividendKrw: true, referenceMarketValueKrw: true }
        }),
        readMonthlyInvestorPayouts(db),
        readPayoutModes(db),
        completedPrincipalEntries(db)
      ]);
      const rows = rebuildMonthlyInvestorPayouts({
        fromMonth,
        records: records.map((record) => ({
          dividendMonth: record.dividendMonth,
          actualDividendKrw: record.actualDividendKrw,
          referenceMarketValueKrw: record.referenceMarketValueKrw ?? undefined
        })),
        existingRows,
        ...principals,
        currentPayoutModeOf: (userId) => currentModes.get(userId) ?? DEFAULT_PAYOUT_MODE
      });
      await db.monthlyInvestorPayout.deleteMany({ where: { dividendMonth: { gte: fromMonth } } });
      if (rows.length) await db.monthlyInvestorPayout.createMany({ data: rows });
      return rows.length;
    }, { isolationLevel: "Serializable" })
  , 10);
  if (!locked.acquired) throw new Error("Could not acquire monthly investor payout lock");
  return locked.value;
}
