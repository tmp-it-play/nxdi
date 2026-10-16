import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApplyHoldingTradeService,
  type HoldingTradeExecution,
  type HoldingTradeRepository,
  type HoldingTradeState,
  type HoldingTradeUpdate
} from "../src/application/apply-holding-trade-service.js";

const FIXED_EXECUTION_TIME = "2026-07-23T01:00:00.000Z";
const fixedNow = () => new Date(FIXED_EXECUTION_TIME);

function serialRepository(initial: HoldingTradeState) {
  let state: HoldingTradeState | null = { ...initial };
  let queue = Promise.resolve();
  const updates: HoldingTradeUpdate[] = [];
  const executions: HoldingTradeExecution[] = [];
  const repository: HoldingTradeRepository = {
    withSymbolTransaction(_symbol, work) {
      const operation = queue.then(() => work({
        async find() { return state ? { ...state } : null; },
        async update(values) {
          assert.ok(state);
          updates.push(values);
          state = { ...state, ...values };
        },
        async delete() { state = null; },
        async recordExecution(values) { executions.push(values); }
      }));
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    }
  };
  return { repository, updates, executions, state: () => state };
}

describe("ApplyHoldingTradeService", () => {
  describe("given a metadata-only holding with zero quantity", () => {
    describe("when its first purchase is executed", () => {
      it("then creates quantity and cost basis only through the execution record", async () => {
        const executions: HoldingTradeExecution[] = [];
        let state: HoldingTradeState = {
          symbol: "NEW",
          currency: "USD",
          quantity: 0,
          lastPrice: 10,
          averagePurchasePrice: null,
          purchaseExchangeRate: null,
          riskLevel: "LOW"
        };
        const service = new ApplyHoldingTradeService({
          async withSymbolTransaction(_symbol, work) {
            return work({
              async find() { return state; },
              async update(values) { state = { ...state, ...values }; },
              async delete() { throw new Error("not expected"); },
              async recordExecution(values) { executions.push(values); }
            });
          }
        }, fixedNow);

        const result = await service.execute({
          symbol: "NEW",
          side: "BUY",
          quantity: 2,
          orderPrice: 11,
          exchangeRate: 1400
        });

        assert.equal(result.status, "updated");
        assert.equal(state.quantity, 2);
        assert.equal(state.averagePurchasePrice, 11);
        assert.equal(state.purchaseExchangeRate, 1400);
        assert.equal(executions.length, 1);
        assert.equal(executions[0]?.executedAt, FIXED_EXECUTION_TIME);
      });
    });
  });
  describe("given ten shares and two concurrent sell requests for six shares", () => {
    describe("when transactions serialize on the holding", () => {
      it("then applies one sale and rejects the other without going negative", async () => {
        const fake = serialRepository({
          symbol: "SCHD",
          currency: "USD",
          quantity: 10,
          lastPrice: 20,
          averagePurchasePrice: 15,
          purchaseExchangeRate: 1300
        });
        const service = new ApplyHoldingTradeService(fake.repository, fixedNow);
        const results = await Promise.all([
          service.execute({ symbol: "SCHD", side: "SELL", quantity: 6, orderPrice: 20, exchangeRate: 1_400 }),
          service.execute({ symbol: "SCHD", side: "SELL", quantity: 6, orderPrice: 20, exchangeRate: 1_400 })
        ]);
        assert.deepEqual(results.map((result) => result.status).sort(), ["insufficient_quantity", "updated"]);
        assert.equal(fake.state()?.quantity, 4);
        assert.equal(fake.updates.length, 1);
      });
    });
  });

  describe("given an existing USD holding", () => {
    describe("when buying at a different price and exchange rate", () => {
      it("then updates weighted native cost and weighted KRW exchange cost including fees and taxes", async () => {
        const fake = serialRepository({
          symbol: "SCHD",
          currency: "USD",
          quantity: 10,
          lastPrice: 10,
          averagePurchasePrice: 10,
          purchaseExchangeRate: 1000,
          riskLevel: "LOW"
        });
        const result = await new ApplyHoldingTradeService(fake.repository, fixedNow).execute({
          symbol: "SCHD",
          side: "BUY",
          quantity: 10,
          orderPrice: 20,
          exchangeRate: 1500,
          feeKrw: 500,
          taxKrw: 100
        });
        assert.equal(result.status, "updated");
        assert.equal(fake.state()?.quantity, 20);
        const state = fake.state()!;
        assert.ok(Math.abs(state.averagePurchasePrice! - 15.02) < 1e-9);
        assert.ok(Math.abs(state.quantity * state.averagePurchasePrice! * state.purchaseExchangeRate! - 400_600) < 1e-6);
        assert.equal(fake.executions[0]?.side, "BUY");
        assert.equal(fake.executions[0]?.cashAmountKrw, 300_600);
      });
    });
  });

  describe("Given an existing classified USD holding", () => {
    describe("When gifted shares are received with an acquisition value", () => {
      it("Then updates cost basis without cash movement or replacing the market price", async () => {
        const fake = serialRepository({
          symbol: "SCHD",
          currency: "USD",
          quantity: 10,
          lastPrice: 25,
          averagePurchasePrice: 10,
          purchaseExchangeRate: 1000,
          riskLevel: "LOW"
        });

        const result = await new ApplyHoldingTradeService(fake.repository, fixedNow).execute({
          symbol: "SCHD",
          side: "GIFT_IN",
          quantity: 5,
          orderPrice: 20,
          exchangeRate: 1500,
          feeKrw: 500,
          taxKrw: 100
        });

        assert.equal(result.status, "updated");
        assert.equal(fake.state()?.quantity, 15);
        assert.equal(fake.state()?.lastPrice, 25);
        assert.equal(fake.state()?.averagePurchasePrice, 200 / 15);
        assert.equal(fake.state()?.purchaseExchangeRate, 1250);
        assert.ok(Math.abs((fake.updates.at(-1)?.profitLossRate ?? 0) - 0.875) < 1e-12);
        assert.equal(fake.executions[0]?.side, "GIFT_IN");
        assert.equal(fake.executions[0]?.grossAmountKrw, 150_000);
        assert.equal(fake.executions[0]?.cashAmountKrw, 0);
        assert.equal(fake.executions[0]?.feeKrw, 0);
        assert.equal(fake.executions[0]?.taxKrw, 0);
        assert.equal(fake.executions[0]?.executedAt, FIXED_EXECUTION_TIME);
      });
    });
  });

  describe("Given a classified metadata-only holding", () => {
    describe("When its opening balance is received as a gift", () => {
      it("Then initializes cost basis while preserving its current market price", async () => {
        const fake = serialRepository({
          symbol: "005930",
          currency: "KRW",
          quantity: 0,
          lastPrice: 10_000,
          averagePurchasePrice: null,
          purchaseExchangeRate: null,
          riskLevel: "LOW"
        });

        const result = await new ApplyHoldingTradeService(fake.repository, fixedNow).execute({
          symbol: "005930",
          side: "GIFT_IN",
          quantity: 4,
          orderPrice: 9_000
        });

        assert.equal(result.status, "updated");
        assert.equal(fake.state()?.quantity, 4);
        assert.equal(fake.state()?.lastPrice, 10_000);
        assert.equal(fake.state()?.averagePurchasePrice, 9_000);
        assert.equal(fake.state()?.purchaseExchangeRate, null);
        assert.equal(fake.executions[0]?.cashAmountKrw, 0);
      });
    });
  });

  describe("Given an existing holding without a risk classification", () => {
    describe("When gifted shares are received", () => {
      it("Then rejects the increased exposure without changing the holding", async () => {
        const fake = serialRepository({
          symbol: "SCHD",
          currency: "USD",
          quantity: 10,
          lastPrice: 25,
          averagePurchasePrice: 10,
          purchaseExchangeRate: 1000,
          riskLevel: null
        });

        const result = await new ApplyHoldingTradeService(fake.repository, fixedNow).execute({
          symbol: "SCHD",
          side: "GIFT_IN",
          quantity: 5,
          orderPrice: 20,
          exchangeRate: 1500
        });

        assert.equal(result.status, "risk_unclassified");
        assert.equal(fake.state()?.quantity, 10);
        assert.equal(fake.updates.length, 0);
        assert.equal(fake.executions.length, 0);
      });
    });
  });

  describe("Given a USD holding bought at 10 dollars and 1,000 won", () => {
    describe("When part of it is sold at 12 dollars and 1,200 won with a fee", () => {
      it("Then records the realized profit and the FX share of it on the execution", async () => {
        const fake = serialRepository({
          symbol: "SCHD", currency: "USD", quantity: 10, lastPrice: 12,
          averagePurchasePrice: 10, purchaseExchangeRate: 1000, riskLevel: "LOW"
        });

        const result = await new ApplyHoldingTradeService(fake.repository, fixedNow).execute({
          symbol: "SCHD", side: "SELL", quantity: 5, orderPrice: 12, exchangeRate: 1200, feeKrw: 100
        });

        assert.equal(result.status, "updated");
        assert.equal(fake.executions[0]?.cashAmountKrw, 71_900);
        assert.equal(fake.executions[0]?.costBasisKrw, 50_000);
        assert.equal(fake.executions[0]?.realizedProfitLossKrw, 21_900);
        assert.equal(fake.executions[0]?.realizedFxGainLossKrw, 12_000);
      });
    });

    describe("When the whole position is sold", () => {
      it("Then keeps the realized result even though the holding is removed", async () => {
        const fake = serialRepository({
          symbol: "SCHD", currency: "USD", quantity: 10, lastPrice: 9,
          averagePurchasePrice: 10, purchaseExchangeRate: 1000, riskLevel: "LOW"
        });

        const result = await new ApplyHoldingTradeService(fake.repository, fixedNow).execute({
          symbol: "SCHD", side: "SELL", quantity: 10, orderPrice: 9, exchangeRate: 1100
        });

        assert.equal(result.status, "deleted");
        assert.equal(fake.executions[0]?.realizedProfitLossKrw, -1_000);
        assert.equal(fake.executions[0]?.realizedFxGainLossKrw, 9_000);
      });
    });
  });
});
