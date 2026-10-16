import { CalculateDividendPrincipalService } from "../application/calculate-dividend-principal-service.js";
import { calculateDividendAllocation } from "./dividend-allocation.js";
import type { PayoutMode } from "./payout-mode.js";

export type PayoutPrincipalEntry = {
  id: string;
  userId: string;
  amountKrw: number;
  completedAt: string;
};

export type TotalReturnAccrual = {
  userId: string;
  dividendMonth: string;
  amountKrw: number;
};

export type InvestorPayout = {
  userId: string;
  investmentKrw: number;
  payoutMode: PayoutMode;
  allocationKrw: number;
  managementFeeKrw: number;
  reinvestmentKrw: number;
  totalReturnAccrualKrw: number;
};

export type CalculateInvestorPayoutsInput = {
  dividendMonth: string;
  totalMarketValueKrw: number;
  actualDividendKrw: number;
  investments: readonly PayoutPrincipalEntry[];
  withdrawals: readonly PayoutPrincipalEntry[];
  totalReturnAccruals?: readonly TotalReturnAccrual[];
  payoutModeOf(userId: string): PayoutMode;
};

const TOTAL_RETURN_ENTRY_PREFIX = "total-return:";

export function isTotalReturnPrincipalEntryId(id: string) {
  return id.startsWith(TOTAL_RETURN_ENTRY_PREFIX);
}

/**
 * An accrual booked for month M is completed in M, so the shared eligibility rule
 * adds it to P from M+1 and FIFO withdrawals reach it after older investments.
 */
export function totalReturnPrincipalEntries(
  accruals: readonly TotalReturnAccrual[]
): PayoutPrincipalEntry[] {
  return accruals
    .filter((accrual) => accrual.amountKrw > 0)
    .map((accrual) => ({
      id: `${TOTAL_RETURN_ENTRY_PREFIX}${accrual.userId}:${accrual.dividendMonth}`,
      userId: accrual.userId,
      amountKrw: accrual.amountKrw,
      completedAt: new Date(`${accrual.dividendMonth}-01T00:00:00+09:00`).toISOString()
    }));
}

export function eligiblePayoutPrincipals(
  input: Pick<CalculateInvestorPayoutsInput, "dividendMonth" | "investments" | "withdrawals" | "totalReturnAccruals">
) {
  const priorAccruals = (input.totalReturnAccruals ?? []).filter(
    (accrual) => accrual.dividendMonth < input.dividendMonth
  );
  return new CalculateDividendPrincipalService().execute({
    dividendMonth: input.dividendMonth,
    investments: [...input.investments, ...totalReturnPrincipalEntries(priorAccruals)],
    withdrawals: [...input.withdrawals]
  });
}

export function calculateInvestorPayouts(input: CalculateInvestorPayoutsInput) {
  const principalsByUser = new Map<string, number>();
  for (const principal of eligiblePayoutPrincipals(input)) {
    principalsByUser.set(
      principal.userId,
      (principalsByUser.get(principal.userId) ?? 0) + principal.amountKrw
    );
  }
  const investorPrincipalKrw = [...principalsByUser.values()].reduce((sum, amount) => sum + amount, 0);
  const payouts: InvestorPayout[] = [...principalsByUser].map(([userId, investmentKrw]) => {
    const allocation = calculateDividendAllocation({
      totalMarketValueKrw: input.totalMarketValueKrw,
      actualDividendKrw: input.actualDividendKrw,
      selectedInvestmentKrw: investmentKrw,
      investorPrincipalKrw
    });
    const payoutMode = input.payoutModeOf(userId);
    if (payoutMode === "TOTAL_RETURN") {
      return {
        userId,
        investmentKrw,
        payoutMode,
        allocationKrw: 0,
        managementFeeKrw: allocation.selectedManagementFeeKrw,
        reinvestmentKrw: 0,
        totalReturnAccrualKrw: allocation.allocationKrw + allocation.selectedInvestorReinvestmentKrw
      };
    }
    return {
      userId,
      investmentKrw,
      payoutMode,
      allocationKrw: allocation.allocationKrw,
      managementFeeKrw: allocation.selectedManagementFeeKrw,
      reinvestmentKrw: allocation.selectedInvestorReinvestmentKrw,
      totalReturnAccrualKrw: 0
    };
  });
  return { payouts, investorPrincipalKrw };
}

export type MonthlyInvestorPayoutRow = {
  dividendMonth: string;
  userId: string;
  payoutMode: PayoutMode;
  eligiblePrincipalKrw: number;
  cashPayoutKrw: number;
  totalReturnAccrualKrw: number;
};

export type PayoutLedgerDividendRecord = {
  dividendMonth: string;
  actualDividendKrw: number;
  referenceMarketValueKrw?: number;
};

export type RebuildMonthlyInvestorPayoutsInput = {
  fromMonth: string;
  records: readonly PayoutLedgerDividendRecord[];
  existingRows: readonly MonthlyInvestorPayoutRow[];
  investments: readonly PayoutPrincipalEntry[];
  withdrawals: readonly PayoutPrincipalEntry[];
  currentPayoutModeOf(userId: string): PayoutMode;
};

export function totalReturnAccrualsFromRows(rows: readonly MonthlyInvestorPayoutRow[]): TotalReturnAccrual[] {
  return rows
    .filter((row) => row.totalReturnAccrualKrw > 0)
    .map((row) => ({ userId: row.userId, dividendMonth: row.dividendMonth, amountKrw: row.totalReturnAccrualKrw }));
}

/**
 * Recomputes ledger rows from `fromMonth` onward. Rows before `fromMonth` stay as booked,
 * and a month that was already booked keeps each investor's payout mode from that time.
 */
export function rebuildMonthlyInvestorPayouts(input: RebuildMonthlyInvestorPayoutsInput) {
  const accruals = totalReturnAccrualsFromRows(
    input.existingRows.filter((row) => row.dividendMonth < input.fromMonth)
  );
  const bookedModes = new Map(
    input.existingRows
      .filter((row) => row.dividendMonth >= input.fromMonth)
      .map((row) => [`${row.dividendMonth}:${row.userId}`, row.payoutMode])
  );
  const records = input.records
    .filter((record) =>
      record.dividendMonth >= input.fromMonth &&
      typeof record.referenceMarketValueKrw === "number" &&
      Number.isFinite(record.referenceMarketValueKrw) &&
      record.referenceMarketValueKrw > 0
    )
    .sort((left, right) => left.dividendMonth.localeCompare(right.dividendMonth));

  const rows: MonthlyInvestorPayoutRow[] = [];
  for (const record of records) {
    const { payouts } = calculateInvestorPayouts({
      dividendMonth: record.dividendMonth,
      totalMarketValueKrw: record.referenceMarketValueKrw ?? 0,
      actualDividendKrw: record.actualDividendKrw,
      investments: input.investments,
      withdrawals: input.withdrawals,
      totalReturnAccruals: accruals,
      payoutModeOf: (userId) =>
        bookedModes.get(`${record.dividendMonth}:${userId}`) ?? input.currentPayoutModeOf(userId)
    });
    for (const payout of payouts) {
      const row: MonthlyInvestorPayoutRow = {
        dividendMonth: record.dividendMonth,
        userId: payout.userId,
        payoutMode: payout.payoutMode,
        eligiblePrincipalKrw: Math.round(payout.investmentKrw),
        cashPayoutKrw: Math.round(payout.allocationKrw),
        totalReturnAccrualKrw: Math.round(payout.totalReturnAccrualKrw)
      };
      rows.push(row);
      if (row.totalReturnAccrualKrw > 0) {
        accruals.push({ userId: row.userId, dividendMonth: row.dividendMonth, amountKrw: row.totalReturnAccrualKrw });
      }
    }
  }
  return rows;
}
