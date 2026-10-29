import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateDividendAllocation, type DividendAllocationInput } from "./dividend-allocation";

const SERVER_POLICY = {
  companyDividendTransferRate: 0.2,
  annualManagementFeeRate: 0.003,
  monthlyInvestorDividendCapRate: 0.18 / 12
};

function previewInput(overrides: Partial<DividendAllocationInput> = {}): DividendAllocationInput {
  return {
    actualDividendKrw: 100_000,
    selectedInvestmentKrw: 50_000_000,
    investorPrincipalKrw: 100_000_000,
    totalMarketValueKrw: 200_000_000,
    ...SERVER_POLICY,
    ...overrides
  };
}

describe("Given the policy DTO supplied by the server", () => {
  describe("when the browser renders an instant dividend-allocation preview", () => {
    it("then mirrors the server policy calculation without owning policy defaults", () => {
      const allocation = calculateDividendAllocation(previewInput());

      assert.equal(allocation.companyDividendTransferRate, 0.2);
      assert.equal(allocation.monthlyInvestorDividendCapRate, 0.18 / 12);
      assert.equal(allocation.companyTransferredDividendKrw, 10_000);
      assert.equal(allocation.managementFeeKrw, 25_000);
      assert.equal(allocation.investorDistributionPoolKrw, 35_000);
      assert.equal(allocation.selectedInvestorWeight, 0.5);
      assert.equal(allocation.allocationKrw, 17_500);
    });

    it("then clamps malformed rates defensively instead of introducing fallback policy", () => {
      const allocation = calculateDividendAllocation(previewInput({
        companyDividendTransferRate: Number.POSITIVE_INFINITY,
        annualManagementFeeRate: Number.POSITIVE_INFINITY,
        monthlyInvestorDividendCapRate: -0.1
      }));

      assert.equal(allocation.companyDividendTransferRate, 0);
      assert.equal(allocation.monthlyInvestorDividendCapRate, 0);
      assert.equal(allocation.investorDistributionPoolKrw, 0);
    });
  });
});
