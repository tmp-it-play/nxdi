export type DataGsmStudent = {
  id: number;
  name: string;
  sex?: string;
  grade?: number;
  classNum?: number;
  number?: number;
  studentNumber?: number;
  major?: string;
  specialty?: string | null;
  role?: string;
  isLeaveSchool?: boolean;
};

export type DataGsmUser = {
  id: number;
  email: string;
  role: string;
  isStudent: boolean;
  student: DataGsmStudent | null;
};

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  studentNumber?: number;
  userType: "student" | "alumni";
};

export type IntentStatus = "PENDING" | "COMPLETED" | "REJECTED" | "WITHDRAWN";

export type InvestmentIntent = {
  id: string;
  type: "INVESTMENT";
  userId: string;
  userName: string;
  userEmail: string;
  amountKrw: number;
  depositorName: string;
  contact: string;
  guardianConfirmed: boolean;
  dividendPolicyAgreed: boolean;
  productDocumentVersion?: string;
  productDocumentHash?: string;
  dividendPolicyVersion?: string;
  dividendPolicyHash?: string;
  agreedAt?: string;
  status: IntentStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type WithdrawalIntent = {
  id: string;
  type: "WITHDRAWAL";
  userId: string;
  userName: string;
  userEmail: string;
  amountKrw: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  contact: string;
  productDocumentVersion?: string;
  productDocumentHash?: string;
  agreedAt?: string;
  status: IntentStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type AppStore = {
  investmentIntents: InvestmentIntent[];
  withdrawalIntents: WithdrawalIntent[];
};

export type MarketCode = "NASDAQ" | "NYSE" | "AMEX" | "KOSPI" | "KOSDAQ";

export type TradeSide = "BUY" | "SELL";

export type HoldingRiskLevel = "LOW" | "HIGH";

export type Holding = {
  symbol: string;
  name: string;
  alias?: string;
  marketCountry: MarketCode;
  currency: "KRW" | "USD";
  quantity: number;
  lastPrice: number;
  averagePurchasePrice?: number;
  purchaseExchangeRate?: number;
  marketValue: number;
  marketValueKrw: number;
  costBasisKrw?: number;
  priceProfitLossRate?: number;
  fxGainLossKrw?: number;
  profitLossKrw?: number;
  profitLossRate?: number;
  riskLevel?: HoldingRiskLevel;
};

export type PortfolioOverview = {
  source: "manual";
  fetchedAt: string;
  exchangeRate: number;
  exchangeRateFetchedAt: string;
  exchangeRateSource: string;
  totalMarketValueKrw: number;
  dailySnapshots: PortfolioDailySnapshot[];
  holdings: Holding[];
};

export type PortfolioValuation = {
  totalMarketValueKrw: number;
  costBasisKrw?: number;
  annualDividendKrw?: number;
};

export type PortfolioDailySnapshot = PortfolioValuation & {
  date: string;
  exchangeRate: number;
  observations?: (PortfolioValuation & { observedAt: string })[];
  closeTotalMarketValueKrw?: number;
  closeExchangeRate?: number;
  closeCostBasisKrw?: number;
  closeAnnualDividendKrw?: number;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ManualPortfolioStore = {
  exchangeRate: number;
  exchangeRateFetchedAt?: string;
  exchangeRateSource?: string;
  updatedAt: string;
  holdings: Holding[];
};

export type DividendRecord = {
  symbol: string;
  currency: "KRW" | "USD";
  annualDividendPerShare: number;
  trailingYield?: number;
  expectedPaymentMonths: number[];
  lastDividendPerShare?: number;
  memo?: string;
};

export type MonthlyDividendRecord = {
  dividendMonth: string;
  recordId: string;
  actualDividendKrw: number;
  referenceMarketValueKrw?: number;
  createdAt: string;
  updatedAt: string;
};

export type DividendForecastLine = {
  symbol: string;
  name: string;
  alias?: string;
  marketCountry: MarketCode;
  currency: "KRW" | "USD";
  allocationKrw: number;
  estimatedQuantity: number;
  annualDividendKrw?: number;
  lastDividendKrw?: number;
  monthlyAverageKrw?: number;
  dividendDataMissing?: boolean;
  expectedPaymentMonths: number[];
  nextPaymentMonth?: number;
};

export type DividendForecast = {
  amountKrw: number;
  annualDividendKrw?: number;
  monthlyAverageKrw?: number;
  dividendDataMissing?: boolean;
  lines: DividendForecastLine[];
};

export type DisclosureTrade = {
  id: string;
  disclosureId: string;
  side: TradeSide;
  symbol: string;
  name: string;
  alias?: string;
  marketCountry: MarketCode;
  currency: "KRW" | "USD";
  quantity: number;
  orderPrice: number;
  exchangeRate?: number;
  profitRate: number;
  feeKrw: number;
  taxKrw: number;
  orderedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Disclosure = {
  id: string;
  title: string;
  body: string;
  trades: DisclosureTrade[];
  createdAt: string;
  updatedAt: string;
};
