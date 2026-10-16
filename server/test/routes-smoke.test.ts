import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { encodeSession } from "../src/auth/session.js";
import { productPolicyDto } from "../src/domain/product-policy.js";
import type { ReadModels } from "../src/routes/read.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function appWith(options: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp(options);
  apps.push(app);
  return app;
}

describe("Fastify route smoke tests", () => {
  describe("given a running server", () => {
    describe("when health is requested", () => {
      it("then reports the server as healthy", async () => {
        const app = await appWith({ healthCheck: async () => undefined });
        const response = await app.inject({ method: "GET", url: "/health" });
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().status, "ok");
        assert.equal(response.json().database, "ok");
      });
    });
  });

  describe("given an unauthenticated request", () => {
    describe("when the admin dashboard is requested", () => {
      it("then rejects before querying the dashboard read model", async () => {
        let calls = 0;
        const app = await appWith({ readModels: { adminDashboard: (async () => { calls += 1; throw new Error("unexpected"); }) as ReadModels["adminDashboard"] } });
        const response = await app.inject({ method: "GET", url: "/api/admin/dashboard" });
        assert.equal(response.statusCode, 403);
        assert.equal(calls, 0);
      });
    });

    describe("when an intent mutation requests JSON", () => {
      it("then returns a structured error without redirecting or setting a flash cookie", async () => {
        const app = await appWith();
        const response = await app.inject({
          method: "POST",
          url: "/api/intents/invest",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded"
          },
          payload: ""
        });

        assert.equal(response.statusCode, 400);
        assert.equal(response.headers.location, undefined);
        assert.equal(response.json().redirectTo, "/intents");
        assert.equal(response.json().message.tone, "error");
        assert.equal(response.json().message.title, "로그인이 필요합니다");
        assert.ok(!String(response.headers["set-cookie"] ?? "").includes("nxdi_flash="));
      });
    });

    describe("when a cross-origin site submits a mutation", () => {
      it("then rejects it at the server boundary", async () => {
        const app = await appWith();
        const response = await app.inject({
          method: "POST",
          url: "/api/intents/invest",
          headers: {
            accept: "application/json",
            origin: "https://malicious.example",
            "content-type": "application/x-www-form-urlencoded"
          },
          payload: ""
        });

        assert.equal(response.statusCode, 403);
        assert.equal(response.json().error, "cross_origin_request_rejected");
      });
    });

    describe("when an intent mutation uses native form navigation", () => {
      it("then keeps the redirect and flash-cookie fallback", async () => {
        const app = await appWith();
        const response = await app.inject({
          method: "POST",
          url: "/api/intents/invest",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          payload: ""
        });

        assert.equal(response.statusCode, 303);
        assert.equal(response.headers.location, "/intents");
        assert.ok(String(response.headers["set-cookie"] ?? "").includes("nxdi_flash="));
      });
    });

    describe("when an admin mutation requests JSON", () => {
      it("then returns the authorization failure as a toast-compatible response", async () => {
        const app = await appWith();
        const response = await app.inject({
          method: "POST",
          url: "/api/admin/status",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded"
          },
          payload: ""
        });

        assert.equal(response.statusCode, 400);
        assert.equal(response.headers.location, undefined);
        assert.equal(response.json().redirectTo, "/admin");
        assert.equal(response.json().message.title, "관리자 권한이 필요합니다");
        assert.equal(response.json().message.tone, "error");
      });
    });
  });

  describe("given a logout request", () => {
    describe("when JSON is accepted", () => {
      it("then clears the session and returns a success message without navigation", async () => {
        const app = await appWith();
        const response = await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { accept: "application/json" }
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.headers.location, undefined);
        assert.equal(response.json().redirectTo, "/");
        assert.equal(response.json().message.tone, "success");
        assert.equal(response.json().message.title, "로그아웃되었습니다");
        assert.ok(String(response.headers["set-cookie"] ?? "").includes("nxdi_session="));
        assert.ok(!String(response.headers["set-cookie"] ?? "").includes("nxdi_flash="));
      });
    });
  });

  describe("given a malformed market quote request", () => {
    describe("when symbol is missing", () => {
      it("then returns a normalized validation response", async () => {
        const app = await appWith();
        const response = await app.inject({ method: "GET", url: "/api/market/quote" });
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().error, "invalid_symbol");
      });
    });
  });

  describe("given an authenticated user", () => {
    describe("when their intents are requested", () => {
      it("then scopes the read model by the signed session user id", async () => {
        process.env.APP_SESSION_SECRET = "test-session-secret-with-more-than-32-characters";
        let requestedUserId = "";
        const intents = (async (userId: string) => {
          requestedUserId = userId;
          return {
            store: { investmentIntents: [], withdrawalIntents: [] },
            payoutMode: null,
            totalReturnAccruedKrw: 0,
            withdrawalReference: { completedNetInvestmentIntentKrw: 0, pendingWithdrawalIntentKrw: 0, maxRequestIntentKrw: 0 },
            investmentAvailability: {
              completedInvestmentIntentKrw: 0,
              portfolioMarketValueKrw: 10_000_000,
              maxCompletedInvestmentIntentKrw: 1_000_000,
              isPaused: false
            },
            policy: productPolicyDto()
          };
        }) as ReadModels["intents"];
        const app = await appWith({ readModels: { intents } });
        const token = encodeSession({
          id: "only-this-user",
          email: "user@example.com",
          name: "사용자",
          role: "STUDENT",
          userType: "student"
        });
        const response = await app.inject({
          method: "GET",
          url: "/api/intents/me",
          cookies: { nxdi_session: token }
        });
        assert.equal(response.statusCode, 200);
        assert.equal(requestedUserId, "only-this-user");
        assert.equal(response.json().user.id, "only-this-user");
      });
    });
  });
});
