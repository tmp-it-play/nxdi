import type { RenderedEmail } from "../../domain/notifications/index.js";
import type { MonthlyTestInput } from "./domain.js";

const disclaimer = "테스트 이메일입니다. 표시된 내용은 실제 거래·지급 통지가 아닙니다.";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Decorate a complete production email; no test condition is needed in its renderer. */
export function markTestEmail(email: RenderedEmail, input?: MonthlyTestInput): RenderedEmail {
  const subject = `[테스트] ${email.subject}`;
  const amount = (value: number) => `${value.toLocaleString("ko-KR")}원`;
  const rows: Array<[string, string]> = input ? [
    ["배당 기준월", input.dividendMonth], ["포트폴리오 총액", amount(input.totalMarketValueKrw)],
    ["가상 투자금액", amount(input.investmentKrw)], ["월 실배당 합계", amount(input.actualDividendKrw)]
  ] : [];
  const inputHtml = rows.length ? `<h2 style="font-size:18px">테스트 계산 입력값</h2><p>가상 투자자 한 명을 기준으로 계산했습니다.</p><table style="width:100%;border-collapse:collapse;font-size:14px">${rows.map(([label, value]) => `<tr><th scope="row" style="text-align:left;padding:8px;border-bottom:1px solid #e4dcbf">${escapeHtml(label)}</th><td style="text-align:right;padding:8px;border-bottom:1px solid #e4dcbf">${escapeHtml(value)}</td></tr>`).join("")}</table>` : "";
  const banner = `<div style="max-width:640px;margin:16px auto;padding:16px;box-sizing:border-box;background:#fff7df;border:1px solid #ead6a1;border-radius:8px"><strong>${disclaimer}</strong>${inputHtml}</div>`;
  const html = email.html.replace(/<title>[^]*?<\/title>/i, () => `<title>${escapeHtml(subject)}</title>`)
    .replace(/(<body\b[^>]*>)/i, (body) => `${body}${banner}`);
  return {
    subject,
    html,
    text: [subject, disclaimer, ...(rows.length ? ["테스트 계산 입력값 (가상 투자자 한 명)", rows.map(([label, value]) => `${label}: ${value}`).join("\n")] : []), email.text].join("\n\n")
  };
}
