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
  const youtubePattern = /(?:https?:\/\/)?(?:(?:www\.)?youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]+)/;

  const match = url.match(youtubePattern);
  return match ? match[1] : null;
}

export async function fetchYoutubeVideoUrl(youtubeUrl: string) {
  const cobaltEndpoint = 'http://185.232.71.219:18525/';
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