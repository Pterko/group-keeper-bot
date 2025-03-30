import { URL } from 'node:url';
import newrelic from "newrelic";
import fs from 'node:fs/promises';
import { Composer, InputFile, InlineKeyboard, InlineQueryResultBuilder } from "grammy";
import type { Context } from "#root/bot/context.js";
import { logHandle } from "#root/bot/helpers/logging.js";
import { extractYoutubeVideoId, fetchYoutubeVideoMetadata, fetchYoutubeVideoUrl } from "../helpers/youtube.js";
import axios from 'axios';
import { addReplyParam } from "@roziscoding/grammy-autoquote";
import { getVkVideoInfo, downloadVideo } from "../helpers/yt-dlp.js";
import downloadFile from '../helpers/download-file.js';
import { config } from '#root/config.js';
import { randomUUID } from 'node:crypto';
import { toError } from '../utils/error-prettier.js';


// --- Placeholder constants (customize these as needed) ---
const PH_LOADING_VIDEO_URL = "https://magicxor.github.io/static/ytdl-inline-bot/loading_v2.mp4";
const PH_THUMBNAIL_URL = "https://magicxor.github.io/static/ytdl-inline-bot/loading_v1.jpg";
const PH_VIDEO_WIDTH = 1024;
const PH_VIDEO_HEIGHT = 576;
const PH_VIDEO_DURATION = 10;


const COBALT_API_URL = config.COBALT_API_URL;
const COBALT_PROXY_API_URL = config.COBALT_PROXIED_API_URL;

const composer = new Composer<Context>();
const feature = composer;

// Test Urls
// Youtube:
// https://youtube.com/shorts/TRutZetDUak?si=ze_mNABRzaD7LFKk
// https://www.youtube.com/watch?v=TRutZetDUak
// https://youtu.be/TRutZetDUak

// Instagram:
// https://www.instagram.com/reel/C8z8kMENNa6/?igsh=MXhzODk5b2VieW9zcA==
// https://www.instagram.com/share/reel/_smACWpcD
// https://www.instagram.com/share/_smACWpcD
// Difficult instagram videos
// https://www.instagram.com/reel/DFU0c-hsXc_/?igsh=cG5mYjJwZ2Via2Yy

// Twitter:
// https://x.com/Catshealdeprsn/status/1824921646181847112
// https://twitter.com/Catshealdeprsn/status/1824921646181847112

type SupportedVideoService = 'yt' | 'ig' | 'tw' | 'vk' | 'other';


function isSupportedVideoUrl(url: string): { supported: boolean; service?: SupportedVideoService } {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");

    // Define supported hostnames
    const supportedServices = {
      "youtube.com": "yt",
      "youtu.be": "yt",
      "instagram.com": "ig",
      "twitter.com": "tw",
      "x.com": "tw",
      "vk.com": "vk"
    } as const;

    const service = supportedServices[hostname as keyof typeof supportedServices];
    
    return {
      supported: !!service,
      service: service || 'other'
    };
  } catch (error) {
    return { supported: false };
  }
}

// Helper function to resolve shorthand Instagram URLs
async function resolveInstagramShorthandUrl(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { maxRedirects: 0, validateStatus: null });
    if (response.status === 301 || response.status === 302) {
      return response.headers.location || null;
    }
    return null;
  } catch (error) {
    console.error('Error resolving shorthand Instagram URL:', error);
    newrelic.noticeError(toError(error), { url });
    return null;
  }
}

async function processVideoUrl(url: string, ctx: Context, isVideoRequired: boolean = true): 
Promise<{success: boolean, videoFileUrl?: string, videoFilePath?: string, service?: SupportedVideoService, isProxified?: boolean}> {
  let parsedUrl;
  let service: SupportedVideoService = 'other';
  let isProxified = false;
  try {
    ctx.logger.debug(`Processing URL: ${url}`);
    
    // Detect and resolve shorthand Instagram URLs by checking inclusion
    if (url.includes("instagram.com/share/reel/") || url.includes("instagram.com/share/")) {
      // Ensure URL ends with a slash
      const urlToResolve = url.endsWith('/') ? url : `${url}/`;
      const resolvedUrl = await resolveInstagramShorthandUrl(urlToResolve);
      if (resolvedUrl) {
        ctx.logger.debug(`Resolved shorthand Instagram URL to: ${resolvedUrl}`);
        url = resolvedUrl;
      } else {
        ctx.logger.error(`Failed to resolve shorthand Instagram URL: ${url}`);
        return { success: false };
      }
    }

    parsedUrl = new URL(url);
  } catch (error) {
    ctx.logger.error(`Error parsing URL: ${error}`);
    console.log(error);
    newrelic.noticeError(toError(error), { url });
    return { success: false };
  }
  const hostname = parsedUrl.hostname.replace(/^www\./, ""); // Remove 'www.' prefix if present

  ctx.logger.debug(`Hostname: "${hostname}"`);

  let videoFileUrl;
  let videoFilePath;

  if (hostname === "instagram.com") {
    if (ctx.chat?.id) {
      ctx.replyWithChatAction("upload_video");
    }
    // Try first without proxy, then with proxy if needed
    if (isVideoRequired){
      // First attempt without proxy
      const directResult = await fetchInstagramVideoUrl(url, false);
      if (directResult.success) {
        videoFileUrl = directResult.url;
        service = 'ig';
      } else {
        // If direct attempt fails, try with proxy
        ctx.logger.debug(`Direct Instagram download failed, trying with proxy`);
        const proxyResult = await fetchInstagramVideoUrl(url, true);
        if (proxyResult.success) {
          videoFileUrl = proxyResult.url;
          service = 'ig'; // Mark as downloaded with proxy
          isProxified = true;
        }
      }
    }
    if (!videoFileUrl && !service.includes('ig')) {
      service = 'ig'; // Default to 'ig' for service type if both methods fail
    }
  }

  if (hostname === "youtube.com" || hostname === "youtu.be") {
    // For youtube, we should firstly check duration of a video
    // And downlaod video only if it smaller than 90 seconds
    const videoId = extractYoutubeVideoId(url);
    if (!videoId) {
      ctx.logger.error({
        msg: "Failed to extract video ID from URL",
        text: url,
      });
      return { success: false };
    }

    const videoMetadata = await fetchYoutubeVideoMetadata(videoId);
    if (videoMetadata.secondsDuration > 90) {
      ctx.logger.info({
        msg: "Video duration is too long",
        duration: videoMetadata.secondsDuration,
      });
      return { success: false };
    }
    if (ctx.chat?.id) {
      ctx.replyWithChatAction("upload_video");
    }
    if (isVideoRequired){
      // Try without proxy first
      const cobaltToolsResult = await fetchYoutubeVideoUrl(url, false);
      videoFileUrl = cobaltToolsResult.url;
      
      // If first attempt fails, try with proxy
      if (!videoFileUrl) {
        ctx.logger.debug(`Direct YouTube download failed, trying with proxy`);
        const proxyResult = await fetchYoutubeVideoUrl(url, true);
        videoFileUrl = proxyResult.url;
      }
  
      if (!videoFileUrl) {
        // We need to use a fallback local yt-dlp download
        ctx.logger.debug(`Using yt-dlp to download video`);
        try {
          videoFilePath = await downloadVideo(url);
        } catch (error) {
          ctx.logger.error(`Error downloading video with yt-dlp:`);
          newrelic.noticeError(toError(error), { url, ctx: JSON.stringify(ctx) });
          console.log(error);
          throw error;
        }
      }
  
      if (!videoFilePath && !videoFileUrl) {
        ctx.logger.error({
          msg: `Failed to download YT video`,
          url: url,
        });
        newrelic.noticeError(new Error("Total yt download error"), { url, ctx: JSON.stringify(ctx) });
        return { success: false };
      }
    }

    service = 'yt';
  }

  // Twitter parsing
  if (hostname == "twitter.com" || hostname == "x.com") {
    // Try without proxy first, then with proxy if needed
    let result = await fetchTwitterVideoUrl(url, false);
    
    // If direct attempt fails, try with proxy
    if (!result.success) {
      ctx.logger.debug(`Direct Twitter download failed, trying with proxy`);
      result = await fetchTwitterVideoUrl(url, true);
    }
    
    ctx.logger.debug(`Twitter result: ${JSON.stringify(result)}`);
    videoFileUrl = result.url;
    if (ctx.chat?.id) {
      ctx.replyWithChatAction("upload_video");
    }
    service = 'tw';
  }

  if (hostname == "vk.com") {
    // Imagine that this url is a valid VK video
    const infoResult = await getVkVideoInfo(url);
    if (infoResult.duration > 240) {
      ctx.logger.info({
        msg: "Video duration is too long",
        duration: infoResult.duration,
      });
      return { success: false };
    }
    if (ctx.chat?.id) {
      ctx.replyWithChatAction("upload_video");
    }

    const downloadedVideoPath = await downloadVideo(url);
    videoFilePath = downloadedVideoPath;
    service = 'vk';
  }

  if (!videoFileUrl && !videoFilePath && isVideoRequired) {
    ctx.logger.error({
      msg: `Failed to download video`,
      url: url,
    });
    newrelic.noticeError(new Error("Total video download error"), { url, ctx: JSON.stringify(ctx) });
    return { success: false };
  }

  return { success: true, videoFileUrl, videoFilePath, service, isProxified };
}

feature.on(
  "message:entities:url",
  logHandle("message-entities-url"),
  async (ctx, next) => {
    ctx.api.config.use(addReplyParam(ctx));

    const urls = ctx.entities("url");

    ctx.logger.debug(`Found URLs: ${JSON.stringify(urls)}`);

    // We need to scan if any of the URLs are from desired video platforms
    // We should target to:
    // Twitter
    // Instagram
    // Youtube

    for (const url of urls) {
      const { supported, service } = isSupportedVideoUrl(url.text);
      
      if (!supported) {
        ctx.logger.debug(`URL ${url.text} is not supported by video downloader`);
        continue;
      }

      try {
        const { success, videoFileUrl, videoFilePath, service: resultService } = await processVideoUrl(url.text, ctx);

        if (!success) {
          continue;
        }
        // After processing urls and videos, we should look if we found some video file
        ctx.interactedWithUser = true;
        ctx.triggeredFeatures.push("download-video");

        if (videoFileUrl) {
          newrelic.incrementMetric("features/download-video/requests", 1);
          try {
            await ctx.replyWithVideo(videoFileUrl, {});
          } catch (error) {
            ctx.logger.error({ msg: "Error sending video", error });
            await ctx.replyWithVideo(new InputFile(new URL(videoFileUrl)));
            newrelic.incrementMetric("features/download-video/responses", 1);
          }
        }
        if (videoFilePath) {
          newrelic.incrementMetric("features/download-video/requests", 1);
          await ctx.replyWithVideo(new InputFile(videoFilePath));
          await fs.unlink(videoFilePath);
          newrelic.incrementMetric("features/download-video/responses", 1);
        }
      } catch (error) {
        ctx.logger.error({ msg: "Error processing message", error });
        newrelic.noticeError(toError(error), { ctx: JSON.stringify(ctx) });
        newrelic.incrementMetric("features/download-video/errors", 1);
      } finally {
        return await next();
      }
    }
  }
);

// Function to fetch video URL or download video using Cobalt API with optional proxy
async function fetchTwitterVideoUrl(twitterUrl: string, useProxy: boolean = false) {
  const apiUrl = useProxy ? COBALT_PROXY_API_URL : COBALT_API_URL;
  try {
    const response = await axios.post(apiUrl, {
      url: twitterUrl
    }, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    console.log(`Twitter response (${useProxy ? 'proxy' : 'direct'}): ${JSON.stringify(response.data)}`);

    if (['success', 'redirect', 'tunnel'].includes(response.data.status) && response.data.url && !response.data.url.includes('.jpg') && !response.data.url.includes('.png')) {
      return { success: true, url: response.data.url };
    } else {
      return { success: false, message: response.data };
    }
  } catch (error) {
    console.error(`Error calling Cobalt API (${useProxy ? 'proxy' : 'direct'}):`, error);
    return { success: false, message: 'Error calling Cobalt API' };
  }
}

// Function to fetch video URL or download video using Cobalt API with optional proxy
async function fetchInstagramVideoUrl(instagramUrl: string, useProxy: boolean = false) {
  const apiUrl = useProxy ? COBALT_PROXY_API_URL : COBALT_API_URL;
  try {
    const response = await axios.post(apiUrl, {
      url: instagramUrl
    }, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (['success', 'redirect', 'tunnel'].includes(response.data.status) && response.data.url) {
      return { success: true, url: response.data.url };
    } else {
      console.log(`Cobalt API (${useProxy ? 'proxy' : 'direct'}) did not return a video URL:`, response.data);
      return { success: false, message: response.data };
    }
  } catch (error) {
    console.error(`Error calling Cobalt API (${useProxy ? 'proxy' : 'direct'}):`, error);
    return { success: false, message: error };
  }
}


composer.inlineQuery(/(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/, async (ctx, next) => {
  const match = ctx.match; // regex match object
  const query = ctx.inlineQuery.query; // query string
  ctx.logger.debug(`Inline query: ${query}`);
  ctx.logger.debug(`Match: ${match}`);
  if (!match) {
    return;
  }
  try {
    const sourceUrl = match[0];
    const { success, videoFileUrl, videoFilePath, service } = await processVideoUrl(sourceUrl, ctx, false);

    if (!success) {
      return;
    }

    return ctx.answerInlineQuery([
      InlineQueryResultBuilder.videoMp4(
        `download-video-${randomUUID()}`,
        "Downloading video, click to send...",
        PH_LOADING_VIDEO_URL,
        PH_THUMBNAIL_URL,
        {
          caption: `Downloading video ${sourceUrl}. Please wait.`,
          parse_mode: "HTML",
          video_width: PH_VIDEO_WIDTH,
          video_height: PH_VIDEO_HEIGHT,
          video_duration: PH_VIDEO_DURATION,
          reply_markup: new InlineKeyboard()
            .text("Downloading...", "dweqwei902e09129e0")
        },
      )
    ], {
      cache_time: 1,
    })
  } catch (error) {
    ctx.logger.error(`Error processing inline query: ${error}`);
  } finally {
    newrelic.incrementMetric("features/download-video/inline-requests", 1);
    return next();
  }
})


composer.chosenInlineResult(/download-video-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}/i, async (ctx: Context) => {
  const chosen = ctx.chosenInlineResult;
  ctx.logger.debug(`Received inline chosen result: ${JSON.stringify(chosen)}`)
  if (!chosen || !chosen.inline_message_id) return;
  const inlineMessageId = chosen.inline_message_id;
  const sourceUrl = chosen.query;
  ctx.logger.debug(`Chosen inline result for URL: ${sourceUrl} with inline_message_id: ${inlineMessageId}`);
  // Start asynchronous download and replacement
  downloadVideoAndReplace(sourceUrl, inlineMessageId, ctx).catch(err => {
    ctx.logger.error(`Error in downloadVideoAndReplace: ${err}`);
  });

  newrelic.incrementMetric("features/download-video/inline-chosen-video", 1);
});

async function downloadVideoAndReplace(sourceUrl: string, inlineMessageId: string, ctx: Context): Promise<void> {
  try {
    ctx.logger.debug(`Starting download and replacement for URL: ${sourceUrl}`);
    const { success, videoFileUrl, videoFilePath, service, isProxified } = await processVideoUrl(sourceUrl, ctx, true);
    if (!success) {
      ctx.logger.error(`Failed to process video URL: ${sourceUrl}`);
      await ctx.api.editMessageTextInline(inlineMessageId, "Failed to get video url. Sorry :(")
      return;
    }

    if (videoFileUrl) {
      try {
        const urlResult = await ctx.api.editMessageMediaInline(inlineMessageId, {
          type: 'video', 
          media: videoFileUrl,
          caption: `<a href="${sourceUrl}">Source</a> | Service: ${service + (isProxified ? ' (proxified)' : '')}`,
          parse_mode: "HTML",
        })
        ctx.logger.debug(`Update result via url: ${JSON.stringify(urlResult)}`);
        if (urlResult === true){
          return;
        }
      } catch (ex) {
        ctx.logger.debug('URL download failed, fallback to usual download')
      }
    }

    // Ensure we have a local file (download if necessary)
    let localFilePath = videoFilePath;
    if (!localFilePath) {
      ctx.logger.debug(`Downloading video file locally for URL: ${videoFileUrl}`);
      if (!videoFileUrl){
        newrelic.noticeError(new Error("Failed to get video url"), {ctx: JSON.stringify(ctx)});
        await ctx.api.editMessageTextInline(inlineMessageId, `Failed to get video url. Sorry, please watch in your browser: ${sourceUrl}`);
        return;
      }
      localFilePath = await downloadFile(videoFileUrl);
    }

    // Upload the video to the media storage chat to get a Telegram file_id
    ctx.logger.debug(`Uploading video from ${localFilePath} to media storage chat ${config.MEDIA_STORAGE_GROUP_ID}`);
    const sentMsg = await ctx.api.sendVideo(config.MEDIA_STORAGE_GROUP_ID, new InputFile(localFilePath));
    if (!sentMsg.video || !sentMsg.video.file_id) {
      ctx.logger.error("Failed to obtain file_id from uploaded video.");
      newrelic.noticeError(new Error("Failed to obtain file_id from uploaded video."), {ctx: JSON.stringify(ctx)});
      await ctx.api.editMessageTextInline(inlineMessageId, `Failed to upload video. Sorry, please watch in your browser: ${sourceUrl}`, {});
      return;
    }
    // Replace the placeholder inline message with the actual video
    ctx.logger.debug(`Editing inline message ${inlineMessageId} with file_id ${sentMsg.video.file_id}`);
    await ctx.api.editMessageMediaInline(
      inlineMessageId,
      {
        type: "video",
        media: sentMsg.video.file_id,
        caption: `<a href="${sourceUrl}">Source</a> | Service: ${service + (isProxified ? ' (proxified)' : '')}`,
        parse_mode: "HTML",
        width: sentMsg.video.width,
        height: sentMsg.video.height,
        duration: sentMsg.video.duration,
        supports_streaming: true,
      },
      {}
    );
    // Optionally, remove the local file after uploading
    try {
      await fs.unlink(localFilePath);
      ctx.logger.debug(`Deleted local file: ${localFilePath}`);
    } catch (unlinkErr) {
      ctx.logger.error(`Error deleting local file: ${unlinkErr}`);
    }
    newrelic.incrementMetric("features/download-video/inline-update-success", 1);
  } catch (error) {
    newrelic.incrementMetric("features/download-video/inline-update-error", 1);
    newrelic.noticeError(toError(error), {ctx: JSON.stringify(ctx)});
    ctx.logger.error(`Error in downloadVideoAndReplace: ${error}`);
    try {
      await ctx.api.editMessageTextInline(inlineMessageId, "An error occurred while processing the video.", {});
    } catch (editErr) {
      ctx.logger.error(`Failed to update inline message with error info: ${editErr}`);
    }
  }
}

export { composer as downloadVideoFeature };