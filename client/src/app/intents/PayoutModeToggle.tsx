"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PayoutMode } from "@/lib/types";

const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  TOTAL_RETURN: "토탈 리턴",
  MONTHLY_CASH: "월 현금 지급"
};

const CHANGE_NOTICE: Record<PayoutMode, string> = {
  TOTAL_RETURN: "이후 배분액은 현금으로 지급되지 않고 다음 달부터 계산 잔액에 편입됩니다.",
  MONTHLY_CASH: "이후 배분액은 매월 현금 지급 상한 범위에서 지급되며, 이미 편입된 토탈 리턴 금액은 잔액에 그대로 남습니다."
};

export function PayoutModeToggle({ currentMode }: { currentMode: PayoutMode | null }) {
  const [selected, setSelected] = useState<PayoutMode>(currentMode ?? "TOTAL_RETURN");
  const [confirming, setConfirming] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const confirmedRef = useRef(false);
  const submitterRef = useRef<HTMLElement | null>(null);
  const selectedRef = useRef(selected);
  const titleId = useId();
  const labelId = useId();
  selectedRef.current = selected;

  // Runs on the form itself, before the form's React submit handler, so a changed mode is confirmed first.
  useEffect(() => {
    const form = containerRef.current?.closest("form");
    if (!form || !currentMode) return;
    const handleSubmit = (event: SubmitEvent) => {
      if (confirmedRef.current) {
        confirmedRef.current = false;
        return;
      }
      if (selectedRef.current === currentMode) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      submitterRef.current = event.submitter;
      setConfirming(true);
    };
    form.addEventListener("submit", handleSubmit);
    return () => form.removeEventListener("submit", handleSubmit);
  }, [currentMode]);

  useEffect(() => {
    if (!confirming) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirming]);

  function confirmChange() {
    const form = containerRef.current?.closest("form");
    setConfirming(false);
    if (!form) return;
    confirmedRef.current = true;
    const submitter = submitterRef.current;
    form.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined);
  }

  return (
    <div className="field" ref={containerRef}>
      <span className="field-label" id={labelId}>배당 수령 방식</span>
      <div className="payout-mode-toggle" role="radiogroup" aria-labelledby={labelId}>
        {(["TOTAL_RETURN", "MONTHLY_CASH"] as PayoutMode[]).map((mode) => (
          <label key={mode}>
            <input
              checked={selected === mode}
              name="payoutMode"
              onChange={() => setSelected(mode)}
              type="radio"
              value={mode}
            />
            <span>{PAYOUT_MODE_LABELS[mode]}</span>
          </label>
        ))}
      </div>
      <p className="field-help">
        {currentMode
          ? `현재 ${PAYOUT_MODE_LABELS[currentMode]} 방식입니다. 변경하면 다음에 계산하는 배당월부터 적용됩니다.`
          : "토탈 리턴은 배분액을 다음 달부터 원금에 편입하고, 월 현금 지급은 매월 현금 지급 상한 범위에서 지급합니다."}
      </p>

      {confirming && currentMode ? (
        <div className="terms-modal-backdrop" onMouseDown={() => setConfirming(false)}>
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className="terms-modal payout-mode-confirm"
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="terms-modal-header">
              <div>
                <h2 id={titleId}>수령 방식을 변경할까요?</h2>
                <p>
                  {PAYOUT_MODE_LABELS[currentMode]}에서 {PAYOUT_MODE_LABELS[selected]}(으)로 변경한 뒤 의향서를 제출합니다.
                </p>
              </div>
            </header>
            <div className="payout-mode-confirm-body">
              <p>{CHANGE_NOTICE[selected]}</p>
              <p>변경은 다음에 계산하는 배당월부터 적용되며, 이미 계산된 배당월에는 적용되지 않습니다.</p>
            </div>
            <div className="payout-mode-confirm-actions">
              <button className="secondary" type="button" onClick={() => setConfirming(false)} autoFocus>
                취소
              </button>
              <button type="button" onClick={confirmChange}>
                변경하고 제출
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
