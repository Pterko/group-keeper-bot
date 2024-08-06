import { Composer, Context as GrammyContext, InputFile, NextFunction } from "grammy";
import fs from "fs";
import path from "node:path";
import { config } from "#root/config.js";

const bot = new Composer();

export const staticPicturesHandler = (folderKey: string) => {
  return async (ctx: GrammyContext, next: NextFunction) => {
    const catalog = path.join(config.FURRY_PATH, `/${folderKey}`) || `/app/furry/${folderKey}/`;
    fs.readdir(catalog, (err, items) => {
      if (err || !items || items.length === 0) {
        ctx.reply("No pictures found.");
      } else {
        const item = items[Math.floor(Math.random() * items.length)];
        ctx.replyWithPhoto(
          new InputFile(fs.createReadStream(path.join(catalog, item)))
        );
      }
    });
    await next();
  };
};

bot.command("mt", staticPicturesHandler("mt"));

export { bot as furryFeature };