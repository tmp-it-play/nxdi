import type { EmailPreview, NotificationType } from "@/lib/notification-types";

export const TEST_RECIPIENT = "snowykte0426@naver.com";

export type TestEmailOptions = {
  testRecipient: string;
  defaults: {
    dividendMonth: string;
    totalMarketValueKrw?: number;
    actualDividendKrw?: number;
  };
  disclosures: Array<{ id: string; title: string }>;
  drafts: Array<{ id: string; type: NotificationType; subject: string | null; createdAt: string }>;
};

export type TestEmailInput =
  | { type: "MONTHLY_PAYOUT"; dividendMonth: string; totalMarketValueKrw: number; investmentKrw: number; actualDividendKrw: number }
  | { type: "DISCLOSURE"; source: "sample" | "current"; disclosureId?: string }
  | { type: "QUARTERLY_HOLDINGS"; source: "sample" | "current" };

export type TestEmailPreview = EmailPreview & {
  calculation?: {
    investmentKrw: number;
    totalMarketValueKrw: number;
    actualDividendKrw: number;
    cashPayoutKrw: number;
    feeKrw: number;
    reinvestmentKrw: number;
  };
};
