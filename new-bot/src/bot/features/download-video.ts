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


// --- Placeholder constants (customize these as needed) ---
const PH_LOADING_VIDEO_URL = "https://magicxor.github.io/static/ytdl-inline-bot/loading_v2.mp4";
const PH_THUMBNAIL_URL = "https://magicxor.github.io/static/ytdl-inline-bot/loading_v1.jpg";
const PH_VIDEO_WIDTH = 1024;
const PH_VIDEO_HEIGHT = 576;
const PH_VIDEO_DURATION = 10;


const COBALT_API_URL = config.COBALT_API_URL;

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
    return null;
  }
}

async function processVideoUrl(url: string, ctx: Context, isVideoRequired: boolean = true): 
Promise<{success: boolean, videoFileUrl?: string, videoFilePath?: string, service?: 'yt' | 'ig' | 'tw' | 'vk' | 'other'}> {
  let parsedUrl;
  let service: 'yt' | 'ig' | 'tw' | 'vk' | 'other' = 'other';
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
    // Imagine that this url is a valid Instagram video
    if (isVideoRequired){
      const result = await fetchInstagramVideoUrl(url);
      videoFileUrl = result.url;
    }
    service = 'ig';
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
      const cobaltToolsResult = await fetchYoutubeVideoUrl(url);
      videoFileUrl = cobaltToolsResult.url;
  
      if (!videoFileUrl) {
        // We need to use a fallback local yt-dlp download
        ctx.logger.debug(`Using yt-dlp to download video`);
        try {
          videoFilePath = await downloadVideo(url);
        } catch (error) {
          ctx.logger.error(`Error downloading video with yt-dlp:`);
          console.log(error);
          throw error;
        }
      }
  
      if (!videoFilePath && !videoFileUrl) {
        ctx.logger.error({
          msg: `Failed to download YT video`,
          url: url,
        });
        return { success: false };
      }
    }

    service = 'yt';
  }

  // Twitter parsing
  if (hostname == "twitter.com" || hostname == "x.com") {
    // Imagine that this url is a valid Twitter video

    const result = await fetchTwitterVideoUrl(url);
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
    return { success: false };
  }

  return { success: true, videoFileUrl, videoFilePath, service };
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
        const { success, videoFileUrl, videoFilePath } = await processVideoUrl(url.text, ctx);

        if (!success) {
          continue;
        }
        // After processing urls and videos, we should look if we found some video file
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
        newrelic.incrementMetric("features/download-video/errors", 1);
      } finally {
        return await next();
      }
    }
  }
);

// Function to fetch video URL or download video using Fallback API
// async function fetchFallbackInstagramVideoUrl(instagramUrl: string) {
//   const fallbackEndpoint = `https://instagram-videos.vercel.app/api/video?postUrl=${encodeURIComponent(instagramUrl)}`;
//   try {
//     const response = await axios.get(fallbackEndpoint);
//     if (response.data.status === 'success' && response.data.data.videoUrl) {
//       return { success: true, url: response.data.data.videoUrl };
//     } else {
//       console.log('Fallback API did not return a video URL:', response.data.message);
//       return { success: false, message: 'Failed to get video URL from fallback API' };
//     }
//   } catch (error) {
//     console.error('Error calling Fallback API:', error);
//     return { success: false, message: 'Error calling Fallback API' };
//   }
// }

async function fetchTwitterVideoUrl(twitterUrl: string) {
  try {
    const response = await axios.post(COBALT_API_URL, {
      url: twitterUrl
    }, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    console.log(`Twitter response: ${JSON.stringify(response.data)}`);

    if (['success', 'redirect', 'tunnel'].includes(response.data.status) && response.data.url && !response.data.url.includes('.jpg') && !response.data.url.includes('.png')) {
      return { success: true, url: response.data.url };
    } else {
      return { success: false, message: response.data };
    }
  } catch (error) {
    console.error('Error calling Cobalt API:', error);
    return { success: false, message: 'Error calling Cobalt API' };
  }
}

// Function to fetch video URL or download video using Cobalt API
async function fetchInstagramVideoUrl(instagramUrl: string ) {
  try {
    const response = await axios.post(COBALT_API_URL, {
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
      console.log('Cobalt API did not return a video URL:', response.data);
      // If Cobalt API fails, try the fallback API
      return { success: false, message: response.data };
      //return await fetchFallbackInstagramVideoUrl(instagramUrl);
    }
  } catch (error) {
    console.error('Error calling Cobalt API:', error);
    // If Cobalt API fails, try the fallback API
    return { success: false, message: error };
    //return await fetchFallbackInstagramVideoUrl(instagramUrl);
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

    // ctx.logger.debug(`Video file URL: ${videoFileUrl}`);
    // ctx.logger.debug(`Video file path: ${videoFilePath}`);

    // if (videoFileUrl && service != 'yt'){
    //   return ctx.answerInlineQuery([InlineQueryResultBuilder.videoMp4("id-1", "Send Video", videoFileUrl, "https://img.icons8.com/?size=512&id=eAMGjpJ4skFB&format=png", {caption: `<a href="${sourceUrl}">Source</a>`, parse_mode: "HTML", })]);
    // }

    // if (videoFilePath || (service === 'yt' && videoFileUrl)){
    //   if (service === 'yt' && videoFileUrl){
    //     const videoFilePath = await downloadFile(videoFileUrl);
    //     ctx.logger.debug(`Local video file path: ${videoFilePath}`);
    //   }
    //   if (!videoFilePath){
    //     return;
    //   }
    //   const videoSendResult = await ctx.api.sendVideo(config.MEDIA_STORAGE_GROUP_ID, new InputFile(videoFilePath));
    //   ctx.logger.debug(`Video send result: ${JSON.stringify(videoSendResult)}`);
    //   return ctx.answerInlineQuery([InlineQueryResultBuilder.videoMp4("id-1", "Send Video", videoSendResult.video.file_id, "https://img.icons8.com/?size=512&id=eAMGjpJ4skFB&format=png", {caption: `<a href="${sourceUrl}">Original</a>`, parse_mode: "HTML", })]);
    // }

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
    const { success, videoFileUrl, videoFilePath, service } = await processVideoUrl(sourceUrl, ctx, true);
    if (!success) {
      ctx.logger.error(`Failed to process video URL: ${sourceUrl}`);
      await ctx.api.editMessageTextInline(inlineMessageId, "Failed to get video url. Sorry :(")
      return;
    }

    if (videoFileUrl) {
      try{

      
        const urlResult = await ctx.api.editMessageMediaInline(inlineMessageId, {
          type: 'video', 
          media: videoFileUrl,
          caption: `<a href="${sourceUrl}">Source</a> | Service: ${service}`,
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
        await ctx.api.editMessageTextInline(inlineMessageId, "Failed to get video url... Sorry :(");
        return;
      }
      localFilePath = await downloadFile(videoFileUrl);
    }

    // Upload the video to the media storage chat to get a Telegram file_id
    ctx.logger.debug(`Uploading video from ${localFilePath} to media storage chat ${config.MEDIA_STORAGE_GROUP_ID}`);
    const sentMsg = await ctx.api.sendVideo(config.MEDIA_STORAGE_GROUP_ID, new InputFile(localFilePath));
    if (!sentMsg.video || !sentMsg.video.file_id) {
      ctx.logger.error("Failed to obtain file_id from uploaded video.");
      await ctx.api.editMessageTextInline(inlineMessageId, "Failed to upload video.", {});
      return;
    }
    // Replace the placeholder inline message with the actual video
    ctx.logger.debug(`Editing inline message ${inlineMessageId} with file_id ${sentMsg.video.file_id}`);
    await ctx.api.editMessageMediaInline(
      inlineMessageId,
      {
        type: "video",
        media: sentMsg.video.file_id,
        caption: `<a href="${sourceUrl}">Source</a> | Service: ${service}`,
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
    ctx.logger.error(`Error in downloadVideoAndReplace: ${error}`);
    try {
      await ctx.api.editMessageTextInline(inlineMessageId, "An error occurred while processing the video.", {});
    } catch (editErr) {
      ctx.logger.error(`Failed to update inline message with error info: ${editErr}`);
    }
  }
}

export { composer as downloadVideoFeature };