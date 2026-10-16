"use client";

import { useMemo, useState } from "react";
import { Field, MutedText, TdsSelect } from "@/app/components/tds";
import { calculateDividendAllocation } from "@/lib/dividend-allocation";
import { formatDateTime, formatKrw, formatNumber } from "@/lib/format";
import type { PayoutMode } from "@/lib/types";

type DividendAllocationIntent = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  amountKrw: number;
  createdAt: string;
  updatedAt: string;
  eligibleFromMonth: string;
  source: "INVESTMENT_INTENT" | "TOTAL_RETURN_ACCRUAL";
  payoutMode: PayoutMode;
};

type MonthlyDividendRecord = {
  dividendMonth: string;
  recordId: string;
  actualDividendKrw: number;
};

type DividendAllocationCalculatorProps = {
  companyDividendTransferRate: number;
  managementFeeRate: number;
  principalsByMonth: Record<string, DividendAllocationIntent[]>;
  monthlyDividendRecords: MonthlyDividendRecord[];
  defaultDividendMonth: string;
  monthlyInvestorDividendCapRate: number;
  totalMarketValueKrw: number;
};

const PAYOUT_MODE_LABELS: Record<PayoutMode, string> = {
  TOTAL_RETURN: "토탈 리턴",
  MONTHLY_CASH: "월 현금 지급"
};

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "-";
  return `${formatNumber(value * 100, 4)}%`;
}

export function DividendAllocationCalculator({
  companyDividendTransferRate,
  managementFeeRate,
  principalsByMonth,
  monthlyDividendRecords,
  defaultDividendMonth,
  monthlyInvestorDividendCapRate,
  totalMarketValueKrw
}: DividendAllocationCalculatorProps) {
  const [dividendMonth, setDividendMonth] = useState(defaultDividendMonth);
  const [selectedIntentId, setSelectedIntentId] = useState(
    () => principalsByMonth[defaultDividendMonth]?.[0]?.id ?? ""
  );
  const monthlyDividendRecord = monthlyDividendRecords.find(
    (record) => record.dividendMonth === dividendMonth
  );
  const actualDividendKrw = monthlyDividendRecord?.actualDividendKrw ?? 0;

  const eligibleIntents = useMemo(
    () => principalsByMonth[dividendMonth] ?? [],
    [dividendMonth, principalsByMonth]
  );
  const investorPrincipalKrw = eligibleIntents.reduce((sum, intent) => sum + intent.amountKrw, 0);

  const selectedIntent = useMemo(
    () => eligibleIntents.find((intent) => intent.id === selectedIntentId) ?? eligibleIntents[0],
    [eligibleIntents, selectedIntentId]
  );
  const allocation = calculateDividendAllocation({
    actualDividendKrw,
    selectedInvestmentKrw: selectedIntent?.amountKrw ?? 0,
    investorPrincipalKrw,
    totalMarketValueKrw,
    companyDividendTransferRate,
    managementFeeRate,
    monthlyInvestorDividendCapRate
  });
  const isTotalReturn = selectedIntent?.payoutMode === "TOTAL_RETURN";
  const canCalculate =
    investorPrincipalKrw > 0 &&
    Boolean(selectedIntent) &&
    Boolean(monthlyDividendRecord);
  const unavailableMessage = !monthlyDividendRecord
    ? "선택한 지급월의 외부 증권사 월 합계가 등록되지 않았습니다."
    : investorPrincipalKrw <= 0
      ? "선택한 지급월에 계산할 완료 투자 의향 잔액이 없습니다."
      : "배당 대상 투자 의향서가 없습니다.";

  return (
    <div className="dividend-allocation-calculator">
      <div className="dividend-allocation-controls">
        <Field htmlFor="dividend-allocation-month" label="배당 지급월">
          <input
            id="dividend-allocation-month"
            onChange={(event) => setDividendMonth(event.currentTarget.value)}
            type="month"
            value={dividendMonth}
          />
          <p className="field-help">완료된 투자 의향과 토탈 리턴 편입액은 다음 달부터 포함하고, 완료된 출금 의향은 투자자별 FIFO로 차감합니다.</p>
        </Field>
        <Field htmlFor="dividend-allocation-intent" label="완료된 투자 의향서">
          <TdsSelect
            id="dividend-allocation-intent"
            value={selectedIntent?.id ?? ""}
            onChange={(event) => setSelectedIntentId(event.target.value)}
            disabled={eligibleIntents.length === 0}
          >
            {eligibleIntents.length === 0 ? <option value="">배당 대상 의향서 없음</option> : null}
            {eligibleIntents.map((intent) => (
              <option key={intent.id} value={intent.id}>
                {intent.userName} · {formatKrw(intent.amountKrw)} ·{" "}
                {intent.source === "TOTAL_RETURN_ACCRUAL"
                  ? `TR 누적 편입 (${intent.eligibleFromMonth}부터)`
                  : formatDateTime(intent.createdAt)}{" "}
                · {PAYOUT_MODE_LABELS[intent.payoutMode]}
              </option>
            ))}
          </TdsSelect>
        </Field>
        <Field htmlFor="actual-dividend-krw" label="월 전체 실 배당금">
          <input
            id="actual-dividend-krw"
            readOnly
            value={monthlyDividendRecord ? formatKrw(actualDividendKrw) : "등록된 월 합계 없음"}
          />
        </Field>
      </div>

      <div className="dividend-allocation-summary" aria-label="배당 배분 요약">
        <div>
          <span>의향 기반 가정원금 합계</span>
          <strong>{formatKrw(allocation.investorPrincipalKrw)}</strong>
        </div>
        <div>
          <span>회사 기준금액</span>
          <strong>{formatKrw(allocation.companyPrincipalKrw)}</strong>
        </div>
        <div>
          <span>투자자 기본 몫</span>
          <strong>{formatKrw(allocation.investorBaseDividendKrw)}</strong>
        </div>
        <div>
          <span>회사 이전액</span>
          <strong>{formatKrw(allocation.companyTransferredDividendKrw)}</strong>
        </div>
        <div>
          <span>운용보수</span>
          <strong>{formatKrw(allocation.managementFeeKrw)}</strong>
        </div>
        <div>
          <span>투자자 배분 대상</span>
          <strong>{formatKrw(allocation.investorDistributionPoolKrw)}</strong>
        </div>
        <div>
          <span>배당 재투자금</span>
          <strong>{formatKrw(allocation.investorReinvestmentPoolKrw)}</strong>
        </div>
        <div>
          <span>회사 보유 배당</span>
          <strong>{formatKrw(allocation.companyRetainedDividendKrw)}</strong>
        </div>
        <div>
          <span>선택 투자자 비율</span>
          <strong>{formatPercent(allocation.selectedInvestorWeight)}</strong>
        </div>
        {isTotalReturn ? (
          <div>
            <span>원금 편입액 (토탈 리턴)</span>
            <strong>{formatKrw(allocation.allocationKrw + allocation.selectedInvestorReinvestmentKrw)}</strong>
          </div>
        ) : (
          <>
            <div>
              <span>지급액</span>
              <strong>{formatKrw(allocation.allocationKrw)}</strong>
            </div>
            <div>
              <span>선택 의향 재투자액</span>
              <strong>{formatKrw(allocation.selectedInvestorReinvestmentKrw)}</strong>
            </div>
          </>
        )}
      </div>

      {!canCalculate ? (
        <p className="dividend-allocation-empty">{unavailableMessage}</p>
      ) : (
        <div className="dividend-allocation-selected">
          <div>
            <span>선택된 의향서</span>
            <strong>{selectedIntent.userName}</strong>
            <MutedText>{selectedIntent.userEmail}</MutedText>
          </div>
          <div>
            <span>완료 기준일</span>
            <strong>{formatDateTime(selectedIntent.updatedAt)}</strong>
          </div>
          <div>
            <span>수령 방식</span>
            <strong>{PAYOUT_MODE_LABELS[selectedIntent.payoutMode]}</strong>
            {isTotalReturn ? <MutedText>현금 지급 없이 다음 달부터 계산 잔액에 편입됩니다.</MutedText> : null}
          </div>
          <div>
            <span>계산식</span>
            <strong>
              {formatKrw(allocation.investorDistributionPoolKrw)} ×{" "}
              {formatPercent(allocation.selectedInvestorWeight)}
            </strong>
            <MutedText>
              상한 {formatPercent(allocation.monthlyInvestorDividendCapRate)} · 이전율{" "}
              {formatPercent(allocation.companyDividendTransferRate)} · 보수율{" "}
              {formatPercent(allocation.managementFeeRate)}
            </MutedText>
          </div>
          <MutedText>
            참고 계산값입니다. 실제 지급은 증권사와 은행의 확정 기록을 따릅니다.
          </MutedText>
        </div>
      )}
    </div>
  );
}
