import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpdateCashBalanceService, type CashBalanceRepository } from "../src/application/update-cash-balance-service.js";

function fixture(options: { failSnapshot?: boolean; missing?: boolean; race?: boolean } = {}) {
  let state = { balance: 55500, version: 0, initialCostBasisKrw: 55500 };
  let snapshots = 0;
  let transactions = 0;
  const repository: CashBalanceRepository = {
    async withTransaction(work) {
      transactions++;
      const next = { ...state };
      let recorded = false;
      const result = await work({
        find: async () => options.missing ? null : { ...next },
        update: async (_currency, balance, version) => {
          if (options.race || next.version !== version) return false;
          next.balance = balance; next.version++;
          return true;
        },
        recordSnapshot: async () => {
          if (options.failSnapshot) throw new Error("Snapshot write failed");
          recorded = true;
        }
      });
      state = next;
      if (recorded) snapshots++;
      return result;
    }
  };
  return { service: new UpdateCashBalanceService(repository), read: () => ({ ...state, snapshots, transactions }) };
}

describe("Given a cash balance with a fixed principal", () => {
  describe("When the balance is changed", () => {
    it("Then saves the balance and snapshot together without changing principal", async () => {
      const f = fixture();
      assert.equal((await f.service.execute({ currency: "KRW", balance: "60000", expectedVersion: 0 })).status, "updated");
      assert.deepEqual(f.read(), { balance: 60000, version: 1, initialCostBasisKrw: 55500, snapshots: 1, transactions: 1 });
    });
    it("Then retains the asset when set to zero", async () => {
      const f = fixture();
      assert.equal((await f.service.execute({ currency: "KRW", balance: "0", expectedVersion: 0 })).status, "updated");
      assert.equal(f.read().balance, 0);
      assert.equal(f.read().initialCostBasisKrw, 55500);
    });
  });
  describe("When the snapshot write fails", () => {
    it("Then rejects the operation and leaves the previous balance intact", async () => {
      const f = fixture({ failSnapshot: true });
      await assert.rejects(f.service.execute({ currency: "KRW", balance: "60000", expectedVersion: 0 }), /Snapshot write failed/);
      assert.equal(f.read().balance, 55500);
      assert.equal(f.read().version, 0);
      assert.equal(f.read().snapshots, 0);
    });
  });
  describe("When an outdated editor saves", () => {
    it("Then rejects version conflicts without overwriting current data", async () => {
      const f = fixture();
      assert.equal((await f.service.execute({ currency: "KRW", balance: "60000", expectedVersion: 1 })).status, "conflict");
      assert.equal(f.read().balance, 55500);
      const raced = fixture({ race: true });
      assert.equal((await raced.service.execute({ currency: "KRW", balance: "60000", expectedVersion: 0 })).status, "conflict");
      assert.equal(raced.read().snapshots, 0);
    });
  });
  describe("When the amount is unchanged or invalid", () => {
    it("Then skips redundant snapshots and rejects invalid amounts before opening a transaction", async () => {
      const f = fixture();
      assert.equal((await f.service.execute({ currency: "KRW", balance: "55500", expectedVersion: 0 })).status, "unchanged");
      assert.equal(f.read().snapshots, 0);
      for (const balance of ["", "-1", "1.01"]) {
        assert.equal((await f.service.execute({ currency: "KRW", balance, expectedVersion: 0 })).status, "invalid");
      }
      assert.equal(f.read().transactions, 1);
    });
    it("Then reports an uninitialized currency without creating it", async () => {
      const f = fixture({ missing: true });
      assert.equal((await f.service.execute({ currency: "USD", balance: "100", expectedVersion: 0 })).status, "not_found");
      assert.equal(f.read().snapshots, 0);
    });
  });
});
