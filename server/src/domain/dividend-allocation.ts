import {
  PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE,
  PRODUCT_ANNUAL_MANAGEMENT_FEE_RATE,
  PRODUCT_COMPANY_DIVIDEND_TRANSFER_RATE,
  PRODUCT_MONTHLY_INVESTOR_DIVIDEND_CAP_RATE
} from "./product-policy.js";

export {
  PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE,
  PRODUCT_COMPANY_DIVIDEND_TRANSFER_RATE,
  PRODUCT_MONTHLY_INVESTOR_DIVIDEND_CAP_RATE
};

export type DividendAllocationInput = {
  actualDividendKrw: number;
  selectedInvestmentKrw: number;
  investorPrincipalKrw: number;
  totalMarketValueKrw: number;
  companyDividendTransferRate?: number;
  monthlyInvestorDividendCapRate?: number;
};

function positiveAmount(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function cappedRate(value: number | undefined, fallback: number) {
  const rate = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(Math.max(rate, 0), 1);
}

export function calculateDividendAllocation(input: DividendAllocationInput) {
  const actualDividendKrw = positiveAmount(input.actualDividendKrw);
  const selectedInvestmentKrw = positiveAmount(input.selectedInvestmentKrw);
  const investorPrincipalKrw = positiveAmount(input.investorPrincipalKrw);
  const totalMarketValueKrw = positiveAmount(input.totalMarketValueKrw);
  const companyDividendTransferRate = cappedRate(
    input.companyDividendTransferRate,
    PRODUCT_COMPANY_DIVIDEND_TRANSFER_RATE
  );
  const monthlyInvestorDividendCapRate = cappedRate(
    input.monthlyInvestorDividendCapRate,
    PRODUCT_MONTHLY_INVESTOR_DIVIDEND_CAP_RATE
  );

  const companyPrincipalKrw = Math.max(totalMarketValueKrw - investorPrincipalKrw, 0);
  const dividendBaseKrw = investorPrincipalKrw + companyPrincipalKrw;
  const investorBaseWeight = dividendBaseKrw > 0 ? investorPrincipalKrw / dividendBaseKrw : 0;
  const investorBaseDividendKrw = actualDividendKrw * investorBaseWeight;
  const companyBaseDividendKrw = Math.max(actualDividendKrw - investorBaseDividendKrw, 0);
  const investorDividendCapKrw = investorPrincipalKrw * monthlyInvestorDividendCapRate;
  const companyTransferNeedKrw = Math.max(investorDividendCapKrw - investorBaseDividendKrw, 0);
  const companyTransferLimitKrw = companyBaseDividendKrw * companyDividendTransferRate;
  const companyTransferredDividendKrw = Math.min(
    companyTransferNeedKrw,
    companyTransferLimitKrw,
    companyBaseDividendKrw
  );
  const investorGrossEntitlementKrw = Math.min(
    investorBaseDividendKrw + companyTransferredDividendKrw,
    actualDividendKrw
  );
  // Collect only from this month's entitlement; an uncovered fee is waived.
  const managementFeeKrw = Math.min(
    investorGrossEntitlementKrw,
    investorPrincipalKrw * PRODUCT_ANNUAL_MANAGEMENT_FEE_RATE / 12
  );
  const investorNetEntitlementKrw = Math.max(investorGrossEntitlementKrw - managementFeeKrw, 0);
  const investorDistributionPoolKrw = Math.min(
    investorNetEntitlementKrw,
    investorDividendCapKrw,
    actualDividendKrw
  );
  const investorReinvestmentPoolKrw = Math.max(
    investorNetEntitlementKrw - investorDistributionPoolKrw,
    0
  );
  const selectedInvestorWeight =
    investorPrincipalKrw > 0 ? Math.min(selectedInvestmentKrw / investorPrincipalKrw, 1) : 0;
  const allocationKrw = investorDistributionPoolKrw * selectedInvestorWeight;
  const selectedInvestorReinvestmentKrw = investorReinvestmentPoolKrw * selectedInvestorWeight;
  const selectedManagementFeeKrw = managementFeeKrw * selectedInvestorWeight;

  return {
    actualDividendKrw,
    investorPrincipalKrw,
    companyPrincipalKrw,
    dividendBaseKrw,
    investorBaseWeight,
    investorBaseDividendKrw,
    companyBaseDividendKrw,
    companyDividendTransferRate,
    companyTransferNeedKrw,
    companyTransferLimitKrw,
    companyTransferredDividendKrw,
    annualManagementFeeRate: PRODUCT_ANNUAL_MANAGEMENT_FEE_RATE,
    investorGrossEntitlementKrw,
    managementFeeKrw,
    investorNetEntitlementKrw,
    monthlyInvestorDividendCapRate,
    investorDividendCapKrw,
    investorDistributionPoolKrw,
    investorReinvestmentPoolKrw,
    companyRetainedDividendKrw: Math.max(
      actualDividendKrw - investorDistributionPoolKrw - investorReinvestmentPoolKrw,
      0
    ),
    selectedInvestorWeight,
    allocationKrw,
    selectedInvestorReinvestmentKrw,
    selectedManagementFeeKrw
  };
}

export type ExpectedInvestorDividendInput = {
  investmentKrw: number;
  currentPortfolioMarketValueKrw: number;
  annualPortfolioDividendYield: number;
  currentInvestorPrincipalKrw?: number;
};

export function calculateExpectedInvestorDividend(input: ExpectedInvestorDividendInput) {
  const investmentKrw = positiveAmount(input.investmentKrw);
  const currentPortfolioMarketValueKrw = positiveAmount(input.currentPortfolioMarketValueKrw);
  const annualPortfolioDividendYield = positiveAmount(input.annualPortfolioDividendYield);
  const currentInvestorPrincipalKrw = positiveAmount(input.currentInvestorPrincipalKrw ?? 0);
  const projectedTotalMarketValueKrw = currentPortfolioMarketValueKrw + investmentKrw;
  const projectedInvestorPrincipalKrw = currentInvestorPrincipalKrw + investmentKrw;
  const projectedMonthlyActualDividendKrw =
    projectedTotalMarketValueKrw * annualPortfolioDividendYield / 12;
  const allocation = calculateDividendAllocation({
    actualDividendKrw: projectedMonthlyActualDividendKrw,
    selectedInvestmentKrw: investmentKrw,
    investorPrincipalKrw: projectedInvestorPrincipalKrw,
    totalMarketValueKrw: projectedTotalMarketValueKrw
  });
  const monthlyExpectedDividendKrw = allocation.allocationKrw;
  const annualExpectedDividendKrw = monthlyExpectedDividendKrw * 12;

  return {
    ...allocation,
    investmentKrw,
    currentInvestorPrincipalKrw,
    annualPortfolioDividendYield,
    projectedTotalMarketValueKrw,
    projectedInvestorPrincipalKrw,
    projectedMonthlyActualDividendKrw,
    monthlyExpectedDividendKrw,
    annualExpectedDividendKrw,
    expectedAnnualPayoutRate:
      investmentKrw > 0 ? annualExpectedDividendKrw / investmentKrw : undefined,
    annualPayoutCapRate: PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE
  };
}
