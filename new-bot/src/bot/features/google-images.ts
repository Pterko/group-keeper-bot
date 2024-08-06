import { Composer } from "grammy";
import { Context } from "#root/bot/context.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import googlethis from "googlethis";
import { InlineKeyboard } from "grammy";

const composer = new Composer<Context>();

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface SavedMessage {
  currentPic: number;
  maxPics: number;
  items: string[];
  query: string;
}

const savedMessagesWithPhotos: Record<string, SavedMessage> = {};

async function getPictureByKeysV2(key: string, safe = false) {
  const imagesFromGoogle = await googlethis.image(key, { safe });
  const images = imagesFromGoogle.map((x: any) => x.url);
  const url = images[getRandomInt(0, Math.min(images.length - 1, 20))];
  return { status: "success", url, images };
}

composer.hears(/^(покажи )/i, async (ctx) => {
  if (!ctx.message || !ctx.message.text) return;
  const fullMessageText = ctx.message.text.toLowerCase();
  const searchKey = fullMessageText.replace("покажи ", "");

  await ctx.replyWithChatAction("upload_photo");

  const getResult = await getPictureByKeysV2(searchKey);

  if (getResult.status === "success" && getResult.images.length > 0) {
    if (getResult.url.endsWith(".gif")) {
      await ctx.replyWithDocument(getResult.url, { reply_to_message_id: ctx.message.message_id })
        .catch(() => urlFallback(ctx, getResult.url));
    } else {
      await ctx.replyWithPhoto(getResult.url, { reply_to_message_id: ctx.message.message_id })
        .catch(() => urlFallback(ctx, getResult.url));
    }
  }
});


composer.hears(/^(выдача )/i, async (ctx) => {
  if (!ctx.message || !ctx.message.text) return;
  const fullMessageText = ctx.message.text.toLowerCase();
  const searchKey = fullMessageText.replace("выдача ", "");

  await ctx.replyWithChatAction("upload_photo");

  const getResult = await getPictureByKeysV2(searchKey);

  if (getResult.status === "success") {
    const firstUrl = getResult.images[0];
    const text = generateMessageForListing({
      currentImageIndex: 0,
      totalImagesCount: getResult.images.length,
      query: searchKey
    });

    const keyboard = new InlineKeyboard()
      .text("<<<<", "prev_img")
      .text(">>>>", "next_img");

    const result = await ctx.replyWithPhoto(firstUrl, {
      caption: text,
      reply_to_message_id: ctx.message.message_id,
      reply_markup: keyboard
    });

    savedMessagesWithPhotos[`${result.chat.id}_${result.message_id}`] = {
      currentPic: 0,
      maxPics: getResult.images.length,
      items: getResult.images,
      query: searchKey
    };
  }
});

composer.on("callback_query:data", async (ctx) => {
  if (!ctx.callbackQuery.message) return;
  const data = ctx.callbackQuery.data;
  const messageId = `${ctx.callbackQuery.message.chat.id}_${ctx.callbackQuery.message.message_id}`;
  const save = savedMessagesWithPhotos[messageId];

  if (!save) return;

  if (data === "prev_img" && save.currentPic === 0) {
    await ctx.answerCallbackQuery("Это первая картинка.");
  } else if (data === "next_img" && save.currentPic === save.items.length - 1) {
    await ctx.answerCallbackQuery("Это последняя картинка.");
  } else {
    save.currentPic += data === "prev_img" ? -1 : 1;
    const text = generateMessageForListing({
      currentImageIndex: save.currentPic,
      query: save.query,
      totalImagesCount: save.items.length
    });

    const keyboard = new InlineKeyboard()
      .text("<<<<", "prev_img")
      .text(">>>>", "next_img");

    await ctx.editMessageMedia({ type: "photo", media: save.items[save.currentPic] });
    await ctx.editMessageCaption({caption: text, reply_markup: keyboard as any  });
    await ctx.answerCallbackQuery();
  }
});

function generateMessageForListing({
  currentImageIndex,
  query,
  totalImagesCount
}: {
  currentImageIndex: number;
  query: string;
  totalImagesCount: number;
}) {
  return `Запрос *${query}*\nПоказана картинка ${currentImageIndex + 1} из ${totalImagesCount}. `;
}

function urlFallback(ctx: Context, link: string) {
  if (!ctx.message) return;
  ctx.replyWithMarkdown(`[Ссылка](${link})`, { reply_to_message_id: ctx.message.message_id });
}

export { composer as googleImagesFeature };