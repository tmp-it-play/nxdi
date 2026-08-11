import type { FastifyReply } from "fastify";

export const FLASH_COOKIE_NAME = "nxdi_flash";
export type FlashMessage = { id: string; title: string; description?: string; tone?: "success" | "error" | "info" };

const errors: Record<string, string> = {
  terms_required: "약관 동의가 필요합니다",
  dividend_policy_required: "배당 정책 확인 동의가 필요합니다",
  invalid_monthly_dividend: "배당월과 월 실배당 합계를 확인해주세요",
  month_end_snapshot_required: "선택한 배당월의 확정 월말 평가금액 스냅샷이 필요합니다",
  invalid_intent_cancel: "철회할 수 있는 본인 의향서를 확인해주세요",
  investment_intake_paused: "현재 외부 투자 접수를 일시 중단했습니다",
  login_required: "로그인이 필요합니다",
  admin_required: "관리자 권한이 필요합니다",
  trade_not_found: "조정을 적용할 종목을 찾을 수 없습니다",
  trade_insufficient: "매도 수량이 현재 보유 수량보다 큽니다",
  risk_unclassified: "위험등급이 지정되지 않은 종목의 추가 취득을 중단했습니다",
  invalid_exchange_rate: "환율 입력값을 다시 확인해주세요",
  status_principal_invariant: "완료된 출금 의향 합계는 완료된 투자 의향 합계를 초과할 수 없습니다",
  snapshot_not_found: "확정할 스냅샷을 찾을 수 없습니다",
  dividend_sync_failed: "외부 배당 데이터를 가져오지 못했습니다",
  oauth_state: "OAuth state 검증에 실패했습니다. 다시 로그인하세요.",
  not_eligible: "재학생 또는 졸업생으로 확인되지 않아 이용할 수 없습니다.",
  oauth_origin: "접속 주소와 OAuth 콜백 주소가 다릅니다. 같은 주소로 접속하세요.",
  oauth_failed: "DataGSM 로그인 처리 중 오류가 발생했습니다.",
  datagsm_not_configured: "DataGSM OAuth 환경변수가 아직 설정되지 않았습니다."
};

export function errorFlash(code: string): FlashMessage {
  return { id: `error-${code}`, title: errors[code] ?? "입력값을 다시 확인해주세요", tone: "error" };
}

export function successFlash(id: string, title: string): FlashMessage {
  return { id, title, tone: "success" };
}

export function setFlash(reply: FastifyReply, message: FlashMessage) {
  reply.setCookie(FLASH_COOKIE_NAME, Buffer.from(JSON.stringify(message)).toString("base64url"), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60,
    path: "/"
  });
}

export function redirectWithFlash(reply: FastifyReply, path: string, message: FlashMessage, statusCode = 303) {
  const accept = reply.request.headers.accept ?? "";
  if (accept.split(",").some((value) => value.trim().split(";", 1)[0] === "application/json")) {
    return reply
      .code(message.tone === "error" ? 400 : 200)
      .send({ redirectTo: path, message });
  }

  setFlash(reply, message);
  return reply.redirect(path, statusCode);
}
