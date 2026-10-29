export type DividendAllocationInput = {
  actualDividendKrw: number;
  selectedInvestmentKrw: number;
  investorPrincipalKrw: number;
  totalMarketValueKrw: number;
  companyDividendTransferRate: number;
  annualManagementFeeRate: number;
  monthlyInvestorDividendCapRate: number;
};

function positiveAmount(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function cappedRate(value: number) {
  const rate = Number.isFinite(value) ? Number(value) : 0;
  return Math.min(Math.max(rate, 0), 1);
}

export function calculateDividendAllocation(input: DividendAllocationInput) {
  const actualDividendKrw = positiveAmount(input.actualDividendKrw);
  const selectedInvestmentKrw = positiveAmount(input.selectedInvestmentKrw);
  const investorPrincipalKrw = positiveAmount(input.investorPrincipalKrw);
  const totalMarketValueKrw = positiveAmount(input.totalMarketValueKrw);
  const companyDividendTransferRate = cappedRate(
    input.companyDividendTransferRate
  );
  const monthlyInvestorDividendCapRate = cappedRate(
    input.monthlyInvestorDividendCapRate
  );
  const annualManagementFeeRate = cappedRate(input.annualManagementFeeRate);

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
  const managementFeeKrw = Math.min(
    investorGrossEntitlementKrw,
    investorPrincipalKrw * annualManagementFeeRate / 12
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
    annualManagementFeeRate,
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
