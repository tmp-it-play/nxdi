import type { AppStore, InvestmentIntent, IntentStatus, WithdrawalIntent } from "../domain/types.js";
import {
  RequestInvestmentService,
  type InvestmentRequestInput
} from "../application/request-investment-service.js";
import {
  RequestWithdrawalService,
  type WithdrawalRequestInput
} from "../application/request-withdrawal-service.js";
import { UpdateIntentStatusService } from "../application/update-intent-status-service.js";
import {
  DIVIDEND_POLICY_SHA256,
  DIVIDEND_POLICY_VERSION,
  PRODUCT_DOCUMENT_SHA256,
  PRODUCT_DOCUMENT_VERSION
} from "../domain/document-policy.js";
import type { PayoutMode } from "../domain/payout-mode.js";
import { withMysqlNamedLock } from "./mysql-named-lock.js";
import { createPayoutModeIfMissing, readTotalReturnAccruedKrw } from "./payouts.js";
import { readPortfolioMarketValueKrw } from "./portfolio-store.js";
import { prisma } from "./prisma.js";
import { decryptSensitive, encryptSensitive, maskAccountNumber } from "./sensitive-data.js";

type InvestmentRow = Awaited<ReturnType<typeof prisma.investmentIntent.findMany>>[number];
type WithdrawalRow = Awaited<ReturnType<typeof prisma.withdrawalIntent.findMany>>[number];

function toInvestmentIntent(row: InvestmentRow) {
  return {
    ...row,
    note: row.note ?? undefined,
    productDocumentVersion: row.productDocumentVersion ?? undefined,
    productDocumentHash: row.productDocumentHash ?? undefined,
    dividendPolicyVersion: row.dividendPolicyVersion ?? undefined,
    dividendPolicyHash: row.dividendPolicyHash ?? undefined,
    type: "INVESTMENT" as const,
    status: row.status as IntentStatus,
    agreedAt: row.agreedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  } satisfies InvestmentIntent;
}

function toWithdrawalIntent(row: WithdrawalRow) {
  return {
    ...row,
    accountNumber: maskAccountNumber(decryptSensitive(row.accountNumber)),
    note: row.note ?? undefined,
    productDocumentVersion: row.productDocumentVersion ?? undefined,
    productDocumentHash: row.productDocumentHash ?? undefined,
    type: "WITHDRAWAL" as const,
    status: row.status as IntentStatus,
    agreedAt: row.agreedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  } satisfies WithdrawalIntent;
}

export async function readStore(): Promise<AppStore> {
  const [investmentRows, withdrawalRows] = await Promise.all([
    prisma.investmentIntent.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.withdrawalIntent.findMany({ orderBy: { createdAt: "desc" } })
  ]);

  return {
    investmentIntents: investmentRows.map((row) => toInvestmentIntent(row)),
    withdrawalIntents: withdrawalRows.map((row) => toWithdrawalIntent(row))
  };
}

export async function readStoreForUser(userId: string): Promise<AppStore> {
  const [investmentRows, withdrawalRows] = await Promise.all([
    prisma.investmentIntent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.withdrawalIntent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })
  ]);
  return {
    investmentIntents: investmentRows.map((row) => toInvestmentIntent(row)),
    withdrawalIntents: withdrawalRows.map((row) => toWithdrawalIntent(row))
  };
}

export async function readCompletedNetInvestmentIntentAmount() {
  const [investments, withdrawals, totalReturnAccruedKrw] = await Promise.all([
    prisma.investmentIntent.aggregate({
      where: { status: "COMPLETED" },
      _sum: { amountKrw: true }
    }),
    prisma.withdrawalIntent.aggregate({
      where: { status: "COMPLETED" },
      _sum: { amountKrw: true }
    }),
    readTotalReturnAccruedKrw()
  ]);

  return Math.max(
    (investments._sum.amountKrw ?? 0) + totalReturnAccruedKrw - (withdrawals._sum.amountKrw ?? 0),
    0
  );
}

/** Total-return accruals count as completed investment for the external intake limit. */
export async function readCompletedInvestmentIntentAmount() {
  const [result, totalReturnAccruedKrw] = await Promise.all([
    prisma.investmentIntent.aggregate({
      where: { status: "COMPLETED" },
      _sum: { amountKrw: true }
    }),
    readTotalReturnAccruedKrw()
  ]);
  return (result._sum.amountKrw ?? 0) + totalReturnAccruedKrw;
}

export async function createInvestmentIntent(
  input: Omit<InvestmentIntent, "id" | "type" | "status" | "createdAt" | "updatedAt" | "productDocumentVersion" | "productDocumentHash" | "dividendPolicyVersion" | "dividendPolicyHash" | "agreedAt">,
  payoutMode: PayoutMode
) {
  const row = await prisma.$transaction(async (transaction) => {
    await createPayoutModeIfMissing(input.userId, payoutMode, transaction);
    return transaction.investmentIntent.create({
      data: {
        ...input,
        productDocumentVersion: PRODUCT_DOCUMENT_VERSION,
        productDocumentHash: PRODUCT_DOCUMENT_SHA256,
        dividendPolicyVersion: DIVIDEND_POLICY_VERSION,
        dividendPolicyHash: DIVIDEND_POLICY_SHA256,
        agreedAt: new Date(),
        status: "PENDING"
      }
    });
  });
  return toInvestmentIntent(row);
}

export async function createInvestmentIntentSafely(input: InvestmentRequestInput, payoutMode: PayoutMode) {
  const service = new RequestInvestmentService({
    completedInvestmentIntentAmount: readCompletedInvestmentIntentAmount,
    portfolioMarketValueKrw: readPortfolioMarketValueKrw,
    create: (values) => createInvestmentIntent(values, payoutMode)
  });
  return service.execute(input);
}

export async function createWithdrawalIntent(
  input: Omit<WithdrawalIntent, "id" | "type" | "status" | "createdAt" | "updatedAt" | "productDocumentVersion" | "productDocumentHash" | "agreedAt">
) {
  const row = await prisma.withdrawalIntent.create({
    data: {
      ...input,
      accountNumber: encryptSensitive(input.accountNumber),
      productDocumentVersion: PRODUCT_DOCUMENT_VERSION,
      productDocumentHash: PRODUCT_DOCUMENT_SHA256,
      agreedAt: new Date(),
      status: "PENDING"
    }
  });
  return toWithdrawalIntent(row);
}

export async function createWithdrawalIntentSafely(
  input: WithdrawalRequestInput
) {
  const service = new RequestWithdrawalService({
    withUserTransaction: (_userId, work) => prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM tb_investment_intents WHERE userId = ${input.userId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM tb_withdrawal_intents WHERE userId = ${input.userId} FOR UPDATE`;
      return work({
        completedInvestmentIntentAmount: async () => {
          const [result, totalReturnAccruedKrw] = await Promise.all([
            transaction.investmentIntent.aggregate({
              where: { userId: input.userId, status: "COMPLETED" },
              _sum: { amountKrw: true }
            }),
            readTotalReturnAccruedKrw(input.userId, transaction)
          ]);
          return (result._sum.amountKrw ?? 0) + totalReturnAccruedKrw;
        },
        completedWithdrawalIntentAmount: async () => {
          const result = await transaction.withdrawalIntent.aggregate({
            where: { userId: input.userId, status: "COMPLETED" },
            _sum: { amountKrw: true }
          });
          return result._sum.amountKrw ?? 0;
        },
        pendingWithdrawalIntentAmount: async () => {
          const result = await transaction.withdrawalIntent.aggregate({
            where: { userId: input.userId, status: "PENDING" },
            _sum: { amountKrw: true }
          });
          return result._sum.amountKrw ?? 0;
        },
        save: async (values) => {
          const row = await transaction.withdrawalIntent.create({
            data: {
              ...values,
              accountNumber: encryptSensitive(values.accountNumber),
              productDocumentVersion: PRODUCT_DOCUMENT_VERSION,
              productDocumentHash: PRODUCT_DOCUMENT_SHA256,
              agreedAt: new Date(),
              status: "PENDING"
            }
          });
          return toWithdrawalIntent(row);
        }
      });
    }, { isolationLevel: "Serializable" })
  });

  const locked = await withMysqlNamedLock(
    `nxdi:intents:${input.userId}`,
    () => service.execute(input),
    5
  );
  if (!locked.acquired) throw new Error("Could not acquire withdrawal lock");
  return locked.value;
}

export async function updateIntentStatus(params: {
  type: "INVESTMENT" | "WITHDRAWAL";
  id: string;
  status: Exclude<IntentStatus, "WITHDRAWN">;
}) {
  const owner = params.type === "INVESTMENT"
    ? await prisma.investmentIntent.findUnique({ where: { id: params.id }, select: { userId: true } })
    : await prisma.withdrawalIntent.findUnique({ where: { id: params.id }, select: { userId: true } });
  if (!owner) return { status: "not_found" as const };

  const service = new UpdateIntentStatusService({
    withIntentTransaction: (_input, work) => prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM tb_investment_intents WHERE userId = ${owner.userId} FOR UPDATE`;
      await transaction.$queryRaw`SELECT id FROM tb_withdrawal_intents WHERE userId = ${owner.userId} FOR UPDATE`;
      return work({
        findTarget: async () => {
          if (params.type === "INVESTMENT") {
            const row = await transaction.investmentIntent.findUnique({ where: { id: params.id } });
            return row ? { id: row.id, type: "INVESTMENT" as const, userId: row.userId, amountKrw: row.amountKrw, status: row.status } : null;
          }
          const row = await transaction.withdrawalIntent.findUnique({ where: { id: params.id } });
          return row ? { id: row.id, type: "WITHDRAWAL" as const, userId: row.userId, amountKrw: row.amountKrw, status: row.status } : null;
        },
        completedInvestmentAmountExcluding: async (id) => {
          const [result, totalReturnAccruedKrw] = await Promise.all([
            transaction.investmentIntent.aggregate({
              where: { userId: owner.userId, status: "COMPLETED", id: id ? { not: id } : undefined },
              _sum: { amountKrw: true }
            }),
            readTotalReturnAccruedKrw(owner.userId, transaction)
          ]);
          return (result._sum.amountKrw ?? 0) + totalReturnAccruedKrw;
        },
        completedWithdrawalAmountExcluding: async (id) => {
          const result = await transaction.withdrawalIntent.aggregate({
            where: { userId: owner.userId, status: "COMPLETED", id: id ? { not: id } : undefined },
            _sum: { amountKrw: true }
          });
          return result._sum.amountKrw ?? 0;
        },
        update: async (status) => {
          if (params.type === "INVESTMENT") {
            return toInvestmentIntent(await transaction.investmentIntent.update({ where: { id: params.id }, data: { status } }));
          }
          return toWithdrawalIntent(await transaction.withdrawalIntent.update({ where: { id: params.id }, data: { status } }));
        }
      });
    }, { isolationLevel: "Serializable" })
  });

  const locked = await withMysqlNamedLock(
    `nxdi:intents:${owner.userId}`,
    () => service.execute(params),
    5
  );
  if (!locked.acquired) throw new Error("Could not acquire intent status lock");
  return locked.value;
}

export async function withdrawNonbindingIntent(input: {
  type: "INVESTMENT" | "WITHDRAWAL";
  id: string;
  userId: string;
}) {
  const locked = await withMysqlNamedLock(`nxdi:intents:${input.userId}`, () =>
    prisma.$transaction(async (transaction) => {
      const intent = input.type === "INVESTMENT"
        ? await transaction.investmentIntent.findFirst({ where: { id: input.id, userId: input.userId } })
        : await transaction.withdrawalIntent.findFirst({ where: { id: input.id, userId: input.userId } });
      if (!intent) return { status: "not_found" as const };
      if (intent.status === "REJECTED" || intent.status === "WITHDRAWN") {
        return { status: "already_terminal" as const };
      }
      if (input.type === "INVESTMENT") {
        await transaction.investmentIntent.update({ where: { id: intent.id }, data: { status: "WITHDRAWN" } });
      } else {
        await transaction.withdrawalIntent.update({ where: { id: intent.id }, data: { status: "WITHDRAWN" } });
      }
      return { status: "withdrawn" as const };
    }, { isolationLevel: "Serializable" })
  , 5);
  if (!locked.acquired) throw new Error("Could not acquire intent withdrawal lock");
  return locked.value;
}
