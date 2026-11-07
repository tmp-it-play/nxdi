import { parseCashBalance, type CashCurrency } from "../domain/cash-assets.js";

export type CashBalanceInput = { currency: CashCurrency; balance: string; expectedVersion: number };
export interface CashBalanceTransaction {
  find(currency: CashCurrency): Promise<{ balance: number; version: number } | null>;
  update(currency: CashCurrency, balance: number, version: number): Promise<boolean>;
  recordSnapshot(): Promise<void>;
}
export interface CashBalanceRepository {
  withTransaction<T>(work: (transaction: CashBalanceTransaction) => Promise<T>): Promise<T>;
}

export class UpdateCashBalanceService {
  constructor(private readonly repository: CashBalanceRepository) {}

  async execute(input: CashBalanceInput) {
    const balance = parseCashBalance(input.currency, input.balance);
    if (balance === undefined || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion > 2_147_483_647) {
      return { status: "invalid" as const };
    }
    return this.repository.withTransaction(async (transaction) => {
      const current = await transaction.find(input.currency);
      if (!current) return { status: "not_found" as const };
      if (current.version !== input.expectedVersion) return { status: "conflict" as const };
      if (current.balance === balance) return { status: "unchanged" as const };
      if (!await transaction.update(input.currency, balance, input.expectedVersion)) return { status: "conflict" as const };
      await transaction.recordSnapshot();
      return { status: "updated" as const };
    });
  }
}
