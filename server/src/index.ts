import { temporaryEmailTestDeliveryPolicy } from "./temporary/email-tests/index.js";
import type { FastifyRequest } from "fastify";
import { loadEnvironment } from "./config/env.js";
import { buildApp } from "./app.js";
import { disconnectPrisma } from "./infrastructure/prisma.js";
import { startNotificationWorker } from "./infrastructure/notifications/worker.js";
import { startScheduler } from "./scheduler/index.js";

for (const path of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path);
    break;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const environment = loadEnvironment();
process.env.TZ = environment.TZ;
const app = await buildApp({
  logger: {
    serializers: {
      req(request: FastifyRequest) {
        return {
          method: request.method,
          url: request.url?.split("?", 1)[0],
          host: request.headers.host,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort
        };
      }
    }
  }
});
await app.listen({ host: environment.HOST, port: environment.PORT });
const scheduler = startScheduler(app.log);
const notificationWorker = startNotificationWorker(environment, app.log, [temporaryEmailTestDeliveryPolicy]);

let closing = false;
async function close(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, "Shutting down");
  scheduler.stop();
  await notificationWorker.stop();
  await app.close();
  await disconnectPrisma();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void close(signal).finally(() => process.exit(0)));
}
