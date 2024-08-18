#!/usr/bin/env tsx

console.log('Bot starting...');

import { onShutdown } from "node-graceful-shutdown";
import { createBot } from "#root/bot/index.js";
import { config } from "#root/config.js";
import { logger } from "#root/logger.js";
import { createServer } from "#root/server/index.js";
import { connectToDatabase } from "#root/db.js";
import { run } from "@grammyjs/runner";


try {
  await connectToDatabase();
  const bot = createBot(config.BOT_TOKEN);
  const server = await createServer(bot);

  // Graceful shutdown
  onShutdown(async () => {
    logger.info("shutdown");

    await server.close();
    await bot.stop();
  });

  if (config.BOT_MODE === "webhook") {
    // to prevent receiving updates before the bot is ready
    await bot.init();

    await server.listen({
      host: config.BOT_SERVER_HOST,
      port: config.BOT_SERVER_PORT,
    });

    await bot.api.setWebhook(config.BOT_WEBHOOK, {
      allowed_updates: config.BOT_ALLOWED_UPDATES,
    });
  } else if (config.BOT_MODE === "polling") {
    await run(bot, {
      runner: {
        fetch: {
          allowed_updates: config.BOT_ALLOWED_UPDATES,
        }
      }
    });
    await bot.init();
    
    logger.info({
      msg: "bot running as:",
      bot: bot.botInfo
    })
  }
} catch (error) {
  logger.error(error);
  process.exit(1);
}
