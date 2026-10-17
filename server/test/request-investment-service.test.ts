import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RequestInvestmentService,
  type InvestmentIntentRepository,
  type InvestmentRequestInput
} from "../src/application/request-investment-service.js";
import type { InvestmentIntent } from "../src/domain/types.js";

const input: InvestmentRequestInput = {
  userId: "user-1",
  userName: "사용자",
  userEmail: "user@example.com",
  amountKrw: 100_000,
  depositorName: "사용자",
  contact: "user@example.com",
  guardianConfirmed: false,
  dividendPolicyAgreed: true
};

const createdIntent: InvestmentIntent = {
  ...input,
  id: "intent-1",
  type: "INVESTMENT",
  status: "PENDING",
  createdAt: "2026-07-23T00:00:00.000Z",
  updatedAt: "2026-07-23T00:00:00.000Z"
};

function repositoryFor(completedInvestmentIntentKrw: number, portfolioMarketValueKrw: number) {
  let createCalls = 0;
  const repository: InvestmentIntentRepository = {
    completedInvestmentIntentAmount: async () => completedInvestmentIntentKrw,
    portfolioMarketValueKrw: async () => portfolioMarketValueKrw,
    create: async () => {
      createCalls += 1;
      return createdIntent;
    }
  };
  return { repository, createCalls: () => createCalls };
}

describe("Given completed investment intents equal to 50% of the portfolio value", () => {
  describe("When a new investment intent is requested", () => {
    it("Then it accepts the request because the limit has not been exceeded", async () => {
      const fake = repositoryFor(5_000_000, 10_000_000);
      const result = await new RequestInvestmentService(fake.repository).execute(input);

      assert.equal(result.status, "created");
      assert.equal(result.availability.isPaused, false);
      assert.equal(fake.createCalls(), 1);
    });
  });
});

describe("Given completed investment intents above 50% of the portfolio value", () => {
  describe("When a new investment intent is requested", () => {
    it("Then it pauses intake without saving the request", async () => {
      const fake = repositoryFor(5_000_001, 10_000_000);
      const result = await new RequestInvestmentService(fake.repository).execute(input);

      assert.equal(result.status, "paused");
      assert.equal(result.availability.isPaused, true);
      assert.equal(result.availability.maxCompletedInvestmentIntentKrw, 5_000_000);
      assert.equal(fake.createCalls(), 0);
    });
  });
});

describe("Given a portfolio with no current market value and a completed investment intent", () => {
  describe("When a new investment intent is requested", () => {
    it("Then it pauses intake because any completed amount exceeds the zero limit", async () => {
      const fake = repositoryFor(1, 0);
      const result = await new RequestInvestmentService(fake.repository).execute(input);

      assert.equal(result.status, "paused");
      assert.equal(fake.createCalls(), 0);
    });
  });
});
