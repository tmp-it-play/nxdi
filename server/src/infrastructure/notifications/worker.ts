import cron from "node-cron";
import type { FastifyBaseLogger } from "fastify";
import type { Environment } from "../../config/env.js";
import { EmailDeliveryService } from "../../application/email-delivery-service.js";
import { PrismaDeliveryRepository, recoverExpiredDeliveries } from "./delivery-repository.js";
import { prepareDueNotifications } from "./preparation.js";
import { createSmtpMailSender } from "./smtp.js";
import { setNotificationWake } from "./signals.js";

export function startNotificationWorker(environment: Environment, logger: FastifyBaseLogger) {
  const sender = createSmtpMailSender(environment);
  const dispatcher = new EmailDeliveryService(new PrismaDeliveryRepository(), sender);
  let running: Promise<void> | undefined;
  let stopped = false;
  let wakeRequested = false;
  const run = () => {
    if (stopped) return;
    if (running) { wakeRequested = true; return; }
    running = (async () => {
      do {
        wakeRequested = false;
        try {
          await recoverExpiredDeliveries(new Date());
          await prepareDueNotifications(new Date());
          for (let i = 0; i < environment.MAIL_BATCH_SIZE && !stopped; i++) {
            if (!await dispatcher.runOne()) break;
          }
        } catch {
          logger.error({ code: "NOTIFICATION_WORKER_FAILED" }, "Notification worker failed; durable queue will be checked again");
        }
      } while (wakeRequested && !stopped);
    })().finally(() => { running = undefined; });
  };
  const task = cron.schedule("* * * * *", run, { timezone: "Asia/Seoul" });
  setNotificationWake(run);
  run();
  return { async stop() {
    stopped = true;
    setNotificationWake(undefined);
    await task.stop();
    await sender.close();
    await running;
  } };
}
