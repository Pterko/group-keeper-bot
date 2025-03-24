import { Composer, Context as GrammyContext, InputFile, NextFunction } from "grammy";
import fs from "node:fs";
import path from "node:path";
import { config } from "#root/config.js";
import type { Context } from "#root/bot/context.js";

const composer = new Composer<Context>();

export const staticPicturesHandler = (folderKey: string) => {
  return async (ctx: Context, next: NextFunction) => {
    const catalog = path.join(config.FURRY_PATH, `/${folderKey}`) || `/app/furry/${folderKey}/`;
    fs.readdir(catalog, (err, items) => {
      if (err || !items || items.length === 0) {
        ctx.reply("No pictures found.");
      } else {
        ctx.interactedWithUser = true;
        ctx.triggeredFeatures.push("furry");

        const item = items[Math.floor(Math.random() * items.length)];
        ctx.replyWithPhoto(
          new InputFile(fs.createReadStream(path.join(catalog, item)))
        );
      }
    });
    await next();
  };
};

composer.command("mt", staticPicturesHandler("mt"));

export { composer as furryFeature };