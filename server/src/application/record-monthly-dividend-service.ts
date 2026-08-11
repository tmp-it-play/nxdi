export type MonthlyDividendRecordWrite = {
  dividendMonth: string;
  actualDividendKrw: number;
  referenceMarketValueKrw: number;
};

export interface RecordMonthlyDividendDependencies {
  readReferenceMarketValueKrw(dividendMonth: string): Promise<number | undefined>;
  save(record: MonthlyDividendRecordWrite): Promise<void>;
}

export class RecordMonthlyDividendService {
  constructor(private readonly dependencies: RecordMonthlyDividendDependencies) {}

  async execute(input: Omit<MonthlyDividendRecordWrite, "referenceMarketValueKrw">) {
    const referenceMarketValueKrw =
      await this.dependencies.readReferenceMarketValueKrw(input.dividendMonth);
    if (
      typeof referenceMarketValueKrw !== "number" ||
      !Number.isFinite(referenceMarketValueKrw) ||
      referenceMarketValueKrw <= 0
    ) {
      return { status: "month_end_snapshot_required" as const };
    }

    await this.dependencies.save({
      ...input,
      referenceMarketValueKrw
    });

    return {
      status: "recorded" as const,
      referenceMarketValueKrw
    };
  }
}
