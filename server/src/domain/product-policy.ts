export const PRODUCT_MIN_INVESTMENT_KRW = 1_000;
export const PRODUCT_MAX_INVESTMENT_KRW = 1_000_000;
export const PRODUCT_EXTERNAL_INVESTMENT_LIMIT_RATE = 0.1;

export const PRODUCT_COMPANY_DIVIDEND_TRANSFER_RATE = 0.2;
export const PRODUCT_MANAGEMENT_FEE_RATE = 0.05;
export const PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE = 0.18;
export const PRODUCT_MONTHLY_INVESTOR_DIVIDEND_CAP_RATE =
  PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE / 12;

export type ProductPolicyDto = Readonly<{
  minInvestmentKrw: number;
  maxInvestmentKrw: number;
  externalInvestmentLimitRate: number;
  companyDividendTransferRate: number;
  managementFeeRate: number;
  annualInvestorDividendCapRate: number;
  monthlyInvestorDividendCapRate: number;
}>;

const PRODUCT_POLICY_DTO: ProductPolicyDto = Object.freeze({
  minInvestmentKrw: PRODUCT_MIN_INVESTMENT_KRW,
  maxInvestmentKrw: PRODUCT_MAX_INVESTMENT_KRW,
  externalInvestmentLimitRate: PRODUCT_EXTERNAL_INVESTMENT_LIMIT_RATE,
  companyDividendTransferRate: PRODUCT_COMPANY_DIVIDEND_TRANSFER_RATE,
  managementFeeRate: PRODUCT_MANAGEMENT_FEE_RATE,
  annualInvestorDividendCapRate: PRODUCT_ANNUAL_INVESTOR_DIVIDEND_CAP_RATE,
  monthlyInvestorDividendCapRate: PRODUCT_MONTHLY_INVESTOR_DIVIDEND_CAP_RATE
});

export function productPolicyDto(): ProductPolicyDto {
  return PRODUCT_POLICY_DTO;
}
