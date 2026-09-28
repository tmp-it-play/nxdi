import "server-only";

import { cookies } from "next/headers";
import type { RoadmapEvent } from "./roadmap";
import type { NotificationsResponse } from "./notification-types";
import type {
  AppStore,
  AppUser,
  Disclosure,
  DividendForecast,
  DividendRecord,
  MarketCandle,
  MonthlyDividendRecord,
  PortfolioDividendSummary,
  PortfolioOverview,
  WithdrawalIntentReference
} from "./types";

const DEFAULT_API_ORIGIN = "https://kimtaeeun.site/nxdi-api";

// The packages intentionally do not share runtime code. Keep these DTOs aligned with
// server/src/routes/read.ts and server/src/application/read-models.ts.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiOrigin() {
  return (process.env.API_ORIGIN ?? process.env.NXDI_API_ORIGIN ?? DEFAULT_API_ORIGIN).replace(/\/$/, "");
}

async function apiFetch<T>(path: string): Promise<T> {
  const session = (await cookies()).get("nxdi_session");
  const response = await fetch(`${apiOrigin()}${path}`, {
    headers: session ? { cookie: `nxdi_session=${session.value}` } : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    let message = `NXDI API request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      // The status code is enough when an upstream proxy returns a non-JSON body.
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export type SessionResponse = {
  user: AppUser | null;
  isAdmin: boolean;
};

export type HomeResponse = SessionResponse & {
  portfolio: Omit<PortfolioOverview, "dailySnapshots">;
  scheduledDividend: DividendForecast;
  portfolioDividend: PortfolioDividendSummary;
  disclosures: Disclosure[];
  portfolioDailyChangeRate?: number;
  portfolioDailyPoints: ChartPoint[];
  holdingReturnPoints: ChartPoint[];
  dividendYieldPoints: ChartPoint[];
  holdingCharts: Record<string, HoldingChart>;
};

export type ChartPoint = {
  date: string;
  value: number;
};

export type HoldingChart = {
  dailyChangeRate?: number;
  points: ChartPoint[];
};

export type DisclosuresResponse = {
  user: AppUser | null;
  items: Disclosure[];
  total: number;
  page: number;
  pageSize: number;
  roadmapEvents: RoadmapEvent[];
  roadmapToday: string;
  roadmapStart: string;
  roadmapHorizon: string;
};

export type DisclosureResponse = {
  user: AppUser | null;
  disclosure: Disclosure;
};

export type StockResponse = {
  user: AppUser | null;
  holding: PortfolioOverview["holdings"][number];
  dividendRecord: DividendRecord | null;
  dailyChangeRate?: number;
  annualDividendKrw?: number;
  holdingDividendYield?: number;
  returnCandles: MarketCandle[];
  yieldCandles: MarketCandle[];
  weeklyCandles: MarketCandle[];
};

export type MetricResponse = {
  user: AppUser | null;
  metric: string;
  totalMarketValueKrw: number;
  portfolioDividend: PortfolioDividendSummary;
  candles: MarketCandle[];
  currentRate?: number;
};

export type ExpectedPayout = {
  annualExpectedDividendKrw?: number;
  monthlyExpectedDividendKrw?: number;
  expectedAnnualPayoutRate?: number;
};

export type ProductPolicyDto = {
  minInvestmentKrw: number;
  maxInvestmentKrw: number;
  externalInvestmentLimitRate: number;
  companyDividendTransferRate: number;
  managementFeeRate: number;
  annualInvestorDividendCapRate: number;
  monthlyInvestorDividendCapRate: number;
};

export type InvestmentIntentAvailabilityDto = {
  completedInvestmentIntentKrw: number;
  portfolioMarketValueKrw: number;
  maxCompletedInvestmentIntentKrw: number;
  isPaused: boolean;
};

export type DividendAllocationIntentDto = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  amountKrw: number;
  createdAt: string;
  updatedAt: string;
  eligibleFromMonth: string;
};

export type SimulationResponse = {
  user: AppUser | null;
  amount: number;
  forecast: DividendForecast;
  annualPortfolioDividendYield?: number;
  expectedPayout?: ExpectedPayout;
  policy: ProductPolicyDto;
};

export type IntentsResponse = {
  user: AppUser;
  store: AppStore;
  withdrawalReference: WithdrawalIntentReference;
  investmentAvailability: InvestmentIntentAvailabilityDto;
  policy: ProductPolicyDto;
};

export type AdminDashboardResponse = {
  user: AppUser;
  store: AppStore;
  portfolio: PortfolioOverview;
  dividendRecords: DividendRecord[];
  monthlyDividendRecords: MonthlyDividendRecord[];
  disclosures: Disclosure[];
  roadmapEvents: RoadmapEvent[];
  roadmapToday: string;
  roadmapHorizon: string;
  dividendPrincipalsByMonth: Record<string, DividendAllocationIntentDto[]>;
  policy: ProductPolicyDto;
};

export function getSession() {
  return apiFetch<SessionResponse>("/api/auth/session");
}

export function getHome() {
  return apiFetch<HomeResponse>("/api/public/home");
}

export function getDisclosures() {
  return apiFetch<DisclosuresResponse>("/api/disclosures");
}

export async function getDisclosure(id: string) {
  try {
    return await apiFetch<DisclosureResponse>(`/api/disclosures/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getStock(symbol: string) {
  try {
    return await apiFetch<StockResponse>(`/api/stocks/${encodeURIComponent(symbol)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function getMetric(metric: string) {
  try {
    return await apiFetch<MetricResponse>(`/api/metrics/${encodeURIComponent(metric)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function getSimulation(amountKrw: number) {
  return apiFetch<SimulationResponse>(`/api/simulation?amountKrw=${encodeURIComponent(amountKrw)}`);
}

export async function getMyIntents() {
  try {
    return await apiFetch<IntentsResponse>("/api/intents/me");
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export async function getAdminDashboard() {
  try {
    return await apiFetch<AdminDashboardResponse>("/api/admin/dashboard");
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export async function getAdminNotifications() {
  try {
    return await apiFetch<NotificationsResponse>("/api/admin/notifications?mode=PRODUCTION");
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}
