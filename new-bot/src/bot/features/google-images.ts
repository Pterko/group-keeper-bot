import { Composer, InputFile } from "grammy";
import { Context } from "#root/bot/context.js";
import { searchDdgImages } from "#root/bot/helpers/ddg-images.js";
import { InlineKeyboard } from "grammy";
import axios from "axios";

const composer = new Composer<Context>();

// Telegram refuses uploads above this, so there is no point in downloading more
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
// How many different images to try before giving up on the request entirely
const MAX_SEND_ATTEMPTS = 3;
// Results past this point get noticeably less relevant, so picks stay within the top
const CANDIDATE_POOL_SIZE = 21;

interface ImageReplyOptions {
  reply_to_message_id: number;
  caption?: string;
  reply_markup?: InlineKeyboard;
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getFileName(url: string, kind: "photo" | "document") {
  const fromUrl = new URL(url).pathname.split("/").pop();
  return fromUrl && /\.[a-z0-9]{2,4}$/i.test(fromUrl) ? fromUrl : `image.${kind === "document" ? "gif" : "jpg"}`;
}

async function downloadImage(url: string) {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxContentLength: MAX_UPLOAD_BYTES,
  });
  return Buffer.from(response.data);
}

// Passing a URL lets Telegram fetch the file itself, which is cheap but fails whenever
// its fetcher cannot reach the host or times out on it. In that case the bot downloads
// the image and uploads the bytes instead — the caller only sees a rejection if both fail
async function replyWithImage(ctx: Context, url: string, kind: "photo" | "document", options: ImageReplyOptions) {
  const send = (image: string | InputFile) =>
    kind === "document" ? ctx.replyWithDocument(image, options) : ctx.replyWithPhoto(image, options);

  try {
    return await send(url);
  } catch (error) {
    ctx.logger.warn({ msg: "telegram failed to fetch image by url, retrying as an upload", url, err: error });
  }

  return await send(new InputFile(await downloadImage(url), getFileName(url, kind)));
}

// A dead host or a broken file should cost the user a different picture, not the
// whole answer, so every candidate is tried before the caller has to give up
async function sendFirstWorkingImage(
  ctx: Context,
  candidates: string[],
  buildOptions: (index: number) => ImageReplyOptions,
  allowDocuments: boolean,
) {
  for (const [index, url] of candidates.entries()) {
    const kind = allowDocuments && url.endsWith(".gif") ? "document" : "photo";
    try {
      return { message: await replyWithImage(ctx, url, kind, buildOptions(index)), index, url };
    } catch (error) {
      ctx.logger.warn({ msg: "could not send image, trying the next candidate", url, attempt: index + 1, err: error });
    }
  }
  return null;
}

// Random order, so a repeated query does not keep returning the same picture
function pickRandomCandidates(images: string[], count: number) {
  const pool = images.slice(0, CANDIDATE_POOL_SIZE);
  const candidates: string[] = [];
  while (pool.length > 0 && candidates.length < count) {
    candidates.push(...pool.splice(getRandomInt(0, pool.length - 1), 1));
  }
  return candidates;
}

interface SavedMessage {
  currentPic: number;
  maxPics: number;
  items: string[];
  query: string;
}

const savedMessagesWithPhotos: Record<string, SavedMessage> = {};

async function getPictureByKeysV2(key: string, safe = false) {
  const foundImages = await searchDdgImages(key, { safe });
  const images = foundImages.map((x) => x.url);
  return { status: "success", images };
}

composer.hears(/^(покажи )/i, async (ctx) => {
  if (!ctx.message || !ctx.message.text) return;
  const fullMessageText = ctx.message.text.toLowerCase();
  const searchKey = fullMessageText.replace("покажи ", "");

  await ctx.replyWithChatAction("upload_photo");

  const getResult = await getPictureByKeysV2(searchKey);

  if (getResult.status === "success" && getResult.images.length > 0) {
    ctx.interactedWithUser = true;
    ctx.triggeredFeatures.push("google-images");
    
    const candidates = pickRandomCandidates(getResult.images, MAX_SEND_ATTEMPTS);
    const replyOptions = { reply_to_message_id: ctx.message.message_id };
    const sent = await sendFirstWorkingImage(ctx, candidates, () => replyOptions, true);

    if (!sent) {
      ctx.logger.warn({ msg: "every image candidate failed, replying with a link", query: searchKey });
      urlFallback(ctx, candidates[0]);
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
    const keyboard = new InlineKeyboard()
      .text("<<<<", "prev_img")
      .text(">>>>", "next_img");

    // The listing starts at the first image that Telegram actually accepts, so the
    // caption and the carousel position stay in sync with what was really sent
    const sent = await sendFirstWorkingImage(
      ctx,
      getResult.images.slice(0, MAX_SEND_ATTEMPTS),
      (index) => ({
        caption: generateMessageForListing({
          currentImageIndex: index,
          totalImagesCount: getResult.images.length,
          query: searchKey
        }),
        reply_to_message_id: ctx.message!.message_id,
        reply_markup: keyboard
      }),
      false
    );

    if (!sent) {
      ctx.logger.warn({ msg: "every image candidate failed for the listing", query: searchKey });
      return;
    }

    savedMessagesWithPhotos[`${sent.message.chat.id}_${sent.message.message_id}`] = {
      currentPic: sent.index,
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