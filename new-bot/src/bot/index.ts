import { autoChatAction } from "@grammyjs/auto-chat-action";
import { hydrate } from "@grammyjs/hydrate";
import { hydrateReply, parseMode } from "@grammyjs/parse-mode";
import { chatMembers, type ChatMembersFlavor } from "@grammyjs/chat-members";
import { MongoDBAdapter, ISession } from "@grammyjs/storage-mongodb";
import { BotConfig, StorageAdapter, Bot as TelegramBot, session } from "grammy";
import mongoose from "mongoose";
import {
  Context,
  SessionData,
  createContextConstructor,
} from "#root/bot/context.js";
import {
  adminFeature,
  languageFeature,
  unhandledFeature,
  welcomeFeature,
} from "#root/bot/features/index.js";
import { errorHandler } from "#root/bot/handlers/index.js";
import { i18n, isMultipleLocales } from "#root/bot/i18n.js";
import { updateLogger } from "#root/bot/middlewares/index.js";
import { config } from "#root/config.js";
import { logger } from "#root/logger.js";
import { downloadVideoFeature } from "./features/download-video.js";
import { catsBulgeFeature } from "./features/cats-bulge.js";
import { hydrateFiles } from "@grammyjs/files";
import { googleImagesFeature } from "./features/google-images.js";
import { shortAnswersFeature } from "./features/short-answers.js";
import { toxicFeature } from "./features/toxic.js";
import { videoConventerFeature } from "./features/video-converter.js";
import { llamaFeature } from "./features/llama.js";
import { furryFeature } from "./features/furry.js";
import { ChatMember } from "@grammyjs/types";
import { logChatMessage } from "./middlewares/log-chat-message.js";

type Options = {
  sessionStorage?: StorageAdapter<SessionData>;
  config?: Omit<BotConfig<Context>, "ContextConstructor">;
};


export function createBot(token: string, options: Options = {}) {

  const chatMembersStorageAdapter = new MongoDBAdapter<ChatMember>({ collection: mongoose.connection.db.collection<ISession>(
    "chatMembers",
  )});

  const { sessionStorage } = options;
  const bot = new TelegramBot(token, {
    ...options.config,
    ContextConstructor: createContextConstructor({ logger }),
  });
  const protectedBot = bot.errorBoundary(errorHandler);

  // Middlewares
  bot.api.config.use(parseMode("HTML"));
  bot.api.config.use(hydrateFiles(bot.token));


  // if (config.isDev) {
    protectedBot.use(updateLogger());
  // }


  protectedBot.use(chatMembers(chatMembersStorageAdapter, { enableAggressiveStorage: true }));

  protectedBot.use(autoChatAction(bot.api));
  protectedBot.use(hydrateReply);
  protectedBot.use(hydrate());
  protectedBot.use(
    session({
      initial: () => ({}),
      storage: sessionStorage,
    }),
  );
  protectedBot.use(i18n);

  protectedBot.use(logChatMessage);

  // Handlers
  protectedBot.use(furryFeature);
  protectedBot.use(videoConventerFeature);
  protectedBot.use(llamaFeature);
  protectedBot.use(toxicFeature);
  protectedBot.use(downloadVideoFeature);
  protectedBot.use(googleImagesFeature);
  protectedBot.use(catsBulgeFeature);
  protectedBot.use(welcomeFeature);
  protectedBot.use(adminFeature);

  protectedBot.use(shortAnswersFeature);

  if (isMultipleLocales) {
    protectedBot.use(languageFeature);
  }


  bot.catch((err) => {
    logger.error(`Error in bot: ${err.error} , while parsing update ${JSON.stringify(err.ctx)}`);
  }) 

  // must be the last handler
  // protectedBot.use(unhandledFeature);

  return bot;
}

export type Bot = ReturnType<typeof createBot>;
