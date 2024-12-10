import { Context } from '../context.js';
import { config } from "#root/config.js";
import { NextFunction } from 'grammy';
import { Composer } from 'grammy';


const composer = new Composer<Context>();

composer.command('adminDeleteMessage', async (ctx: Context, next: NextFunction) => {
    // Ensure BOT_ADMINS is defined and parse it
    const admins = config.BOT_ADMINS ? config.BOT_ADMINS : [];

    // Check if the user is an admin
    if (!ctx.from || !admins.includes(ctx.from?.id.toString() ?? '')) {
      //return ctx.reply('You are not authorized to use this command.');
      return next();
    }

    // Ensure the command is a reply to a message
    const messageId = ctx.message?.reply_to_message?.message_id;
    const chatId = ctx.message?.chat.id;

    if (ctx.message?.reply_to_message?.from?.id !== ctx.me.id) {
      return next();
    }

    if (!messageId) {
      return next();
    }

    try {
      if (!chatId || !messageId) {
        return next();
      }
      // Delete the specified message
      await ctx.api.deleteMessage(chatId, messageId);
      //ctx.reply('Message deleted successfully.');

      try {
        await ctx.api.deleteMessage(chatId, ctx.message?.message_id ?? 0);
        //ctx.reply('Message deleted successfully.');
      } catch (error) {
        //ctx.reply('Failed to delete the message.');
      }
    } catch (error) {
      //ctx.reply('Failed to delete the message.');
    }
}); 

export { composer as adminDeleteMessage };