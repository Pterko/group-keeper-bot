import { performance } from "node:perf_hooks";
import { Middleware } from "grammy";
import type { Context } from "#root/bot/context.js";
import { getUpdateInfo } from "#root/bot/helpers/logging.js";
import newrelic from "newrelic";

export function updateLogger(): Middleware<Context> {
  return async (ctx, next) => {
    ctx.api.config.use((previous, method, payload, signal) => {
      ctx.logger.debug({
        msg: "bot api call",
        method,
        //payload,
      });

      return previous(method, payload, signal);
    });

    newrelic.incrementMetric('updates/received', 1);

    // ctx.logger.debug({
    //   msg: "update received",
    //   update: getUpdateInfo(ctx),
    // });

    ctx.logger.debug({
      msg: "update received",
      text: ctx.message?.text,
      chatId: ctx.message?.chat.id,
      userId: ctx.message?.from.id,
    })

    const startTime = performance.now();
    try {
      await next();
    } finally {
      const endTime = performance.now();
      ctx.logger.debug({
        msg: "update processed",
        duration: endTime - startTime,
      });
      newrelic.incrementMetric('updates/processed', 1);
      newrelic.recordMetric('updates/processing_time', endTime - startTime);
    }
  };
}
