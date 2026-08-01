import axios from "axios";

const DDG_BASE_URL = "https://duckduckgo.com";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// DuckDuckGo has no public image API. The JSON endpoint only answers requests that
// carry a per-query `vqd` token, which is only available in the HTML of the search page
const VQD_PATTERN = /vqd=["']?([\d-]+)["']?/;

export class DdgImagesError extends Error {}

export interface DdgImage {
  url: string;
  thumbnail: string;
  title: string;
  width: number;
  height: number;
}

interface DdgImagesResponse {
  results?: Array<{
    image?: string;
    thumbnail?: string;
    title?: string;
    width?: number;
    height?: number;
  }>;
}

export interface DdgImagesOptions {
  safe?: boolean;
  locale?: string;
  timeoutMs?: number;
}

async function fetchVqd(query: string, timeoutMs: number): Promise<string> {
  const response = await axios.get<string>(`${DDG_BASE_URL}/`, {
    params: { q: query },
    timeout: timeoutMs,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    },
  });

  const vqd = VQD_PATTERN.exec(response.data)?.[1];
  if (!vqd) {
    throw new DdgImagesError(`duckduckgo did not return a vqd token for "${query}"`);
  }
  return vqd;
}

export async function searchDdgImages(query: string, options: DdgImagesOptions = {}): Promise<DdgImage[]> {
  const { safe = false, locale = "ru-ru", timeoutMs = 10_000 } = options;
  const vqd = await fetchVqd(query, timeoutMs);

  const response = await axios.get<DdgImagesResponse>(`${DDG_BASE_URL}/i.js`, {
    params: {
      l: locale,
      o: "json",
      q: query,
      vqd,
      f: ",,,,,",
      p: safe ? "1" : "-1",
    },
    timeout: timeoutMs,
    // Without the XHR and Sec-Fetch headers below the endpoint replies 403,
    // even with a valid vqd token — it only serves same-origin in-page requests
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      Referer: `${DDG_BASE_URL}/`,
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    },
  });

  return (response.data?.results ?? [])
    .filter((result): result is Required<NonNullable<DdgImagesResponse["results"]>[number]> => Boolean(result.image))
    .map((result) => ({
      url: result.image,
      thumbnail: result.thumbnail,
      title: result.title,
      width: result.width,
      height: result.height,
    }));
}
