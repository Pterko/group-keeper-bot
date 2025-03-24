import { Composer } from "grammy";
import type { Context } from "#root/bot/context.js";

const composer = new Composer<Context>();

const WELCOME_START_MESSAGE = `Привет! Это Гуфовский - мультифункциональный бот, умеющий выполнять разные задачи: от тривиальной скачки видео, до живого ебанутого общения с ИИ-ассистентом.

<b>Что я умею:</b>
- Скачивать короткие видео из Twitter, Youtube и Instagram: просто отправь ссылку в чат
- Показывать картинки из гугла: для этого начни своё сообщение со слова "покажи"
- Отмечать участников чата как токсичных - просто ответь на их сообщение "токс", и я это запомню. А таблицу токсиков можно увидеть по команде /toxic
- Конвертировать видео из Webm в mp4
- <b>И самое интересное</b>: я могу общаться с вами как ии-бот, принимая во внимания контекст чата. Для этого начни сообщение одним из следующих слов: "гуф", "гуфи" или "гуфовский" 

Удачи! Если что - пиши в бот обратной связи: @GroupKeeperFeedbackBot`

composer.command("start", async (ctx) => {
  ctx.interactedWithUser = true;
  ctx.triggeredFeatures.push("welcome");
  
  await ctx.reply(WELCOME_START_MESSAGE, { parse_mode: "HTML" });
});


export { composer as welcomeFeature };
