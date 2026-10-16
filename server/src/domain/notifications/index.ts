import {
  calculateInvestorPayouts,
  type InvestorPayout,
  type TotalReturnAccrual
} from "../monthly-investor-payouts.js";
import { DEFAULT_PAYOUT_MODE, type PayoutMode } from "../payout-mode.js";
import type { InvestmentIntent } from "../types.js";

export type NotificationType = "DISCLOSURE" | "MONTHLY_PAYOUT" | "QUARTERLY_HOLDINGS";
export type RenderedEmail = { subject: string; html: string; text: string };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function validDate(date: Date) {
  if (!Number.isFinite(date.getTime())) throw new RangeError("유효한 날짜가 필요합니다.");
  return date;
}

export function kstDateKey(now: Date) {
  return new Date(validDate(now).getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function validateDividendMonth(month: string) {
  if (!MONTH_PATTERN.test(month) || month.startsWith("0000")) {
    throw new RangeError("배당월은 YYYY-MM 형식이어야 합니다.");
  }
  return month;
}

function shiftMonth(month: string, offset: number) {
  validateDividendMonth(month);
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function previousDividendMonth(now: Date) {
  return shiftMonth(kstDateKey(now).slice(0, 7), -1);
}

export type DueNotificationPeriods = {
  monthly: string[];
  quarterly: Array<{ period: string; status: "DUE" | "SKIPPED" }>;
};

/** Enumerates scheduled dates, so starting mid-period never backfills pre-activation mail. */
export function dueNotificationPeriods(activatedAt: Date, now: Date): DueNotificationPeriods {
  validDate(activatedAt);
  validDate(now);
  const result: DueNotificationPeriods = { monthly: [], quarterly: [] };
  if (activatedAt > now) return result;
  let month = kstDateKey(activatedAt).slice(0, 7);
  const currentMonth = kstDateKey(now).slice(0, 7);
  const currentQuarter = `${currentMonth.slice(0, 4)}-Q${Math.ceil(Number(currentMonth.slice(5)) / 3)}`;
  while (month <= currentMonth) {
    const scheduledAt = new Date(`${month}-01T00:00:00+09:00`);
    if (scheduledAt >= activatedAt && scheduledAt <= now) {
      result.monthly.push(shiftMonth(month, -1));
      const monthNumber = Number(month.slice(5));
      if ((monthNumber - 1) % 3 === 0) {
        const period = `${month.slice(0, 4)}-Q${Math.ceil(monthNumber / 3)}`;
        result.quarterly.push({ period, status: period === currentQuarter ? "DUE" : "SKIPPED" });
      }
    }
    month = shiftMonth(month, 1);
  }
  return result;
}

export type InvestorRecipient = { userId: string; userName: string; investmentKrw: number };
export type NotificationIntent = Pick<InvestmentIntent, "id" | "userId" | "userName" | "status" | "amountKrw" | "updatedAt">;
export type NotificationStore = {
  investmentIntents: readonly NotificationIntent[];
  withdrawalIntents: readonly NotificationIntent[];
};

function nonnegativeAmount(value: number, label: string, positive = false) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
    throw new RangeError(`${label}은 ${positive ? "0보다 큰" : "0 이상의"} 유한한 금액이어야 합니다.`);
  }
  return value;
}

export function validateWholeKrw(value: number, label: string, positive = false) {
  nonnegativeAmount(value, label, positive);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label}은 안전한 범위의 원 단위 정수여야 합니다.`);
  return value;
}

export function activeInvestorRecipients(store: NotificationStore): InvestorRecipient[] {
  const recipients = new Map<string, InvestorRecipient>();
  for (const intent of store.investmentIntents) {
    if (intent.status !== "COMPLETED") continue;
    nonnegativeAmount(intent.amountKrw, "투자금액");
    const current = recipients.get(intent.userId);
    recipients.set(intent.userId, {
      userId: intent.userId,
      userName: current?.userName ?? intent.userName,
      investmentKrw: (current?.investmentKrw ?? 0) + intent.amountKrw
    });
  }
  for (const intent of store.withdrawalIntents) {
    if (intent.status !== "COMPLETED") continue;
    nonnegativeAmount(intent.amountKrw, "출금금액");
    const current = recipients.get(intent.userId);
    if (current) current.investmentKrw -= intent.amountKrw;
  }
  return [...recipients.values()].filter((recipient) => recipient.investmentKrw > 0);
}

export type MonthlyPayoutRecipient = InvestorRecipient & {
  payoutMode: PayoutMode;
  allocationKrw: number;
  displayedKrw: number;
  managementFeeKrw: number;
  reinvestmentKrw: number;
  totalReturnAccrualKrw: number;
};

export function recipientPayout(recipient: InvestorRecipient, payout: InvestorPayout): MonthlyPayoutRecipient {
  if (![payout.allocationKrw, payout.managementFeeKrw, payout.reinvestmentKrw, payout.totalReturnAccrualKrw].every(Number.isFinite)) {
    throw new RangeError("지급액 계산 결과가 유효한 금액 범위를 벗어났습니다.");
  }
  return {
    ...recipient,
    payoutMode: payout.payoutMode,
    allocationKrw: payout.allocationKrw,
    displayedKrw: Math.round(payout.allocationKrw),
    managementFeeKrw: payout.managementFeeKrw,
    reinvestmentKrw: payout.reinvestmentKrw,
    totalReturnAccrualKrw: Math.round(payout.totalReturnAccrualKrw)
  };
}

export type CalculateMonthlyPayoutsInput = {
  store: NotificationStore;
  dividendMonth: string;
  totalMarketValueKrw: number;
  actualDividendKrw: number;
  totalReturnAccruals?: readonly TotalReturnAccrual[];
  payoutModeOf?: (userId: string) => PayoutMode;
};

export function calculateMonthlyPayouts(input: CalculateMonthlyPayoutsInput) {
  validateDividendMonth(input.dividendMonth);
  nonnegativeAmount(input.totalMarketValueKrw, "포트폴리오 총액");
  nonnegativeAmount(input.actualDividendKrw, "월 실배당금");
  const investments = input.store.investmentIntents.filter((intent) => intent.status === "COMPLETED");
  const withdrawals = input.store.withdrawalIntents.filter((intent) => intent.status === "COMPLETED");
  const principalEntries = (entries: typeof investments | typeof withdrawals) => entries.map((intent) => {
    nonnegativeAmount(intent.amountKrw, "의향 금액");
    validDate(new Date(intent.updatedAt));
    return { id: intent.id, userId: intent.userId, amountKrw: intent.amountKrw, completedAt: intent.updatedAt };
  });
  for (const accrual of input.totalReturnAccruals ?? []) nonnegativeAmount(accrual.amountKrw, "토탈 리턴 편입액");
  const { payouts, investorPrincipalKrw } = calculateInvestorPayouts({
    dividendMonth: input.dividendMonth,
    totalMarketValueKrw: input.totalMarketValueKrw,
    actualDividendKrw: input.actualDividendKrw,
    investments: principalEntries(investments),
    withdrawals: principalEntries(withdrawals),
    totalReturnAccruals: input.totalReturnAccruals,
    payoutModeOf: input.payoutModeOf ?? (() => DEFAULT_PAYOUT_MODE)
  });
  nonnegativeAmount(investorPrincipalKrw, "전체 적격 투자금액");
  const names = new Map(investments.map((intent) => [intent.userId, intent.userName]));
  const recipients = payouts.map((payout) => recipientPayout({
    userId: payout.userId,
    userName: names.get(payout.userId) ?? "투자자",
    investmentKrw: payout.investmentKrw
  }, payout));
  const unroundedTotalKrw = recipients.reduce((sum, recipient) => sum + recipient.allocationKrw, 0);
  const displayedTotalKrw = recipients.reduce((sum, recipient) => sum + recipient.displayedKrw, 0);
  return {
    recipients,
    investorPrincipalKrw,
    unroundedTotalKrw,
    displayedTotalKrw,
    roundingDifferenceKrw: displayedTotalKrw - unroundedTotalKrw
  };
}
