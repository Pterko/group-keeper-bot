import { Composer } from "grammy";
import { Context } from "#root/bot/context.js";
import { toxicModel } from "#root/models/toxic.js";

const composer = new Composer<Context>();

composer.hears([/^токс$/i, /^токсик$/i, /^токсично$/i, /^токсичненько$/i], async (ctx, next) => {
  console.log('токс ресивед', ctx.message);

  if (!ctx.message) {
    return await next();
  }

  // skip for тач
  if (ctx.message.chat.id === -1001526858418) {
    return await next();
  }

  if (!ctx.message?.reply_to_message?.from?.id) {
    await ctx.reply("А кто токсил-то? Реплайни на него.", { reply_to_message_id: ctx.message.message_id });
    return await next();
  }
  if (ctx.message?.reply_to_message?.from?.id === ctx.message?.from?.id) {
    await ctx.reply("Ты дебил сам на себя токсить?", { reply_to_message_id: ctx.message.message_id });
    return await next();
  }

  const updatedToxic = await toxicModel.findOneAndUpdate({
    userId: ctx.message.reply_to_message.from.id,
    chatId: ctx.message.chat.id
  }, {
    $inc: { toxicCounter: 1 },
    first_name: ctx.message.reply_to_message.from.first_name
  }, { new: true, upsert: true });

  await ctx.reply(`Уууу, жёсткий токс. Я добавил ${ctx.message.reply_to_message.from.first_name} очко токса. Счёт: ${updatedToxic.toxicCounter}`, { reply_to_message_id: ctx.message.message_id });
  await next();
});

composer.command('toxic', async (ctx, next) => {
  if (!ctx.message) {
    return await next();
  }
  // skip for тач
  if (ctx.message.chat.id === -1001526858418) {
    await ctx.reply('Эта фича отключена в этом чате', { disable_notification: true });
    return await next();
  }

  const toxicTable = await toxicModel.find({ chatId: ctx.message.chat.id }).sort({ toxicCounter: 'desc' }).limit(10).exec();

  let text = `Топ-10 токсиков этого чата:\r\n`;
  for (const [index, toxicMan] of toxicTable.entries()) {
    text += `${(index === 0 ? '🥇' : '')}${(index === 1 ? '🥈' : '')}${(index === 2 ? '🥉' : '')} [${toxicMan.first_name}](tg://user?id=${toxicMan.userId}) - ${toxicMan.toxicCounter} очков \r\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown', disable_notification: true });
});

export { composer as toxicFeature };