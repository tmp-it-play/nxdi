import { calculateDividendAllocation } from "../../domain/dividend-allocation.js";
import { recipientPayout, validateDividendMonth, validateWholeKrw } from "../../domain/notifications/index.js";
import type { Disclosure, PortfolioOverview } from "../../domain/types.js";

export type MonthlyTestInput = {
  dividendMonth: string;
  totalMarketValueKrw: number;
  investmentKrw: number;
  actualDividendKrw: number;
};

export function calculateTestMonthlyPayout(input: MonthlyTestInput) {
  validateDividendMonth(input.dividendMonth);
  validateWholeKrw(input.totalMarketValueKrw, "포트폴리오 총액", true);
  validateWholeKrw(input.investmentKrw, "테스트 투자금액");
  validateWholeKrw(input.actualDividendKrw, "월 실배당금");
  const allocation = calculateDividendAllocation({
    totalMarketValueKrw: input.totalMarketValueKrw,
    actualDividendKrw: input.actualDividendKrw,
    selectedInvestmentKrw: input.investmentKrw,
    investorPrincipalKrw: input.investmentKrw
  });
  return {
    ...input,
    ...recipientPayout({ userId: "TEST", userName: "테스트 투자자", investmentKrw: input.investmentKrw }, allocation),
    allocation
  };
}

export function sampleDisclosure(now: Date): Disclosure {
  const timestamp = now.toISOString();
  return {
    id: "sample-disclosure",
    title: "NXDI 운영종목 매수 안내 (샘플)",
    body: "## 운영종목 매수 안내\n\n이 공시는 이메일 표시를 확인하기 위한 샘플입니다.\n\n**매수 내역**과 수량은 가상 데이터이며 실제 거래가 아닙니다.",
    createdAt: timestamp,
    updatedAt: timestamp,
    trades: [{
      id: "sample-trade", disclosureId: "sample-disclosure", side: "BUY", symbol: "SAMPLE", name: "샘플 배당 종목",
      marketCountry: "NASDAQ", currency: "USD", quantity: 10, orderPrice: 50, exchangeRate: 1_300,
      profitRate: 0, feeKrw: 0, taxKrw: 0, orderedAt: timestamp, createdAt: timestamp, updatedAt: timestamp
    }]
  };
}

export function samplePortfolio(now: Date): PortfolioOverview {
  const timestamp = now.toISOString();
  return {
    source: "manual", fetchedAt: timestamp, exchangeRate: 1_300, exchangeRateFetchedAt: timestamp,
    exchangeRateSource: "테스트 샘플", totalMarketValueKrw: 1_000_000, dailySnapshots: [],
    holdings: [
      { symbol: "SAMPLE", name: "샘플 배당 종목", marketCountry: "NASDAQ", currency: "USD", quantity: 10, lastPrice: 50, marketValue: 500, marketValueKrw: 650_000 },
      { symbol: "000000", name: "샘플 국내 종목", marketCountry: "KOSPI", currency: "KRW", quantity: 10, lastPrice: 35_000, marketValue: 350_000, marketValueKrw: 350_000 }
    ]
  };
}
