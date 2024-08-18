import { Middleware, NextFunction } from "grammy";
import { Message } from "@grammyjs/types";
import type { Context } from "#root/bot/context.js";
import { chatMessageModel } from "#root/models/chatMessage.js";

export async function logChatMessage(ctx: Context, next: NextFunction) {
  try {
    if (ctx.message && ctx.message.chat.id && ctx.message.from.id) {
      const chatMessage = ctx.message;
      chatMessageModel.create({
        chatId: chatMessage.chat.id,
        userId: chatMessage.from.id,
        message: chatMessage,
      });
    }
  } catch (error) {
    console.error(`Error logging chat message: ${error}`);
  } finally {
    await next();
  }
}