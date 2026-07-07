import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

export type LoadVidApiJobStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "FAILED";

export interface LoadVidApiJob {
  jobId: string;
  status: LoadVidApiJobStatus;
  resultUrl?: string | null;
  lastError?: string | null;
  detectedService?: string | null;
}

type LogInput = string | Record<string, unknown>;

export interface LoadVidApiLogger {
  debug: (msg: LogInput) => void;
  info: (msg: LogInput) => void;
  warn: (msg: LogInput) => void;
  error: (msg: LogInput) => void;
}

export class LoadVidApiError extends Error {}

// 400 on job creation: the service does not support this URL, retrying is pointless
export class LoadVidApiUnsupportedUrlError extends LoadVidApiError {}

// 401: the configured LOADVIDAPI_TOKEN is invalid
export class LoadVidApiAuthError extends LoadVidApiError {}

export class LoadVidApiJobFailedError extends LoadVidApiError {
  public readonly job: LoadVidApiJob;

  constructor(job: LoadVidApiJob) {
    super(`loadvidapi job ${job.jobId} failed: ${job.lastError ?? "unknown reason"}`);
    this.job = job;
  }
}

// The job did not reach a final status in time. The API has no cancellation,
// so the server-side job is simply abandoned — that is expected
export class LoadVidApiTimeoutError extends LoadVidApiError {
  public readonly jobId: string;

  constructor(jobId: string, timeoutMs: number) {
    super(`loadvidapi job ${jobId} did not finish within ${timeoutMs}ms`);
    this.jobId = jobId;
  }
}

export interface LoadVidApiClientOptions {
  baseUrl: string;
  token: string;
  logger?: LoadVidApiLogger;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  jobTimeoutMs?: number;
  downloadTimeoutMs?: number;
  tmpDirPath?: string;
}

export function createLoadVidApiClient(options: LoadVidApiClientOptions) {
  const {
    baseUrl,
    token,
    logger = console,
    requestTimeoutMs = 10_000,
    pollIntervalMs = 2_500,
    jobTimeoutMs = 120_000,
    downloadTimeoutMs = 120_000,
    tmpDirPath = path.join(os.tmpdir(), "loadvidapi-temp"),
  } = options;

  const api = axios.create({
    baseURL: baseUrl,
    timeout: requestTimeoutMs,
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: null,
  });

  function throwIfUnauthorized(status: number, context: string): void {
    if (status === 401) {
      logger.error({ msg: `loadvidapi rejected the configured token (401) during ${context}, check LOADVIDAPI_TOKEN` });
      throw new LoadVidApiAuthError(`loadvidapi returned 401 during ${context}`);
    }
  }

  async function createJob(videoUrl: string): Promise<LoadVidApiJob> {
    const response = await api.post("/jobs", { videoUrl });
    throwIfUnauthorized(response.status, "job creation");
    if (response.status === 400) {
      throw new LoadVidApiUnsupportedUrlError(`loadvidapi does not support this URL: ${videoUrl}`);
    }
    if (response.status !== 201) {
      throw new LoadVidApiError(`loadvidapi job creation failed with HTTP ${response.status}`);
    }
    const job = response.data as LoadVidApiJob;
    logger.info({ msg: "loadvidapi job created", jobId: job.jobId, videoUrl });
    return job;
  }

  async function waitForResult(jobId: string): Promise<LoadVidApiJob> {
    const deadline = Date.now() + jobTimeoutMs;
    for (;;) {
      let job: LoadVidApiJob | undefined;
      try {
        const response = await api.get(`/jobs/${jobId}`);
        throwIfUnauthorized(response.status, "status polling");
        if (response.status === 200) {
          job = response.data as LoadVidApiJob;
        } else {
          logger.warn({ msg: "loadvidapi polling returned unexpected HTTP status", jobId, status: response.status });
        }
      } catch (error) {
        if (error instanceof LoadVidApiError) {
          throw error;
        }
        // Transient network errors should not kill the job before the deadline
        logger.warn({ msg: "loadvidapi polling request failed", jobId, error: String(error) });
      }

      if (job?.status === "COMPLETED") {
        logger.info({ msg: "loadvidapi job completed", jobId, detectedService: job.detectedService });
        return job;
      }
      if (job?.status === "FAILED") {
        logger.info({ msg: "loadvidapi job failed", jobId, lastError: job.lastError });
        throw new LoadVidApiJobFailedError(job);
      }

      if (Date.now() + pollIntervalMs > deadline) {
        logger.info({ msg: "loadvidapi job timed out on the client side", jobId });
        throw new LoadVidApiTimeoutError(jobId, jobTimeoutMs);
      }
      await sleep(pollIntervalMs);
    }
  }

  // resultUrl is an external direct link, so no Authorization header here
  async function download(resultUrl: string): Promise<string> {
    await fsPromises.mkdir(tmpDirPath, { recursive: true });
    const filePath = path.join(tmpDirPath, `${Date.now()}-${uuidv4()}.mp4`);

    const response = await axios.get(resultUrl, {
      responseType: "stream",
      timeout: requestTimeoutMs,
      validateStatus: null,
    });
    if (response.status < 200 || response.status >= 300) {
      response.data.destroy();
      throw new LoadVidApiError(`loadvidapi result file download failed with HTTP ${response.status}`);
    }

    try {
      await pipeline(response.data, fs.createWriteStream(filePath), {
        signal: AbortSignal.timeout(downloadTimeoutMs),
      });
    } catch (error) {
      await fsPromises.unlink(filePath).catch(() => {});
      throw error;
    }
    return filePath;
  }

  // Result links can be short-lived, so the file is downloaded
  // immediately after the job completes — never store resultUrl for later
  async function resolveAndDownload(videoUrl: string): Promise<{ job: LoadVidApiJob; filePath: string }> {
    const created = await createJob(videoUrl);
    const job = await waitForResult(created.jobId);
    if (!job.resultUrl) {
      throw new LoadVidApiError(`loadvidapi job ${job.jobId} completed without resultUrl`);
    }
    const filePath = await download(job.resultUrl);
    return { job, filePath };
  }

  return { createJob, waitForResult, download, resolveAndDownload };
}

export type LoadVidApiClient = ReturnType<typeof createLoadVidApiClient>;
