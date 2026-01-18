import { clampNumber, firecrawlScrapeMarkdown } from "@/lib/firecrawl";
export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(req: Request) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return json(
      { ok: false, error: "Missing FIRECRAWL_API_KEY. Set it in pat/.env.local." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const urlRaw = body.url;
  if (typeof urlRaw !== "string" || !urlRaw.trim()) {
    return json({ ok: false, error: "`url` must be a string." }, { status: 400 });
  }

  const maxCharsEnv = Number(process.env.FIRECRAWL_MAX_CHARS ?? "20000");
  const maxChars = clampNumber(maxCharsEnv, 1000, 200000);
  const baseUrl = process.env.FIRECRAWL_BASE_URL?.trim() || undefined;

  try {
    const result = await firecrawlScrapeMarkdown({
      apiKey,
      url: urlRaw,
      baseUrl,
      onlyMainContent: true,
      maxChars,
    });
    return json({ ok: true, url: result.url, markdown: result.markdown });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Scrape failed." }, { status: 502 });
  }
}
