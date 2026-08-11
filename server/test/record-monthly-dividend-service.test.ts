import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RecordMonthlyDividendService,
  type MonthlyDividendRecordWrite
} from "../src/application/record-monthly-dividend-service.js";

describe("Given a confirmed month-end portfolio market value", () => {
  describe("When a monthly dividend is recorded", () => {
    it("Then it persists the market value as the dividend-yield reference", async () => {
      const requestedMonths: string[] = [];
      const writes: MonthlyDividendRecordWrite[] = [];
      const service = new RecordMonthlyDividendService({
        async readReferenceMarketValueKrw(dividendMonth) {
          requestedMonths.push(dividendMonth);
          return 638_240;
        },
        async save(record) {
          writes.push(record);
        }
      });

      const result = await service.execute({
        dividendMonth: "2026-07",
        actualDividendKrw: 9_155
      });

      assert.deepEqual(result, {
        status: "recorded",
        referenceMarketValueKrw: 638_240
      });
      assert.deepEqual(requestedMonths, ["2026-07"]);
      assert.deepEqual(writes, [
        {
          dividendMonth: "2026-07",
          actualDividendKrw: 9_155,
          referenceMarketValueKrw: 638_240
        }
      ]);
    });
  });
});

describe("Given no confirmed month-end portfolio market value", () => {
  describe("When a monthly dividend is recorded", () => {
    it("Then it reports the missing snapshot without saving a partial record", async () => {
      const writes: MonthlyDividendRecordWrite[] = [];
      const service = new RecordMonthlyDividendService({
        async readReferenceMarketValueKrw() {
          return undefined;
        },
        async save(record) {
          writes.push(record);
        }
      });

      const result = await service.execute({
        dividendMonth: "2026-07",
        actualDividendKrw: 9_155
      });

      assert.deepEqual(result, { status: "month_end_snapshot_required" });
      assert.deepEqual(writes, []);
    });
  });
});
