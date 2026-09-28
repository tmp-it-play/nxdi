import { registerTemporaryEmailTestRoutes } from "./temporary/email-tests/index.js";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyReply, type FastifyRequest, type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import { registerNotificationRoutes } from "./routes/admin-notifications.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCronRoutes } from "./routes/cron.js";
import { registerIntentRoutes } from "./routes/intents.js";
import { registerMarketRoutes } from "./routes/market.js";
import { defaultReadModels, registerReadRoutes, type ReadModels } from "./routes/read.js";
import { checkDatabaseReadiness } from "./infrastructure/readiness.js";

export type BuildAppOptions = {
  logger?: FastifyServerOptions["logger"];
  readModels?: Partial<ReadModels>;
  healthCheck?: () => Promise<void>;
};

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function mutationOriginAllowed(request: FastifyRequest) {
  if (!MUTATION_METHODS.has(request.method) || !(request.url === "/api" || request.url.startsWith("/api/"))) {
    return true;
  }

  const origin = request.headers.origin;
  if (!origin) return request.headers["sec-fetch-site"] !== "cross-site";

  try {
    const publicOrigin = new URL(process.env.PUBLIC_APP_URL ?? "http://localhost:3000").origin;
    return new URL(origin).origin === publicOrigin;
  } catch {
    return false;
  }
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: 1024 * 1024
  });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, { global: false });

  app.addHook("onRequest", async (request, reply) => {
    if (!mutationOriginAllowed(request)) {
      return reply.code(403).send({ error: "cross_origin_request_rejected" });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url === "/api" || request.url.startsWith("/api/")) {
      reply.header("Cache-Control", "private, no-store");
      reply.header("Vary", "Cookie");
    }
    return payload;
  });

  const health = async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      await (options.healthCheck ?? checkDatabaseReadiness)();
      return {
        status: "ok",
        service: "nxdi-server",
        database: "ok",
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      };
    } catch {
      return reply.code(503).send({ status: "unavailable", service: "nxdi-server", database: "unavailable" });
    }
  };
  app.get("/health", health);
  app.get("/ready", health);

  await registerAuthRoutes(app);
  await registerReadRoutes(app, { ...defaultReadModels, ...options.readModels });
  await registerIntentRoutes(app);
  await registerMarketRoutes(app);
  await registerAdminRoutes(app);
  await registerNotificationRoutes(app);
  await registerTemporaryEmailTestRoutes(app);
  await registerCronRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "validation_error", fields: error.flatten().fieldErrors });
    }
    const candidateStatus = typeof error === "object" && error !== null && "statusCode" in error
      ? Number(error.statusCode)
      : undefined;
    const statusCode = candidateStatus && candidateStatus >= 400 && candidateStatus < 600
      ? candidateStatus
      : 500;
    if (statusCode >= 500) request.log.error({ err: error }, "Request failed");
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? "internal_server_error" : "invalid_request",
      message: statusCode >= 500 ? undefined : error instanceof Error ? error.message : "Invalid request"
    });
  });

  return app;
}
