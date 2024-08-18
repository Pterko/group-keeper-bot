import { Composer, NextFunction } from "grammy";
import type { Context } from "#root/bot/context.js";
import { logHandle } from "#root/bot/helpers/logging.js";

const composer = new Composer<Context>();

composer.hears("хуисик", logHandle("hears-хуисик"), async (ctx, next) => {
  if (!ctx.message){
    return await next();
  }
  ctx.reply("Ну ты и бяка :c . Гори в аду!", {
    reply_to_message_id: ctx.message.message_id,
  });
  return await next();
});

composer.hears(/[Сс]пасибо/msg, logHandle("hears-спасибо"), async (ctx, next) => {
  if (!ctx.message){
    return await next();
  }
  if (
    ctx.message.reply_to_message &&
    ctx.message.reply_to_message.from &&
    ctx.message.reply_to_message.from.id === ctx.me.id
  ) {
    ctx.reply("Всегда пожалуйста :3", {
      reply_to_message_id: ctx.message.message_id,
    });
  }
  return await next();
});

const nahuiHandler = async (ctx: Context, next: NextFunction) => {
  if (!ctx.message){
    return await next();
  }
  ctx.replyWithSticker("BQADAgADtgAD-6tWBxcZTn3O_9D2Ag", {
    reply_to_message_id: ctx.message.message_id,
  });
  return await next();
};

composer.hears("пошел нахуй", logHandle("hears-пошел нахуй"), nahuiHandler);
composer.hears("нахуй пошел", logHandle("hears-нахуй пошел"), nahuiHandler);
composer.hears("пошёл нахуй", logHandle("hears-пошёл нахуй"), nahuiHandler);
composer.hears("нахуй пошёл", logHandle("hears-нахуй пошёл"), nahuiHandler);

export { composer as shortAnswersFeature };