import { isIP } from "node:net";

export type FirecrawlScrapeResult = {
  url: string;
  markdown: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;
  if (host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0") return true;

  const ipVersion = isIP(host);
  if (!ipVersion) return false;

  if (ipVersion === 4) {
    const parts = host.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }

  // IPv6
  if (host === "::1") return true;
  if (host.startsWith("fe80:")) return true; // link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique local
  return false;
}

export function parsePublicHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (isPrivateHostname(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function extractFirecrawlMarkdown(data: unknown): string | null {
  if (!isRecord(data)) return null;
  if (typeof data.markdown === "string") return data.markdown;
  if (!isRecord(data.data)) return null;
  return typeof data.data.markdown === "string" ? data.data.markdown : null;
}

export async function firecrawlScrapeMarkdown(options: {
  apiKey: string;
  url: string;
  baseUrl?: string;
  onlyMainContent?: boolean;
  maxChars?: number;
}): Promise<FirecrawlScrapeResult> {
  const parsedUrl = parsePublicHttpUrl(options.url.trim());
  if (!parsedUrl) {
    throw new Error("Invalid URL (must be public http/https).");
  }

  const maxChars = clampNumber(options.maxChars ?? 20000, 1000, 200000);
  const baseUrl = (options.baseUrl?.trim() || "https://api.firecrawl.dev").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/v1/scrape`;

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`,
      "x-api-key": options.apiKey,
    },
    body: JSON.stringify({
      url: parsedUrl.toString(),
      formats: ["markdown"],
      onlyMainContent: options.onlyMainContent ?? true,
    }),
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`Firecrawl error (${upstream.status}). ${text || "No response body."}`);
  }

  const data = (await upstream.json().catch(() => null)) as unknown;
  const markdown = extractFirecrawlMarkdown(data);
  if (!markdown) {
    throw new Error("Unexpected Firecrawl response format (missing markdown).");
  }

  const cleaned = markdown.replace(/\u0000/g, "");
  const clipped = cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}\n\n[clipped]` : cleaned;
  return { url: parsedUrl.toString(), markdown: clipped };
}

