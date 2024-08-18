import { Middleware } from "grammy";
import type { Update } from "@grammyjs/types";
import type { Context } from "#root/bot/context.js";

export function getUpdateInfo(ctx: Context): Omit<Update, "update_id"> {
  // eslint-disable-next-line camelcase, @typescript-eslint/no-unused-vars
  const { update_id, ...update } = ctx.update;

  return update;
}

export function logHandle(id: string): Middleware<Context> {
  return async (ctx, next) => {
    ctx.logger.info({
      msg: `feature: ${id}`,
      ...(id.startsWith("unhandled") ? { update: getUpdateInfo(ctx) } : {}),
    });

    return await next();
  };
}
