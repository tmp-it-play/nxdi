import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateDividendAllocation,
  calculateExpectedInvestorDividend,
  PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE
} from "../src/domain/dividend-allocation.js";

describe("DividendAllocationPolicy", () => {
  describe("given investor and company principal with a company transfer allowance", () => {
    describe("when the investor base dividend is below the monthly cap", () => {
      it("then transfers only the allowed portion of the company dividend and allocates by investor weight", () => {
        const result = calculateDividendAllocation({
          actualDividendKrw: 1_000,
          selectedInvestmentKrw: 60_000,
          investorPrincipalKrw: 120_000,
          totalMarketValueKrw: 1_000_000
        });
        assert.equal(result.investorBaseDividendKrw, 120);
        assert.equal(result.companyTransferredDividendKrw, 176);
        assert.equal(result.managementFeeKrw, 30);
        assert.equal(result.investorDistributionPoolKrw, 266);
        assert.equal(result.allocationKrw, 133);
      });
    });
  });

  describe("given a high-yield portfolio", () => {
    describe("when expected investor payout is projected", () => {
      it("then never exceeds the product annual payout cap", () => {
        const result = calculateExpectedInvestorDividend({
          investmentKrw: 100_000,
          currentPortfolioMarketValueKrw: 1_000_000,
          annualPortfolioDividendYield: 0.12
        });
        assert.ok(result.expectedAnnualPayoutRate !== undefined);
        assert.ok(result.expectedAnnualPayoutRate <= PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE);
      });
    });

    describe("when investor entitlement exceeds the monthly cash payout cap", () => {
      it("then credits the excess to investor reinvestment instead of company retained income", () => {
        const result = calculateDividendAllocation({
          actualDividendKrw: 20_000,
          selectedInvestmentKrw: 1_000_000,
          investorPrincipalKrw: 1_000_000,
          totalMarketValueKrw: 1_250_000
        }) as unknown as Record<string, number>;

        assert.equal(result.investorBaseDividendKrw, 16_000);
        assert.equal(result.managementFeeKrw, 250);
        assert.equal(result.investorDistributionPoolKrw, 15_000);
        assert.equal(result.investorReinvestmentPoolKrw, 750);
        assert.equal(result.companyRetainedDividendKrw, 4_250);
        assert.equal(
          result.investorDistributionPoolKrw +
            result.investorReinvestmentPoolKrw +
            result.companyRetainedDividendKrw,
          result.actualDividendKrw
        );
      });
    });
  });

  describe("Given a 20,000 won eligible investor balance", () => {
    const input = {
      selectedInvestmentKrw: 20_000,
      investorPrincipalKrw: 20_000,
      totalMarketValueKrw: 20_000
    };

    describe("When the gross monthly allocation is 300 won", () => {
      it("Then it deducts five won under the annual 0.3 percent fee", () => {
        const result = calculateDividendAllocation({ ...input, actualDividendKrw: 300 });
        assert.equal(result.managementFeeKrw, 5);
        assert.equal(result.allocationKrw, 295);
      });
    });

    describe("When the gross allocation is below the monthly fee", () => {
      it("Then it uses only that allocation as the fee and pays zero without a shortfall", () => {
        const result = calculateDividendAllocation({ ...input, actualDividendKrw: 3 });
        assert.equal(result.managementFeeKrw, 3);
        assert.equal(result.allocationKrw, 0);
        assert.equal(result.investorNetEntitlementKrw, 0);
      });
    });

    describe("When there is no actual dividend", () => {
      it("Then it charges no fee", () => {
        const result = calculateDividendAllocation({ ...input, actualDividendKrw: 0 });
        assert.equal(result.managementFeeKrw, 0);
        assert.equal(result.allocationKrw, 0);
      });
    });
  });
});
