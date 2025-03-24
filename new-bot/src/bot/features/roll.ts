import { Composer } from "grammy";
import { Context } from "#root/bot/context.js";
import { logHandle } from "#root/bot/helpers/logging.js";

const composer = new Composer<Context>();

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const rollHandler = (mode: "double" | "roll") => async (ctx: Context) => {
  let randomInt: number;

  if (mode === "double") {
    randomInt = getRandomInt(10, 99);
  } else {
    randomInt = getRandomInt(0, 100);
  }

  ctx.interactedWithUser = true;
  ctx.triggeredFeatures.push("roll");
  
  await ctx.reply(`Ты выбросил ***${randomInt}***`, {
    parse_mode: "Markdown",
    reply_to_message_id: ctx.message?.message_id,
  });
};

composer.hears(/^(на дабл)/i, logHandle("hears-на-дабл"), rollHandler("double"));
composer.command("roll", logHandle("command-roll"), rollHandler("roll"));

export { composer as rollFeature };