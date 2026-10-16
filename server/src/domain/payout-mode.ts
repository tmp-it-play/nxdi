export const PAYOUT_MODES = ["MONTHLY_CASH", "TOTAL_RETURN"] as const;

export type PayoutMode = (typeof PAYOUT_MODES)[number];

/** Investors without a stored preference keep the original monthly cash payout. */
export const DEFAULT_PAYOUT_MODE: PayoutMode = "MONTHLY_CASH";

export function parsePayoutMode(value: unknown): PayoutMode | undefined {
  return PAYOUT_MODES.find((mode) => mode === value);
}
