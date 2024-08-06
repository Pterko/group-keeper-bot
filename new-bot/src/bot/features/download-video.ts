import { chatAction } from "@grammyjs/auto-chat-action";
import { Composer, InputFile } from "grammy";
import type { Context } from "#root/bot/context.js";
import { isAdmin } from "#root/bot/filters/index.js";
import { setCommandsHandler } from "#root/bot/handlers/index.js";
import { logHandle } from "#root/bot/helpers/logging.js";
import { extractYoutubeVideoId, fetchYoutubeVideoMetadata, fetchYoutubeVideoUrl } from "../helpers/youtube.js";
import axios from 'axios';
import { addReplyParam } from "@roziscoding/grammy-autoquote";


const composer = new Composer<Context>();
const feature = composer;

// Test Urls
// Youtube:
// https://youtube.com/shorts/TRutZetDUak?si=ze_mNABRzaD7LFKk
// https://www.youtube.com/watch?v=TRutZetDUak

// Instagram:
// https://www.instagram.com/reel/C8z8kMENNa6/?igsh=MXhzODk5b2VieW9zcA==

feature.on("message:entities:url", logHandle("message-entities-url"), async (ctx) => {
  ctx.api.config.use(addReplyParam(ctx));

  const urls = ctx.entities('url');

  ctx.logger.debug('Found URLs:', urls)

  // We need to scan if any of the URLs are from desired video platforms
  // We should target to:
  // Twitter
  // Instagram
  // Youtube

  for (const url of urls){
    let videoFileUrl;
    if (url.text.includes('instagram.com')) {
      // Imagine that this url is a valid Instagram video

      const result = await fetchInstagramVideoUrl(url.text);
      videoFileUrl = result.url;
    }

    if (url.text.includes('youtube.com')) {
      // For youtube, we should firstly check duration of a video
      // And downlaod video only if it smaller than 90 seconds
      const videoId = extractYoutubeVideoId(url.text);
      if (!videoId) {
        ctx.logger.error('Failed to extract video ID from URL:', url.text);
        continue;
      }

      const videoMetadata = await fetchYoutubeVideoMetadata(videoId);
      if (videoMetadata.secondsDuration > 90) {
        ctx.logger.error('Video duration is too long:', videoMetadata.secondsDuration);
        continue;
      }

      const result = await fetchYoutubeVideoUrl(url.text);
      videoFileUrl = result.url;
    }
 

    // After processing urls, we should look if we found some video file
    if (videoFileUrl){
      ctx.chatAction = 'upload_video';
      try {
        await ctx.replyWithVideo(videoFileUrl, {});
      } catch (error) {
        ctx.logger.error('Error sending video:', error);

        await ctx.replyWithVideo(new InputFile(new URL(videoFileUrl)));
      }
    }
  }
});

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

// Function to fetch video URL or download video using Cobalt API
async function fetchInstagramVideoUrl(instagramUrl: string ) {
  const cobaltEndpoint = 'https://co.wuk.sh/api/json';
  try {
    const response = await axios.post(cobaltEndpoint, {
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

export { composer as downloadVideoFeature };