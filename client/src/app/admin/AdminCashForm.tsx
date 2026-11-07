"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiMutationForm } from "@/app/components/api-mutation-form";
import { FormattedNumberInput } from "@/app/components/formatted-number-input";
import { RiskBadge } from "@/app/components/risk-badge";
import { Field } from "@/app/components/tds";
import { currencySymbol, formatCurrency } from "@/lib/format";
import { cashLabel } from "@/lib/portfolio-assets";
import type { PortfolioCashAsset } from "@/lib/types";

export function AdminCashForm({ cash }: { cash: PortfolioCashAsset }) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = `cash-balance-${cash.currency}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>('input:not([type="hidden"])')?.focus();
    }
  }, [isOpen]);

  function closeModal() {
    dialogRef.current?.close();
    setIsOpen(false);
  }

  return (
    <>
      <div className="holding-summary cash-summary">
        <div>
          <strong>{cashLabel(cash.currency)}</strong>
          <RiskBadge level="LOW" />
          <em>현재 잔액 {formatCurrency(cash.balance, cash.currency)}</em>
        </div>
        <button className="secondary" type="button" onClick={() => setIsOpen(true)}>
          수정
        </button>
      </div>
      {isOpen ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={`${id}-title`}
          className="holding-modal cash-balance-modal"
          onCancel={closeModal}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeModal();
          }}
        >
          <header className="holding-modal-header">
            <h3 id={`${id}-title`}>{cashLabel(cash.currency)} 수정</h3>
            <button aria-label="닫기" className="ghost holding-modal-close" type="button" onClick={closeModal}>
              <X size={18} />
            </button>
          </header>
          <ApiMutationForm
            action="/api/admin/portfolio/cash"
            method="post"
            className="form compact holding-modal-form"
            onSuccess={closeModal}
          >
            <input name="currency" type="hidden" value={cash.currency} />
            <input name="expectedVersion" type="hidden" value={cash.version} />
            <Field htmlFor={id} label={`현재 잔액 (${currencySymbol(cash.currency)})`}>
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
            </Field>
            <footer className="holding-modal-buttons">
              <button className="secondary" type="button" onClick={closeModal}>취소</button>
              <button type="submit">저장</button>
            </footer>
          </ApiMutationForm>
        </dialog>
      ) : null}
    </>
  );
}
