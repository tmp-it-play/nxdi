import type { AppStore } from "./types.js";
import type { MonthlyInvestorPayoutRow } from "./monthly-investor-payouts.js";
import type { PayoutMode } from "./payout-mode.js";

export type InvestorBalance = {
  userId: string;
  userName: string;
  userEmail: string;
  payoutMode: PayoutMode | null;
  netPrincipalKrw: number;
  totalReturnBalanceKrw: number;
  totalBalanceKrw: number;
};

/**
 * Current balance per investor. Withdrawals reach total-return accruals only after the
 * investment principal, so the principal and accrual parts always add up to the total.
 */
export function investorBalances(
  store: AppStore,
  payoutRows: readonly MonthlyInvestorPayoutRow[],
  payoutModes: ReadonlyMap<string, PayoutMode>
): InvestorBalance[] {
  const investors = new Map<string, { userName: string; userEmail: string; invested: number; withdrawn: number; accrued: number }>();
  const investor = (userId: string, userName = "투자자", userEmail = "") => {
    let entry = investors.get(userId);
    if (!entry) {
      entry = { userName, userEmail, invested: 0, withdrawn: 0, accrued: 0 };
      investors.set(userId, entry);
    }
    return entry;
  };
  for (const intent of store.investmentIntents) {
    if (intent.status !== "COMPLETED") continue;
    investor(intent.userId, intent.userName, intent.userEmail).invested += intent.amountKrw;
  }
  for (const intent of store.withdrawalIntents) {
    if (intent.status !== "COMPLETED") continue;
    investor(intent.userId, intent.userName, intent.userEmail).withdrawn += intent.amountKrw;
  }
  for (const row of payoutRows) {
    if (row.totalReturnAccrualKrw > 0) investor(row.userId).accrued += row.totalReturnAccrualKrw;
  }

  return [...investors]
    .map(([userId, entry]) => {
      const netPrincipalKrw = Math.max(entry.invested - entry.withdrawn, 0);
      const totalBalanceKrw = Math.max(entry.invested + entry.accrued - entry.withdrawn, 0);
      return {
        userId,
        userName: entry.userName,
        userEmail: entry.userEmail,
        payoutMode: payoutModes.get(userId) ?? null,
        netPrincipalKrw,
        totalReturnBalanceKrw: totalBalanceKrw - netPrincipalKrw,
        totalBalanceKrw
      };
    })
    .filter((balance) => balance.totalBalanceKrw > 0)
    .sort((left, right) => right.totalBalanceKrw - left.totalBalanceKrw || left.userName.localeCompare(right.userName));
}
