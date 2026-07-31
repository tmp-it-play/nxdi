import { createHash } from "node:crypto";
import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CertificatePrintActions } from "@/app/admin/CertificatePrintActions";
import { getAdminDashboard } from "@/lib/api";
import { FUND_KOREAN_NAME, FUND_NAME, FUND_TICKER } from "@/lib/brand";
import { stockPrimaryLabel, stockSecondaryLabel } from "@/lib/stock-display";
import type { Holding } from "@/lib/types";

export const metadata: Metadata = {
  title: "운영종목 보유확인서 | NXDI",
  description: "NXDI 현재 운영 포트폴리오의 종목별 보유 내역 증명서"
};

const KST_TIME_ZONE = "Asia/Seoul";
const REGULAR_PAGE_CAPACITY = 14;
const FINAL_PAGE_CAPACITY = 8;

function certificateDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatCertificateDate(value: Date) {
  const parts = certificateDateParts(value);
  return `${parts.year}/${parts.month}/${parts.day}`;
}

function formatCertificateDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = certificateDateParts(date);
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatNumber(value: number, maximumFractionDigits = 4) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(value);
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatNativePrice(holding: Holding) {
  const amount = formatNumber(holding.lastPrice, holding.currency === "KRW" ? 0 : 4);
  return holding.currency === "KRW" ? `${amount}원` : `$${amount}`;
}

function portfolioFingerprint(issuedAt: Date, fetchedAt: string, exchangeRate: number, holdings: Holding[]) {
  return createHash("sha256")
    .update(JSON.stringify({ issuedAt: issuedAt.toISOString(), fetchedAt, exchangeRate, holdings }))
    .digest("hex")
    .toUpperCase();
}

function paginateHoldings<T>(items: T[]) {
  if (items.length === 0) return [[]] as T[][];
  if (items.length <= FINAL_PAGE_CAPACITY) return [items];

  const regularItemCount = items.length - FINAL_PAGE_CAPACITY;
  const regularPageCount = Math.ceil(regularItemCount / REGULAR_PAGE_CAPACITY);
  const basePageSize = Math.floor(regularItemCount / regularPageCount);
  const pagesWithExtraItem = regularItemCount % regularPageCount;
  const pages: T[][] = [];
  let offset = 0;

  for (let index = 0; index < regularPageCount; index += 1) {
    const pageSize = basePageSize + (index < pagesWithExtraItem ? 1 : 0);
    pages.push(items.slice(offset, offset + pageSize));
    offset += pageSize;
  }
  pages.push(items.slice(offset));
  return pages;
}

export default async function PortfolioCertificatePage() {
  const dashboard = await getAdminDashboard();
  if (!dashboard) redirect("/admin");

  const issuedAt = new Date();
  const holdings = [...dashboard.portfolio.holdings]
    .filter((holding) => holding.quantity > 0 && holding.marketValueKrw > 0)
    .sort((a, b) => b.marketValueKrw - a.marketValueKrw || a.symbol.localeCompare(b.symbol));
  const totalMarketValueKrw = holdings.reduce((sum, holding) => sum + holding.marketValueKrw, 0);
  const fingerprint = portfolioFingerprint(
    issuedAt,
    dashboard.portfolio.fetchedAt,
    dashboard.portfolio.exchangeRate,
    holdings
  );
  const issuedAtParts = certificateDateParts(issuedAt);
  const documentNumber = `NXDI-PORT-${issuedAtParts.year}${issuedAtParts.month}${issuedAtParts.day}-${fingerprint.slice(0, 8)}`;
  const printFileNamePrefix = `NXDI_운영종목_보유확인서_${issuedAtParts.year}${issuedAtParts.month}${issuedAtParts.day}`;
  const holdingPages = paginateHoldings(holdings);

  return (
    <main className="certificate-page portfolio-certificate-page">
      <CertificatePrintActions
        backHref="/admin#admin-portfolio"
        printFileNamePrefix={printFileNamePrefix}
      />

      <div className="portfolio-certificate-pages">
        {holdingPages.map((pageHoldings, pageIndex) => {
          const isLastPage = pageIndex === holdingPages.length - 1;
          const startIndex = holdingPages
            .slice(0, pageIndex)
            .reduce((sum, page) => sum + page.length, 0);

          return (
            <article
              aria-labelledby={pageIndex === 0 ? "portfolio-certificate-title" : undefined}
              className="certificate-sheet portfolio-certificate-sheet"
              key={`${documentNumber}-${pageIndex}`}
            >
              <header className="certificate-form-header">
                <p className="certificate-form-reference">NXDI 운용원장 전자증명서</p>
                <div className="certificate-identity">
                  <span className="certificate-monogram">{FUND_TICKER}</span>
                  <span>
                    <strong>{FUND_KOREAN_NAME}</strong>
                    <small>{FUND_NAME}</small>
                  </span>
                </div>
                <h1 id={pageIndex === 0 ? "portfolio-certificate-title" : undefined}>
                  운영종목 보유확인서
                </h1>
              </header>

              <dl className="certificate-issue-meta">
                <div>
                  <dt>발급번호</dt>
                  <dd>{documentNumber}</dd>
                </div>
                <div>
                  <dt>발급일자</dt>
                  <dd>{formatCertificateDate(issuedAt)}</dd>
                </div>
                <div>
                  <dt>발급구분</dt>
                  <dd>전자문서</dd>
                </div>
              </dl>

              <section className="certificate-section" aria-labelledby={`portfolio-subject-heading-${pageIndex}`}>
                <h2 id={`portfolio-subject-heading-${pageIndex}`}>증명 대상</h2>
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
                    <dt>보유 종목 수</dt>
                    <dd>{holdings.length}개 종목</dd>
                  </div>
                </dl>
              </section>

              <section className="certificate-section portfolio-holdings-section" aria-labelledby={`portfolio-holdings-heading-${pageIndex}`}>
                <div className="certificate-section-heading">
                  <h2 id={`portfolio-holdings-heading-${pageIndex}`}>운영종목 보유 내역</h2>
                  <span>(평가액 단위: 원)</span>
                </div>
                <table className="portfolio-certificate-table">
                  <thead>
                    <tr>
                      <th>No.</th>
                      <th>종목명</th>
                      <th>종목코드</th>
                      <th>시장</th>
                      <th>보유수량</th>
                      <th>기준가격</th>
                      <th>평가액</th>
                      <th>비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageHoldings.map((holding, index) => {
                      const secondaryLabel = stockSecondaryLabel(holding);
                      const weight = totalMarketValueKrw > 0
                        ? holding.marketValueKrw / totalMarketValueKrw
                        : 0;
                      return (
                        <tr key={holding.symbol}>
                          <td>{startIndex + index + 1}</td>
                          <td>
                            <strong>{stockPrimaryLabel(holding)}</strong>
                            {secondaryLabel && secondaryLabel !== holding.symbol ? <small>{secondaryLabel}</small> : null}
                          </td>
                          <td>{holding.symbol}</td>
                          <td>{holding.marketCountry}</td>
                          <td>{formatNumber(holding.quantity)}</td>
                          <td>{formatNativePrice(holding)}</td>
                          <td>{formatKrw(holding.marketValueKrw)}</td>
                          <td>{formatNumber(weight * 100, 2)}%</td>
                        </tr>
                      );
                    })}
                    {pageHoldings.length === 0 ? (
                      <tr>
                        <td colSpan={8}>현재 보유 수량이 있는 운영 종목이 없습니다.</td>
                      </tr>
                    ) : null}
                  </tbody>
                  {isLastPage && holdings.length > 0 ? (
                    <tfoot>
                      <tr>
                        <th colSpan={6}>합계</th>
                        <td>{formatKrw(totalMarketValueKrw)}</td>
                        <td>100%</td>
                      </tr>
                    </tfoot>
                  ) : null}
                </table>
              </section>

              {isLastPage ? (
                <>
                  <section className="certificate-section" aria-labelledby="portfolio-basis-heading">
                    <h2 id="portfolio-basis-heading">평가 및 기록 정보</h2>
                    <dl className="certificate-record-details portfolio-record-details">
                      <div>
                        <dt>포트폴리오 기준 일시</dt>
                        <dd>{formatCertificateDateTime(dashboard.portfolio.fetchedAt)}</dd>
                      </div>
                      <div>
                        <dt>적용 환율</dt>
                        <dd>USD/KRW {formatNumber(dashboard.portfolio.exchangeRate, 2)}원</dd>
                      </div>
                      <div>
                        <dt>문서 지문</dt>
                        <dd className="certificate-record-id">SHA-256 {fingerprint}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className="certificate-approval portfolio-certificate-approval" aria-label="발급 확인">
                    <p>
                      위 내역은 상기 기준 일시 현재 {FUND_TICKER} 운용 포트폴리오에서 실제 보유 수량이
                      확인되는 운영종목의 원장 기록과 일치함을 증명합니다.
                    </p>
                    <time dateTime={issuedAt.toISOString()}>{formatCertificateDate(issuedAt)}</time>
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

                  <aside className="certificate-notice portfolio-certificate-notice">
                    <h2>안내사항</h2>
                    <ul>
                      <li>본 문서는 포트폴리오 기준 일시의 관리자 운용 원장과 시장 평가정보를 기준으로 작성되었습니다.</li>
                      <li>보유수량이 0인 등록 종목은 제외하며, 평가액은 기준가격과 적용 환율에 따라 변동될 수 있습니다.</li>
                      <li>문서 지문은 발급 시점의 표시 데이터를 식별하기 위한 값입니다.</li>
                    </ul>
                  </aside>
                </>
              ) : null}

              <footer className="certificate-footer portfolio-certificate-footer">
                <span>{FUND_TICKER} 운영종목 보유확인서</span>
                <span>{pageIndex + 1} / {holdingPages.length}</span>
              </footer>
            </article>
          );
        })}
      </div>
    </main>
  );
}
