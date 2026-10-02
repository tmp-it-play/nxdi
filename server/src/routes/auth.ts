import type { FastifyInstance } from "fastify";
import { clearUserSession, randomToken, setUserSession } from "../auth/session.js";
import {
  createAuthorizeUrl,
  createCodeChallenge,
  exchangeDataGsmCode,
  fetchDataGsmUser,
  toEligibleAppUser
} from "../infrastructure/datagsm.js";
import { errorFlash, redirectWithFlash, successFlash } from "../http/flash.js";

const OAUTH_STATE_COOKIE = "datagsm_oauth_state";
const OAUTH_VERIFIER_COOKIE = "datagsm_code_verifier";

function publicUrl(path = "/") {
  return new URL(path, process.env.PUBLIC_APP_URL ?? "http://localhost:3000");
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/api/auth/datagsm/start", async (_request, reply) => {
    const clientId = process.env.DATAGSM_CLIENT_ID;
    const redirectUri = process.env.DATAGSM_REDIRECT_URI ?? publicUrl("/api/auth/datagsm/callback").toString();
    if (!clientId) return redirectWithFlash(reply, "/", errorFlash("datagsm_not_configured"), 307);
    if (new URL(redirectUri).origin !== publicUrl().origin) {
      return redirectWithFlash(reply, "/", errorFlash("oauth_origin"), 307);
    }
    const state = randomToken();
    const verifier = randomToken();
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: publicUrl().protocol === "https:",
      maxAge: 5 * 60,
      path: "/"
    };
    reply.setCookie(OAUTH_STATE_COOKIE, state, cookieOptions);
    reply.setCookie(OAUTH_VERIFIER_COOKIE, verifier, cookieOptions);
    return reply.redirect(createAuthorizeUrl({
      clientId,
      redirectUri,
      state,
      codeChallenge: createCodeChallenge(verifier)
    }).toString());
  });

  app.get("/api/auth/datagsm/callback", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const savedState = request.cookies[OAUTH_STATE_COOKIE];
    const verifier = request.cookies[OAUTH_VERIFIER_COOKIE];
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
    reply.clearCookie(OAUTH_VERIFIER_COOKIE, { path: "/" });
    if (!query.code || !query.state || !savedState || !verifier || query.state !== savedState) {
      return redirectWithFlash(reply, "/", errorFlash("oauth_state"), 307);
    }
    try {
      const redirectUri = process.env.DATAGSM_REDIRECT_URI ?? publicUrl("/api/auth/datagsm/callback").toString();
      const token = await exchangeDataGsmCode({ code: query.code, codeVerifier: verifier, redirectUri });
      const user = toEligibleAppUser(await fetchDataGsmUser(token));
      if (!user) return redirectWithFlash(reply, "/", errorFlash("not_eligible"), 307);
      setUserSession(reply, user);
      return reply.redirect("/");
    } catch (error) {
      request.log.warn({ err: error instanceof Error ? error.message : "unknown" }, "DataGSM callback failed");
      return redirectWithFlash(reply, "/", errorFlash("oauth_failed"), 307);
    }
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearUserSession(reply);
    return redirectWithFlash(reply, "/", successFlash("logged-out", "로그아웃되었습니다"));
  });

  app.post("/api/auth/dev-login", async (request, reply) => {
    if (process.env.NODE_ENV === "production" || process.env.ENABLE_DEV_LOGIN === "false") {
      return reply.code(404).send({ message: "Dev login is disabled" });
    }
    const body = request.body as Record<string, unknown> | undefined;
    setUserSession(reply, {
      id: "dev-user",
      email: "student@gsm.hs.kr",
      name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "개발 사용자",
      role: "GENERAL_STUDENT",
      studentNumber: 1101,
      userType: "student"
    });
    return reply.redirect("/", 303);
  });
}
