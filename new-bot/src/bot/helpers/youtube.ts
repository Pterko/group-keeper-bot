import { config } from "#root/config.js";
import axios from 'axios';

export async function fetchYoutubeVideoMetadata(videoId: string): Promise<{
  secondsDuration: number,
}> {
  const apiKey = config.YT_API_KEY; // Replace with your API key
  const url = `https://youtube.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoId}&key=${apiKey}`;

  try {
    const response = await axios.get(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.data.items && response.data.items.length > 0) {
      const duration = response.data.items[0].contentDetails.duration;
      const match = duration.match(/PT(\d+M)?(\d+S)?/);
      const minutes = match[1] ? parseInt(match[1].replace('M', '')) : 0;
      const seconds = match[2] ? parseInt(match[2].replace('S', '')) : 0;
      return {
        secondsDuration: minutes * 60 + seconds
      };
    } else {
      throw new Error('Video not found');
    }
  } catch (error) {
    console.error('Error fetching video duration:', error);
    throw error;
  }
}

export function extractYoutubeVideoId(url: string): string | null {
  const shortUrlPattern = /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/;
  const longUrlPattern = /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/;

  const shortUrlMatch = url.match(shortUrlPattern);
  if (shortUrlMatch && shortUrlMatch[1]) {
    return shortUrlMatch[1];
  }

  const longUrlMatch = url.match(longUrlPattern);
  if (longUrlMatch && longUrlMatch[1]) {
    return longUrlMatch[1];
  }

  return null;
}

export async function fetchYoutubeVideoUrl(youtubeUrl: string) {
  const cobaltEndpoint = 'https://api.cobalt.tools/api/json';
  try {
    const response = await axios.post(cobaltEndpoint, { url: youtubeUrl }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    if (['success', 'redirect', 'stream'].includes(response.data.status) && response.data.url) {
      return { success: true, url: response.data.url };
    } else {
      console.log('Cobalt API did not return a video URL:', response.data);
      return { success: false, message: 'Failed to get video URL from Cobalt API' };
    }
  } catch (error) {
    console.error('Error calling Cobalt API:', error);
    return { success: false, message: 'Error calling Cobalt API' };
  }
}