import { clampNumber, firecrawlScrapeMarkdown } from "@/lib/firecrawl";
export const dynamic = "force-dynamic";

type Role = "system" | "user" | "assistant";
type ToolCall = { name: "firecrawl_scrape"; arguments: { url: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function extractFirstContent(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const choices = data.choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;

  const message = first.message;
  if (isRecord(message) && typeof message.content === "string") return message.content;

  const delta = first.delta;
  if (isRecord(delta) && typeof delta.content === "string") return delta.content;

  return null;
}

function unwrapJsonCandidate(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseFirecrawlToolCallFromContent(content: string): ToolCall | null {
  const candidate = unwrapJsonCandidate(content);
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  const jsonText = candidate.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.type !== "tool_call") return null;

  const name = parsed.name;
  if (name !== "firecrawl_scrape" && name !== "firecrawl.scrape") return null;

  if (!isRecord(parsed.arguments)) return null;
  const url = parsed.arguments.url;
  if (typeof url !== "string" || !url.trim()) return null;

  return { name: "firecrawl_scrape", arguments: { url: url.trim() } };
}

function injectToolInstructions(messages: Array<{ role: Role; content: string }>) {
  const toolHelp =
    "Tooling available:\n" +
    "- firecrawl_scrape(url): Fetches a public web page and returns main-content markdown.\n\n" +
    "If you need to read a page to answer, respond with exactly one line of JSON and nothing else:\n" +
    '{"type":"tool_call","name":"firecrawl_scrape","arguments":{"url":"https://example.com"}}\n\n' +
    "After you receive the tool result, answer normally.";

  if (messages.length && messages[0]?.role === "system") {
    messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${toolHelp}` };
    return;
  }

  messages.unshift({ role: "system", content: toolHelp });
}

async function callXai(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  messages: Array<{ role: Role; content: string }>;
  extraBody?: Record<string, unknown>;
}) {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature,
      ...(options.extraBody ?? {}),
    }),
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return json(
      { ok: false, error: "Missing XAI_API_KEY. Set it in pat/.env.local." },
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

  const model = typeof body.model === "string" ? body.model : "grok-3";
  const temperature = typeof body.temperature === "number" ? body.temperature : 0.3;
  const messages = Array.isArray(body.messages) ? body.messages : null;
  const tools = isRecord(body.tools) ? body.tools : null;
  const firecrawlToolEnabled = tools ? tools.firecrawl === true : false;

  if (!messages) {
    return json({ ok: false, error: "`messages` must be an array." }, { status: 400 });
  }

  const wireMessages = messages
    .map((m: unknown) => {
      if (!isRecord(m)) return null;
      const role = m.role as Role | undefined;
      const content = m.content;
      if (
        (role !== "system" && role !== "user" && role !== "assistant") ||
        typeof content !== "string" ||
        !content.trim()
      ) {
        return null;
      }
      return { role, content };
    })
    .filter(Boolean);

  if (!wireMessages.length) {
    return json({ ok: false, error: "No valid messages provided." }, { status: 400 });
  }

  const baseUrl = process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1";

  const preparedMessages = wireMessages.slice() as Array<{ role: Role; content: string }>;
  if (firecrawlToolEnabled) {
    injectToolInstructions(preparedMessages);
  }

  const upstream = await callXai({
    apiKey,
    baseUrl,
    model,
    temperature,
    messages: preparedMessages,
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    return json(
      {
        ok: false,
        error: `xAI error (${upstream.status}). ${text || "No response body."}`,
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as unknown;
  const content = extractFirstContent(data);

  if (typeof content !== "string" || !content.trim()) {
    return json(
      { ok: false, error: "Unexpected xAI response format (missing content)." },
      { status: 502 },
    );
  }

  if (firecrawlToolEnabled) {
    const toolCall = parseFirecrawlToolCallFromContent(content);
    if (toolCall) {
      const firecrawlKey = process.env.FIRECRAWL_API_KEY;
      if (!firecrawlKey) {
        return json(
          { ok: false, error: "Missing FIRECRAWL_API_KEY. Set it in pat/.env.local." },
          { status: 500 },
        );
      }

      const base = process.env.FIRECRAWL_BASE_URL?.trim() || undefined;
      const maxCharsEnv = Number(process.env.FIRECRAWL_MAX_CHARS ?? "20000");
      const maxChars = clampNumber(
        Number.isNaN(maxCharsEnv) ? 20000 : maxCharsEnv,
        1000,
        200000,
      );

      let scraped: { url: string; markdown: string };
      try {
        scraped = await firecrawlScrapeMarkdown({
          apiKey: firecrawlKey,
          url: toolCall.arguments.url,
          baseUrl: base,
          onlyMainContent: true,
          maxChars,
        });
      } catch (e) {
        return json(
          { ok: false, error: e instanceof Error ? e.message : "Scrape failed." },
          { status: 502 },
        );
      }

      const toolResultSystem = {
        role: "system" as const,
        content: `Tool result (firecrawl_scrape)\nURL: ${scraped.url}\n\n${scraped.markdown}`,
      };

      const followUpMessages = [
        ...preparedMessages,
        { role: "assistant" as const, content },
        toolResultSystem,
      ];

      const upstream2 = await callXai({
        apiKey,
        baseUrl,
        model,
        temperature,
        messages: followUpMessages,
      });

      if (!upstream2.ok) {
        const text = await upstream2.text().catch(() => "");
        return json(
          { ok: false, error: `xAI error (${upstream2.status}). ${text || "No response body."}` },
          { status: 502 },
        );
      }

      const data2 = (await upstream2.json()) as unknown;
      const content2 = extractFirstContent(data2);
      if (typeof content2 !== "string" || !content2.trim()) {
        return json(
          { ok: false, error: "Unexpected xAI response format (missing content)." },
          { status: 502 },
        );
      }

      return json({ ok: true, message: { role: "assistant", content: content2 } });
    }
  }

  return json({ ok: true, message: { role: "assistant", content } });
}
