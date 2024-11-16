import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

const tmpDir = path.join(os.tmpdir(), 'yt-dlp-temp');

async function ensureTempDir() {
  try {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
    await fsPromises.mkdir(tmpDir, { recursive: true });
  } catch (error) {
    console.error("Error preparing temp directory:", error);
    throw error;
  }
}

interface DownloadOptions {
  timeout?: number;
  fileExtension?: string;
}

async function downloadFile(url: string, options: DownloadOptions = {}): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const { timeout = 120_000, fileExtension = 'mp4' } = options;
  
    const fileName = `${Date.now()}-${uuidv4()}.${fileExtension}`;
    const filePath = path.join(tmpDir, fileName);
  
    try {
      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: timeout,
      });
  
      const writer = fs.createWriteStream(filePath);
  
      response.data.pipe(writer);
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
      setTimeout(() => {
        writer.close();
        reject(new Error(`Download timed out after ${timeout}ms`));
      }, timeout);
    } catch (error) {
      console.error("Error downloading file:", error);
      throw error;
    }
  })

}

export default downloadFile;