import { Composer, InputFile } from "grammy";
import { Context } from "#root/bot/context.js";
import { logHandle } from "#root/bot/helpers/logging.js";
import fs from "node:fs";
import path from "node:path";
import download from "download";
import prettyFrameRate from "#root/libs/prettyFrameRate.js";
import ffprobe from "ffprobe";
import ffmpeg from "fluent-ffmpeg";
import os from 'node:os';
import { config } from "#root/config.js";
import chooseValidPath from "#root/bot/utils/choose-valid-path.js";

const ffmpegPath = chooseValidPath(["/usr/bin/ffmpeg", config.FFMPEG_PATH]);
const ffprobePath = chooseValidPath(["/usr/bin/ffprobe", config.FFPROBE_PATH]);

console.log("pathToFfmpeg:", ffmpegPath);

if (typeof ffmpegPath === "string" && ffmpegPath !== null) {
  ffmpeg.setFfmpegPath(ffmpegPath);
} else {
  throw new Error("FFmpeg path is not set.");
}

function makeid() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < 5; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}



const composer = new Composer<Context>();

// test url : https://storage.googleapis.com/downloads.webmproject.org/media/video/webmproject.org/big_buck_bunny_trailer_480p_logo.webm
const handleWebm = async (ctx: Context, next: () => Promise<void>) => {
  if (!ctx.message) {
    return await next();
  }

  const startDownload = Date.now();

  if (!ctx?.videoConverterState?.url) {
    if (!ctx.message?.document?.file_id) {
      return await next();
    }
    const file = await ctx.api.getFile(ctx.message.document.file_id);
    const fileLink = await file.getUrl();
    console.log("fileLink:", fileLink);
    ctx.videoConverterState = { url: fileLink };
  }

  if (!ctx.videoConverterState.url) {
    return await next();
  }

  const tempDir = os.tmpdir();
  const fileFolder = path.join(tempDir, "downloads_webm");
  const fileName = ctx.message.document
    ? makeid() + ctx.message.document.file_name
    : `${makeid()}.webm`;
  const filePath = path.join(fileFolder, fileName);

  console.log("filePath", filePath);
  await download(ctx.videoConverterState.url, fileFolder, {
    filename: fileName,
  });

  const endDownload = Date.now();

  console.log("downloaded file path:", filePath);
  const probe = await ffprobe(filePath, { path: ffprobePath || "" });

  const selectedVideoStream = probe.streams
    .filter((x) => x.codec_type === "video")
    .sort((a, b) => {
      if (a.tags?.DURATION && b.tags?.DURATION && a.tags.DURATION > b.tags.DURATION) {
        return 1;
      }
      if (a.tags?.DURATION && b.tags?.DURATION && a.tags.DURATION < b.tags.DURATION) {
        return -1;
      }
      return 0;
    })
    .pop();

  console.log("selectedVideoStream;", selectedVideoStream);

  if (!selectedVideoStream) {
    console.log("No selectedVideoStream");
    return await next();
  }

  const maxWidth = 1280;
  const maxFPS = 60;
  const maxFramesCount = 36000;

  const calculatedFps =
    selectedVideoStream.avg_frame_rate && 
    parseFloat(prettyFrameRate(selectedVideoStream.avg_frame_rate || "", { suffix: "" }) || "0") <= maxFPS
      ? parseFloat(selectedVideoStream.avg_frame_rate)
      : maxFPS;

  const startTime = Date.now();

  await ffmpeg()
    .input(filePath)
    .format("mp4")
    .size(
      `${
        selectedVideoStream.width && selectedVideoStream.width <= maxWidth
          ? selectedVideoStream.width
          : maxWidth
      }x?`
    )
    .outputOptions([
      "-preset veryfast",
      "-pix_fmt yuv420p",
      "-max_muxing_queue_size 999999",
      "-movflags +faststart",
      "-crf 23",
      "-c:v libx264",
    ])
    .fps(calculatedFps)
    .frames(maxFramesCount)
    .on("end", () => {
      console.log("file has been converted successfully");

      ctx
        .replyWithVideo(
          new InputFile(fs.createReadStream(`${filePath}.mp4`)),
          {
            caption: `Render time: ${Date.now() - startTime}ms. Download time: ${endDownload - startDownload}ms`,
            reply_to_message_id: ctx.message?.message_id,
          }
        )
        .finally(() => {
          fs.unlink(filePath, () => {});
          fs.unlink(`${filePath}.mp4`, () => {});
        });
    })
    .on("error", (err) => {
      console.log(`an error happened: ${err.message}`);
    })
    .save(`${filePath}.mp4`);
};

// This listener should hear for urls in messages and process them after
// Example url: https://storage.googleapis.com/downloads.webmproject.org/media/video/webmproject.org/big_buck_bunny_trailer_480p_logo.webm
composer.on("message:entities:url", logHandle("webm-url"),
  async (ctx, next) => {
    if (ctx.message && ctx.message.entities && ctx.message.text) {
      for (const entity of ctx.message.entities.filter((x: any) => x.type === "url")) {
        const url = ctx.message.text.substring(
          entity.offset,
          entity.length + entity.offset
        );

        console.log("url:", url);

        if (url.endsWith(".webm")) {
          ctx.videoConverterState = { url };
          return await next();
        }
      }
    }
    return await next();
  },
  handleWebm
);

composer.on(
  "message:document",
  async (ctx, next) => {
    if (!ctx.message) {
      return await next();
    }
    
    if (ctx.message.document && ctx.message.document.mime_type === "video/webm") {
      return await next();
    }
  },
  handleWebm
);

export { composer as videoConventerFeature };