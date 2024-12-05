import YTDlpWrap from 'yt-dlp-wrap';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '#root/config.js';

const ytDlpPath = config.YTDLP_PATH;

const tmpDir = path.join(os.tmpdir(), 'yt-dlp-temp');

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

interface VideoInfo {
  duration: number;
  downloadUrl: string;
  title: string;
}

export async function getVkVideoInfo(url: string): Promise<VideoInfo> {
  const ytDlp = new YTDlpWrap.default(ytDlpPath);

  const info = await ytDlp.getVideoInfo(url);

  const bestFormat = info.formats
    .filter((format: any) => format.ext === "mp4")
    .sort((a: any, b: any) => b.height - a.height)[0];

  return {
    duration: info.duration,
    title: info.fulltitle,
    downloadUrl: bestFormat.url,
  }
}

export async function downloadVideo(url: string, timeout: number = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const ytDlp = new YTDlpWrap.default(ytDlpPath);

    const filePath = path.join(tmpDir, `${Date.now()}-${Math.round(Math.random()*1000)}.mp4`); 

    let controller = new AbortController();
  
    let ytDlpEventEmitter = ytDlp
      .exec([
          url,
          '-f',
          'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]',
          '-o',
          filePath,
      ],
      {shell: false, detached: false},
      controller.signal
      )
      .on('progress', (progress) =>
          console.log(
              progress.percent,
              progress.totalSize,
              progress.currentSpeed,
              progress.eta
          )
      )
      .on('ytDlpEvent', (eventType, eventData) =>
          console.log(eventType, eventData)
      )
      .on('error', (error) => reject(error))
      .on('close', () => resolve(filePath));

      setTimeout(() => {
        controller.abort();
        reject(new Error('YT-DLP download timeout'));
      }, timeout);
  })
}