import type { Metadata } from "next";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { CertificatePrintActions } from "@/app/admin/CertificatePrintActions";
import { getAdminDashboard } from "@/lib/api";
import { FUND_KOREAN_NAME, FUND_NAME, FUND_TICKER } from "@/lib/brand";

export const metadata: Metadata = {
  title: "운용수익 발생확인서 | NXDI",
  description: "NXDI 귀속 기간별 확정 운용수익 증명서"
};

type CertificatePageProps = {
  params: Promise<{ recordId: string }>;
};

const KST_TIME_ZONE = "Asia/Seoul";

function formatDividendPeriod(value: string) {
  const [year, month] = value.split("-");
  return `${year}년 ${Number(month)}월`;
}

function formatCertificateAmount(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatCertificateDate(value: Date) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}/${values.month}/${values.day}`;
}

function formatCertificateDateTime(value: string) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}/${values.month}/${values.day} ${values.hour}:${values.minute}`;
}

function certificateNumber(dividendMonth: string, recordId: string) {
  return `NXDI-DIV-${dividendMonth.replace("-", "")}-${recordId.slice(0, 8).toUpperCase()}`;
}

export default async function MonthlyDividendCertificatePage({ params }: CertificatePageProps) {
  const { recordId: recordIdParam } = await params;
  const recordId = decodeURIComponent(recordIdParam);
  const dashboard = await getAdminDashboard();
  if (!dashboard) redirect("/admin");

  const record = dashboard.monthlyDividendRecords.find((item) => item.recordId === recordId);
  if (!record) notFound();

  const issuedOn = formatCertificateDate(new Date());
  const documentNumber = certificateNumber(record.dividendMonth, record.recordId);
  const printFileNamePrefix =
    `NXDI_운용수익_발생확인서_${record.dividendMonth.replace("-", "")}`;

  return (
    <main className="certificate-page">
      <CertificatePrintActions
        backHref="/admin#admin-monthly-dividends"
        printFileNamePrefix={printFileNamePrefix}
      />

      <article aria-labelledby="certificate-title" className="certificate-sheet">
        <header className="certificate-form-header">
          <p className="certificate-form-reference">NXDI 운용원장 전자증명서</p>
          <div className="certificate-identity">
            <span className="certificate-monogram">{FUND_TICKER}</span>
            <span>
              <strong>{FUND_KOREAN_NAME}</strong>
              <small>{FUND_NAME}</small>
            </span>
          </div>
          <h1 id="certificate-title">운용수익 발생확인서</h1>
        </header>

        <dl className="certificate-issue-meta">
          <div>
            <dt>발급번호</dt>
            <dd>{documentNumber}</dd>
          </div>
          <div>
            <dt>발급일자</dt>
            <dd>{issuedOn}</dd>
          </div>
          <div>
            <dt>발급구분</dt>
            <dd>전자문서</dd>
          </div>
        </dl>

        <section className="certificate-section" aria-labelledby="certificate-subject-heading">
          <h2 id="certificate-subject-heading">증명 대상</h2>
          <dl className="certificate-subject-grid">
            <div>
              <dt>상품명</dt>
              <dd>{FUND_KOREAN_NAME}</dd>
            </div>
            <div>
              <dt>운용 식별자</dt>
              <dd>{FUND_TICKER}</dd>
            </div>
            <div>
              <dt>운용사</dt>
              <dd>NexTach</dd>
            </div>
            <div>
              <dt>기록 식별번호</dt>
              <dd className="certificate-record-id">{record.recordId}</dd>
            </div>
          </dl>
        </section>

        <section className="certificate-section" aria-labelledby="certificate-income-heading">
          <div className="certificate-section-heading">
            <h2 id="certificate-income-heading">수익 발생 내역</h2>
            <span>(단위: 원)</span>
          </div>
          <table className="certificate-income-table">
            <thead>
              <tr>
                <th>귀속 기간</th>
                <th>수익 구분</th>
                <th>확정 수익금액</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatDividendPeriod(record.dividendMonth)}</td>
                <td>배당수익</td>
                <td className="certificate-income-amount">{formatCertificateAmount(record.actualDividendKrw)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="certificate-section" aria-labelledby="certificate-basis-heading">
          <h2 id="certificate-basis-heading">산정 및 기록 정보</h2>
          <dl className="certificate-record-details">
            <div>
              <dt>수익 산정 기준</dt>
              <dd>
                해당 귀속 기간 중 운용 기초자산에서 발생하여 증권사 기록으로 확정된 배당금의 원화 환산 합계
              </dd>
            </div>
            <div>
              <dt>원장 최종 갱신 일시</dt>
              <dd>{formatCertificateDateTime(record.updatedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="certificate-approval" aria-label="발급 확인">
          <p>
            위 금액은 상기 귀속 기간 중 {FUND_TICKER} 운용 기초자산에서 발생하여 확정된
            배당수익의 원화 환산 합계임을 증명합니다.
          </p>
          <time dateTime={issuedOn.replaceAll("/", "-")}>{issuedOn}</time>
          <div className="certificate-issuer">
            <span>발급자</span>
            <span className="certificate-issuer-signature">
              <Image
                alt="김태은 서명"
                className="certificate-signature-image"
                height={270}
                priority
                src="/certificate/kim-taeeun-signature-print.png"
                unoptimized
                width={666}
              />
              <Image
                alt="김태은인 직인"
                className="certificate-seal-image"
                height={1308}
                priority
                src="/certificate/kim-taeeun-official-seal-print.png"
                unoptimized
                width={1262}
              />
            </span>
          </div>
        </section>

        <aside className="certificate-notice">
          <h2>안내사항</h2>
          <ul>
            <li>본 문서는 NXDI 내부 운용 원장에 기록된 귀속 기간별 운용수익 발생 사실을 증명합니다.</li>
            <li>개인별 배당 지급액, 원천징수 내역 또는 세법상 소득금액을 증명하는 서류가 아닙니다.</li>
            <li>문서의 진위와 내용은 발급번호 및 기록 식별번호를 관리자 원장과 대조하여 확인할 수 있습니다.</li>
          </ul>
        </aside>

        <footer className="certificate-footer">
          <span>{FUND_TICKER} 운용수익 발생확인서</span>
          <span>1 / 1</span>
        </footer>
      </article>
    </main>
  );
}
