import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createLoadVidApiClient,
  LoadVidApiAuthError,
  LoadVidApiError,
  LoadVidApiJobFailedError,
  LoadVidApiTimeoutError,
  LoadVidApiUnsupportedUrlError,
} from "./loadvidapi.js";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const testTmpDir = path.join(os.tmpdir(), `loadvidapi-test-${process.pid}`);

after(async () => {
  await fs.rm(testTmpDir, { recursive: true, force: true });
});

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface MockServer {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

function startMockServer(
  handler: (req: RecordedRequest, res: http.ServerResponse) => void,
): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body,
      };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function makeClient(baseUrl: string, overrides: Record<string, unknown> = {}) {
  return createLoadVidApiClient({
    baseUrl,
    token: "test-token",
    logger: silentLogger,
    requestTimeoutMs: 1000,
    pollIntervalMs: 10,
    jobTimeoutMs: 1000,
    tmpDirPath: testTmpDir,
    ...overrides,
  });
}

describe("createJob", () => {
  test("creates a job and returns jobId", async () => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 201, { jobId: "job-1", status: "PENDING" });
    });
    try {
      const client = makeClient(server.url);
      const job = await client.createJob("https://www.instagram.com/reel/abc/");

      assert.equal(job.jobId, "job-1");
      assert.equal(job.status, "PENDING");
      assert.equal(server.requests.length, 1);
      const request = server.requests[0];
      assert.equal(request.method, "POST");
      assert.equal(request.url, "/jobs");
      assert.equal(request.headers.authorization, "Bearer test-token");
      assert.match(request.headers["content-type"] ?? "", /application\/json/);
      assert.deepEqual(JSON.parse(request.body), {
        videoUrl: "https://www.instagram.com/reel/abc/",
      });
    } finally {
      await server.close();
    }
  });

  test("throws LoadVidApiUnsupportedUrlError on 400 without retrying", async () => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 400, { error: "Unsupported URL" });
    });
    try {
      const client = makeClient(server.url);
      await assert.rejects(
        client.createJob("https://example.com/not-a-video"),
        LoadVidApiUnsupportedUrlError,
      );
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  });

  test("throws LoadVidApiAuthError on 401", async () => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 401, { error: "Unauthorized" });
    });
    try {
      const client = makeClient(server.url);
      await assert.rejects(
        client.createJob("https://www.instagram.com/reel/abc/"),
        LoadVidApiAuthError,
      );
    } finally {
      await server.close();
    }
  });
});

describe("waitForResult", () => {
  test("polls until COMPLETED and returns the job with resultUrl", async () => {
    const statuses = ["PENDING", "ACTIVE", "COMPLETED"];
    let pollCount = 0;
    const server = await startMockServer((req, res) => {
      const status = statuses[Math.min(pollCount, statuses.length - 1)];
      pollCount += 1;
      sendJson(res, 200, {
        jobId: "job-2",
        status,
        resultUrl: status === "COMPLETED" ? "https://cdn.example.com/v.mp4" : null,
        detectedService: "instagram",
      });
    });
    try {
      const client = makeClient(server.url);
      const job = await client.waitForResult("job-2");

      assert.equal(job.status, "COMPLETED");
      assert.equal(job.resultUrl, "https://cdn.example.com/v.mp4");
      assert.equal(pollCount, 3);
      for (const request of server.requests) {
        assert.equal(request.method, "GET");
        assert.equal(request.url, "/jobs/job-2");
        assert.equal(request.headers.authorization, "Bearer test-token");
      }
    } finally {
      await server.close();
    }
  });

  test("throws LoadVidApiJobFailedError with lastError on FAILED", async () => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 200, {
        jobId: "job-3",
        status: "FAILED",
        lastError: "All providers exhausted",
      });
    });
    try {
      const client = makeClient(server.url);
      await assert.rejects(client.waitForResult("job-3"), (error: unknown) => {
        assert.ok(error instanceof LoadVidApiJobFailedError);
        assert.match(error.message, /All providers exhausted/);
        return true;
      });
    } finally {
      await server.close();
    }
  });

  test("times out after jobTimeoutMs and does not cancel the job", async () => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 200, { jobId: "job-4", status: "PENDING" });
    });
    try {
      const client = makeClient(server.url, { jobTimeoutMs: 100, pollIntervalMs: 20 });
      await assert.rejects(client.waitForResult("job-4"), LoadVidApiTimeoutError);
      // The API has no cancellation endpoint — only GET polling is expected
      assert.ok(server.requests.length >= 1);
      for (const request of server.requests) {
        assert.equal(request.method, "GET");
      }
    } finally {
      await server.close();
    }
  });

  test("throws LoadVidApiAuthError on 401 during polling", async () => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 401, { error: "Unauthorized" });
    });
    try {
      const client = makeClient(server.url);
      await assert.rejects(client.waitForResult("job-5"), LoadVidApiAuthError);
    } finally {
      await server.close();
    }
  });
});

describe("download", () => {
  test("streams the file to a local path without the API auth header", async () => {
    const videoBytes = "FAKE_MP4_BYTES";
    const server = await startMockServer((req, res) => {
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(videoBytes);
    });
    try {
      const client = makeClient(server.url);
      const filePath = await client.download(`${server.url}/files/v.mp4`);

      const content = await fs.readFile(filePath, "utf8");
      assert.equal(content, videoBytes);
      // resultUrl points to an external CDN, the API token must not leak there
      assert.equal(server.requests[0].headers.authorization, undefined);
      await fs.unlink(filePath);
    } finally {
      await server.close();
    }
  });

  test("throws LoadVidApiError on non-2xx download response", async () => {
    const server = await startMockServer((req, res) => {
      sendJson(res, 404, { error: "Gone" });
    });
    try {
      const client = makeClient(server.url);
      await assert.rejects(client.download(`${server.url}/files/v.mp4`), LoadVidApiError);
    } finally {
      await server.close();
    }
  });
});

describe("resolveAndDownload", () => {
  test("happy path: create job, poll to COMPLETED, download the file", async () => {
    const videoBytes = "REAL_VIDEO_CONTENT";
    let pollCount = 0;
    const server = await startMockServer((req, res) => {
      if (req.method === "POST" && req.url === "/jobs") {
        sendJson(res, 201, { jobId: "job-6", status: "PENDING" });
        return;
      }
      if (req.method === "GET" && req.url === "/jobs/job-6") {
        pollCount += 1;
        if (pollCount < 2) {
          sendJson(res, 200, { jobId: "job-6", status: "ACTIVE" });
        } else {
          sendJson(res, 200, {
            jobId: "job-6",
            status: "COMPLETED",
            resultUrl: `http://${req.headers.host}/files/result.mp4`,
            detectedService: "twitter",
          });
        }
        return;
      }
      if (req.method === "GET" && req.url === "/files/result.mp4") {
        res.writeHead(200, { "Content-Type": "video/mp4" });
        res.end(videoBytes);
        return;
      }
      sendJson(res, 404, { error: "Not found" });
    });
    try {
      const client = makeClient(server.url);
      const { job, filePath } = await client.resolveAndDownload(
        "https://x.com/user/status/123",
      );

      assert.equal(job.jobId, "job-6");
      assert.equal(job.detectedService, "twitter");
      const content = await fs.readFile(filePath, "utf8");
      assert.equal(content, videoBytes);
      await fs.unlink(filePath);
    } finally {
      await server.close();
    }
  });
});
