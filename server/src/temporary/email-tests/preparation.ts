import { randomUUID } from "node:crypto";
import { kstDateKey } from "../../domain/notifications/index.js";
import { readDisclosure } from "../../infrastructure/disclosures.js";
import { getManualPortfolioOverview } from "../../infrastructure/portfolio-store.js";
import { checkedPortfolio, type PreparedNotification } from "../../infrastructure/notifications/preparation.js";
import { requireCondition } from "../../infrastructure/notifications/shared.js";
import { renderDisclosureEmail, renderMonthlyPayoutEmail, renderQuarterlyHoldingsEmail } from "../../infrastructure/notifications/templates.js";
import { TEST_RECIPIENT } from "./constants.js";
import { calculateTestMonthlyPayout, sampleDisclosure, samplePortfolio, type MonthlyTestInput } from "./domain.js";
import { markTestEmail } from "./templates.js";

export type TestPreviewInput = ({ type: "MONTHLY_PAYOUT" } & MonthlyTestInput)
  | { type: "DISCLOSURE"; source: "sample" | "current"; disclosureId?: string }
  | { type: "QUARTERLY_HOLDINGS"; source: "sample" | "current" };

export async function prepareTest(input: TestPreviewInput, now: Date): Promise<PreparedNotification> {
  const recipient = { userId: null, userName: "테스트 수신자", email: TEST_RECIPIENT, recipientKey: `test:${TEST_RECIPIENT}` };
  if (input.type === "MONTHLY_PAYOUT") {
    const calculation = calculateTestMonthlyPayout(input);
    const rendered = markTestEmail(renderMonthlyPayoutEmail({ dividendMonth: input.dividendMonth, recipient: calculation, calculatedAt: now.toISOString() }), input);
    return {
      recipients: [{ ...recipient, userName: "테스트 투자자", rendered, facts: calculation }],
      facts: { input, calculatedAt: now.toISOString() },
      calculation: {
        investmentKrw: input.investmentKrw, totalMarketValueKrw: input.totalMarketValueKrw, actualDividendKrw: input.actualDividendKrw,
        cashPayoutKrw: calculation.displayedKrw, feeKrw: calculation.managementFeeKrw, reinvestmentKrw: calculation.reinvestmentKrw
      }
    };
  }
  if (input.type === "DISCLOSURE") {
    const disclosure = input.source === "sample" ? sampleDisclosure(now) : input.disclosureId ? await readDisclosure(input.disclosureId) : null;
    requireCondition(disclosure, "DISCLOSURE_REQUIRED", "테스트할 공시를 선택해 주세요.", 400);
    const disclosureUrl = input.source === "current" ? new URL(`/disclosures/${encodeURIComponent(disclosure.id)}`, process.env.PUBLIC_APP_URL ?? "http://localhost:3000").toString() : undefined;
    const rendered = markTestEmail(renderDisclosureEmail({ disclosure, disclosureUrl }));
    return { recipients: [{ ...recipient, rendered }], facts: { disclosure, source: input.source } };
  }
  const portfolio = checkedPortfolio(input.source === "sample" ? samplePortfolio(now) : await getManualPortfolioOverview());
  const date = kstDateKey(now);
  const period = `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
  const rendered = markTestEmail(renderQuarterlyHoldingsEmail({ period, portfolio, issuedAt: now.toISOString(), certificateNumber: `TEST-${randomUUID().slice(0, 8)}` }));
  return { recipients: [{ ...recipient, rendered }], facts: { portfolio, source: input.source } };
}
