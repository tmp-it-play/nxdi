"use client";

import { ApiMutationForm } from "@/app/components/api-mutation-form";
import { FormattedNumberInput } from "@/app/components/formatted-number-input";
import { cashLabel } from "@/lib/portfolio-assets";
import type { PortfolioCashAsset } from "@/lib/types";

export function AdminCashForm({ cash }: { cash: PortfolioCashAsset }) {
  const id = `cash-balance-${cash.currency}`;
  return (
    <ApiMutationForm action="/api/admin/portfolio/cash" method="post" className="field cash-balance-form">
      <input name="currency" type="hidden" value={cash.currency} />
      <input name="expectedVersion" type="hidden" value={cash.version} />
      <label htmlFor={id}>{cashLabel(cash.currency)}</label>
      <div className="cash-balance-input">
        <FormattedNumberInput
          key={`${cash.currency}:${cash.version}`}
          id={id}
          name="balance"
          allowDecimal={cash.currency === "USD"}
          defaultValue={cash.balance}
          min={0}
          max={1_000_000_000_000}
          placeholder={cash.currency === "KRW" ? "예: 50,000" : "예: 100.00"}
          required
        />
        <span>{cash.currency === "KRW" ? "원" : "USD"}</span>
        <button type="submit">저장</button>
      </div>
    </ApiMutationForm>
  );
}
