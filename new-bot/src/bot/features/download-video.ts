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



const COBALT_API_URL = 'https://cobalt-api.kwiatekmiki.com/api/json';

const composer = new Composer<Context>();
const feature = composer;

// Test Urls
// Youtube:
// https://youtube.com/shorts/TRutZetDUak?si=ze_mNABRzaD7LFKk
// https://www.youtube.com/watch?v=TRutZetDUak
// https://youtu.be/TRutZetDUak

// Instagram:
// https://www.instagram.com/reel/C8z8kMENNa6/?igsh=MXhzODk5b2VieW9zcA==

// Twitter:
// https://x.com/Catshealdeprsn/status/1824921646181847112
// https://twitter.com/Catshealdeprsn/status/1824921646181847112

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
      try {
        let parsedUrl;
        try {
          parsedUrl = new URL(url.text);
        } catch (error) {
          ctx.logger.error("Error parsing URL:", error);
          continue;
        }
        const hostname = parsedUrl.hostname.replace(/^www\./, ""); // Remove 'www.' prefix if present

        ctx.logger.debug(`Hostname: "${hostname}"`);

        let videoFileUrl;
        let videoFilePath;

        if (hostname === "instagram.com") {
          ctx.replyWithChatAction("upload_video");
          // Imagine that this url is a valid Instagram video

          const result = await fetchInstagramVideoUrl(url.text);
          videoFileUrl = result.url;
        }

        if (hostname === "youtube.com" || hostname === "youtu.be") {
          // For youtube, we should firstly check duration of a video
          // And downlaod video only if it smaller than 90 seconds
          const videoId = extractYoutubeVideoId(url.text);
          if (!videoId) {
            ctx.logger.error({
              msg: "Failed to extract video ID from URL",
              text: url.text,
            });
            continue;
          }

          const videoMetadata = await fetchYoutubeVideoMetadata(videoId);
          if (videoMetadata.secondsDuration > 90) {
            ctx.logger.info({
              msg: "Video duration is too long",
              duration: videoMetadata.secondsDuration,
            });
            continue;
          }
          ctx.replyWithChatAction("upload_video");

          const cobaltToolsResult = await fetchYoutubeVideoUrl(url.text);
          videoFileUrl = cobaltToolsResult.url;

          if (!videoFileUrl) {
            // We need to use a fallback local yt-dlp download
            const downloadedVideoPath = await downloadVideo(url.text);
            videoFilePath = downloadedVideoPath;
          }

          if (!videoFilePath && !videoFileUrl) {
            ctx.logger.error({
              msg: `Failed to download YT video`,
              url: url.text,
            });
            continue;
          }
        }

        // Twitter parsing
        if (hostname == "twitter.com" || hostname == "x.com") {
          // Imagine that this url is a valid Twitter video

          const result = await fetchTwitterVideoUrl(url.text);
          ctx.logger.debug(`Twitter result: ${JSON.stringify(result)}`);
          videoFileUrl = result.url;
          ctx.replyWithChatAction("upload_video");
        }

        if (hostname == "vk.com") {
          // Imagine that this url is a valid VK video
          const infoResult = await getVkVideoInfo(url.text);
          if (infoResult.duration > 240) {
            ctx.logger.info({
              msg: "Video duration is too long",
              duration: infoResult.duration,
            });
            continue;
          }
          ctx.replyWithChatAction("upload_video");

          const downloadedVideoPath = await downloadVideo(url.text);
          videoFilePath = downloadedVideoPath;
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
async function fetchFallbackInstagramVideoUrl(instagramUrl: string) {
  const fallbackEndpoint = `https://instagram-videos.vercel.app/api/video?postUrl=${encodeURIComponent(instagramUrl)}`;
  try {
    const response = await axios.get(fallbackEndpoint);
    if (response.data.status === 'success' && response.data.data.videoUrl) {
      return { success: true, url: response.data.data.videoUrl };
    } else {
      console.log('Fallback API did not return a video URL:', response.data.message);
      return { success: false, message: 'Failed to get video URL from fallback API' };
    }
  } catch (error) {
    console.error('Error calling Fallback API:', error);
    return { success: false, message: 'Error calling Fallback API' };
  }
}

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

    if (['success', 'redirect'].includes(response.data.status) && response.data.url && !response.data.url.includes('.jpg') && !response.data.url.includes('.png')) {
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

    if (['success', 'redirect'].includes(response.data.status) && response.data.url) {
      return { success: true, url: response.data.url };
    } else {
      console.log('Cobalt API did not return a video URL:', response.data);
      // If Cobalt API fails, try the fallback API
      return await fetchFallbackInstagramVideoUrl(instagramUrl);
    }
  } catch (error) {
    console.error('Error calling Cobalt API:', error);
    // If Cobalt API fails, try the fallback API
    return await fetchFallbackInstagramVideoUrl(instagramUrl);
  }
}


composer.inlineQuery(/instagram.com/, async (ctx) => {
  const match = ctx.match; // regex match object
  const query = ctx.inlineQuery.query; // query string
  ctx.logger.debug(`Inline query: ${query}`);
  ctx.logger.debug(`Match: ${match}`);
  let parsedUrl;
  try {
    parsedUrl = new URL(query);
    const hostname = parsedUrl.hostname.replace(/^www\./, ""); // Remove 'www.' prefix if present
    ctx.logger.debug(`Hostname: "${hostname}"`);
    let videoUrl;
    if (hostname === "instagram.com") {
      const result = await fetchInstagramVideoUrl(query);
      ctx.logger.debug(`Instagram result: ${JSON.stringify(result)}`);
      videoUrl = result.url;
    }

    ctx.answerInlineQuery([InlineQueryResultBuilder.videoMp4("id-1", "Send Instagram Video", videoUrl, "https://img.icons8.com/?size=512&id=eAMGjpJ4skFB&format=png")]);
  } catch (error) {
    ctx.logger.error("Error parsing URL:", error);
  }
});


export { composer as downloadVideoFeature };