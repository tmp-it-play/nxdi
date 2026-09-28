import type { Disclosure, PortfolioOverview } from "../../domain/types.js";
import type { MonthlyPayoutRecipient, RenderedEmail } from "../../domain/notifications/index.js";

export const TEMPLATE_VERSION = "2";

type TemplateOptions = { correctionReason?: string };

function escapeHtml(value: string | number) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}

function amount(value: number, maximumFractionDigits = 0) {
  return Number.isFinite(value) ? value.toLocaleString("ko-KR", { maximumFractionDigits }) : "확인 필요";
}

function won(value: number) {
  return `${amount(Math.round(value))}원`;
}

function timestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "기준 일시 확인 필요";
  return `${new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(date)} (한국시간)`;
}

function safeHttpUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Deliberately limited Markdown: raw HTML and Markdown URLs remain escaped text. */
function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`\n]+)`/g, '<code style="background:#f3f4f6;padding:2px 4px">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1<em>$2</em>");
}

function markdownBody(body: string) {
  return body.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((paragraph) => {
    const heading = paragraph.match(/^#{1,6}\s+([^\n]+)$/);
    if (heading?.[1]) return `<h2 style="font-size:18px;margin:24px 0 10px">${inlineMarkdown(heading[1])}</h2>`;
    const lines = paragraph.split("\n");
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return `<ul style="padding-left:22px">${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p style="margin:12px 0;overflow-wrap:anywhere">${lines.map(inlineMarkdown).join("<br>")}</p>`;
  }).join("");
}

function table(rows: Array<[string, string]>) {
  return `<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px">${rows.map(([label, value]) => `<tr><th scope="row" style="text-align:left;padding:10px 8px;border-bottom:1px solid #e5e7eb;font-weight:500;width:40%">${escapeHtml(label)}</th><td style="text-align:right;padding:10px 8px;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function render(subject: string, bodyHtml: string, bodyText: string, options: TemplateOptions): RenderedEmail {
  const cleanSubject = subject.replace(/[\r\n]+/g, " ");
  const markedSubject = `${options.correctionReason ? "[정정] " : ""}${cleanSubject}`;
  const correctionText = options.correctionReason ? `정정 사유: ${options.correctionReason}` : "";
  const notices = [correctionText].filter(Boolean);
  return {
    subject: markedSubject,
    html: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(markedSubject)}</title></head><body style="margin:0;background:#f5f6f8;color:#17202e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.65"><div style="max-width:640px;margin:0 auto;padding:24px 16px"><div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px 16px"><p style="color:#425366;letter-spacing:2px;font-size:12px;margin:0 0 8px">NEXTACH GLOBAL DIVIDEND INCOME FUND</p><h1 style="font-size:24px;line-height:1.4;overflow-wrap:anywhere;margin:0 0 24px">${escapeHtml(cleanSubject)}</h1>${notices.map((notice) => `<p style="background:#fff7df;padding:12px;border-radius:6px">${escapeHtml(notice)}</p>`).join("")}${bodyHtml}<p style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:28px;color:#667085;font-size:12px">NXDI · NexTach Global Dividend Income Fund<br>문의: contact@kimtaeeun.site</p></div></div></body></html>`,
    text: [markedSubject, ...notices, bodyText, "NXDI · NexTach Global Dividend Income Fund", "문의: contact@kimtaeeun.site"].join("\n\n")
  };
}

export type DisclosureEmailInput = TemplateOptions & { disclosure: Disclosure; disclosureUrl?: string };

export function renderDisclosureEmail(input: DisclosureEmailInput): RenderedEmail {
  const { disclosure } = input;
  const url = safeHttpUrl(input.disclosureUrl);
  const tradeRows = disclosure.trades.map((trade) => {
    const rows: Array<[string, string]> = [
      ["거래 구분", trade.side === "SELL" ? "매도" : "매수"],
      ["수량", `${amount(trade.quantity, 8)}주`],
      ["주문 가격", `${amount(trade.orderPrice, trade.currency === "USD" ? 4 : 0)} ${trade.currency}`],
      ...(trade.currency === "USD" && trade.exchangeRate !== undefined ? [["적용 환율", `${amount(trade.exchangeRate, 2)} KRW/USD`] as [string, string]] : []),
      ["수익률", `${amount(trade.profitRate * 100, 2)}%`],
      ["수수료 / 세금", `${won(trade.feeKrw)} / ${won(trade.taxKrw)}`],
      ["주문 일시", timestamp(trade.orderedAt)]
    ];
    const title = `${trade.alias || trade.name} (${trade.symbol})`;
    return {
      html: `<h3 style="font-size:16px;margin:24px 0 8px">${escapeHtml(title)}</h3>${table(rows)}`,
      text: `${title}\n${rows.map(([key, value]) => `${key}: ${value}`).join("\n")}`
    };
  });
  return render(
    disclosure.title,
    `<p style="font-size:13px;color:#667085">등록 일시: ${escapeHtml(timestamp(disclosure.createdAt))}</p>${markdownBody(disclosure.body)}${tradeRows.length ? `<h2 style="font-size:18px;margin-top:28px">거래 내역</h2>${tradeRows.map((trade) => trade.html).join("")}` : ""}${url ? `<p style="margin-top:24px"><a style="color:#155e75" href="${escapeHtml(url)}">사이트에서 공시 보기</a></p>` : ""}`,
    [`등록 일시: ${timestamp(disclosure.createdAt)}`, disclosure.body, ...tradeRows.map((trade) => trade.text), ...(url ? [`공시 링크: ${url}`] : [])].join("\n\n"),
    input
  );
}

export type MonthlyPayoutEmailInput = TemplateOptions & {
  dividendMonth: string;
  recipient: MonthlyPayoutRecipient;
  calculatedAt: string;
};

export function renderMonthlyPayoutEmail(input: MonthlyPayoutEmailInput): RenderedEmail {
  const { recipient } = input;
  const rows: Array<[string, string]> = [
    ["배당 기준월", input.dividendMonth],
    ["배당 적격 투자금액", won(recipient.investmentKrw)],
    ["현금 지급 안내액", won(recipient.displayedKrw)],
    ["관리 보수", won(recipient.managementFeeKrw)],
    ["재투자액", won(recipient.reinvestmentKrw)],
    ["계산 일시", timestamp(input.calculatedAt)]
  ];
  const note = "전월 실배당과 해당 월의 배당 적격 잔액으로 계산한 참고 금액입니다. 이 안내는 지급 승인 또는 송금 완료를 의미하지 않습니다. 원 단위 표시는 개인별 계산액을 반올림한 값입니다.";
  return render(
    `NXDI ${input.dividendMonth} 월별 지급액 안내`,
    `<p>${escapeHtml(recipient.userName)}님, ${escapeHtml(input.dividendMonth)} 기준 지급액을 안내합니다.</p><p style="font-size:32px;font-weight:700;color:#155e75;margin:24px 0">${escapeHtml(won(recipient.displayedKrw))}</p>${table(rows)}<p style="font-size:13px;color:#667085">${note}</p>`,
    [`${recipient.userName}님, ${input.dividendMonth} 기준 지급액을 안내합니다.`, rows.map(([key, value]) => `${key}: ${value}`).join("\n"), note].join("\n\n"),
    input
  );
}

export type QuarterlyHoldingsEmailInput = TemplateOptions & {
  period: string;
  portfolio: PortfolioOverview;
  issuedAt: string;
  certificateNumber: string;
};

export function renderQuarterlyHoldingsEmail(input: QuarterlyHoldingsEmailInput): RenderedEmail {
  const { portfolio } = input;
  const rows: Array<[string, string]> = [
    ["발급번호", input.certificateNumber],
    ["발급 일시", timestamp(input.issuedAt)],
    ["포트폴리오 조회 일시", timestamp(portfolio.fetchedAt)],
    ["총평가액", won(portfolio.totalMarketValueKrw)],
    ["적용 환율", `${amount(portfolio.exchangeRate, 2)} KRW/USD`],
    ["환율 갱신 일시", timestamp(portfolio.exchangeRateFetchedAt)],
    ["환율 출처", portfolio.exchangeRateSource]
  ];
  const holdingsHtml = portfolio.holdings.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed"><caption style="text-align:left;font-size:18px;font-weight:600;margin:24px 0 12px">운영종목 보유 내역</caption><thead><tr>${["종목", "수량", "기준가격", "평가액"].map((label) => `<th scope="col" style="text-align:left;padding:8px 4px;border-bottom:2px solid #cbd5e1">${label}</th>`).join("")}</tr></thead><tbody>${portfolio.holdings.map((holding) => `<tr>${[
    `${holding.alias || holding.name} (${holding.symbol})`, `${amount(holding.quantity, 8)}주`,
    `${amount(holding.lastPrice, holding.currency === "USD" ? 4 : 0)} ${holding.currency}`, won(holding.marketValueKrw)
  ].map((value) => `<td style="padding:10px 4px;border-bottom:1px solid #e5e7eb;vertical-align:top;overflow-wrap:anywhere">${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "<p>현재 등록된 운영종목이 없습니다.</p>";
  const holdingsText = portfolio.holdings.map((holding) => `${holding.alias || holding.name} (${holding.symbol}) | ${amount(holding.quantity, 8)}주 | 기준가격 ${amount(holding.lastPrice, holding.currency === "USD" ? 4 : 0)} ${holding.currency} | 평가액 ${won(holding.marketValueKrw)}`).join("\n") || "현재 등록된 운영종목이 없습니다.";
  const note = "발송 준비 시 조회한 최신 저장 내역을 기준으로 발급한 펀드 전체 운영종목 보유확인서입니다. 개인의 투자 잔액 또는 지분을 증명하는 문서는 아닙니다. 기준가격은 저장된 가격이며 실시간 시장가격과 다를 수 있습니다.";
  return render(
    `NXDI ${input.period} 운영종목 보유확인서`,
    `${table(rows)}${holdingsHtml}<p style="font-size:13px;color:#667085;margin-top:24px">${note}</p>`,
    [rows.map(([key, value]) => `${key}: ${value}`).join("\n"), "운영종목 보유 내역", holdingsText, note].join("\n\n"),
    input
  );
}
