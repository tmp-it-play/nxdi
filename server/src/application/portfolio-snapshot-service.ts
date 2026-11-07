export type SnapshotState = {
  cashBalanceKrw?: number | null;
  cashBalanceUsd?: number | null;
  cashMarketValueKrw?: number | null;
  cashCostBasisKrw?: number | null;

  totalMarketValueKrw: number;
  exchangeRate: number;
  costBasisKrw: number | null;
  annualDividendKrw: number | null;
  closedAt: Date | null;
};

export interface SnapshotRepository {
  find(date: string): Promise<SnapshotState | null>;
  close(date: string, values: Omit<SnapshotState, "closedAt"> & { closedAt: Date }): Promise<boolean>;
}

export class PortfolioSnapshotService {
  constructor(
    private readonly repository: SnapshotRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  async finalize(date: string) {
    const snapshot = await this.repository.find(date);
    if (!snapshot) return { status: "not_found" as const };
    if (snapshot.closedAt) return { status: "already_closed" as const, closedAt: snapshot.closedAt };
    const closedAt = this.now();
    const closed = await this.repository.close(date, {
      totalMarketValueKrw: snapshot.totalMarketValueKrw,
      exchangeRate: snapshot.exchangeRate,
      costBasisKrw: snapshot.costBasisKrw,
      annualDividendKrw: snapshot.annualDividendKrw,
      cashBalanceKrw: snapshot.cashBalanceKrw,
      cashBalanceUsd: snapshot.cashBalanceUsd,
      cashMarketValueKrw: snapshot.cashMarketValueKrw,
      cashCostBasisKrw: snapshot.cashCostBasisKrw,
      closedAt
    });
    if (!closed) return { status: "already_closed" as const };
    return { status: "closed" as const, closedAt };
  }
}
