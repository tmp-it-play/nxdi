import type { DividendForecastLine } from "./types";

export function forecastLinePaymentAmount(line: DividendForecastLine) {
  if (typeof line.annualDividendKrw !== "number") return undefined;
  if (line.expectedPaymentMonths.length === 0) return line.annualDividendKrw;
  return line.annualDividendKrw / line.expectedPaymentMonths.length;
}
