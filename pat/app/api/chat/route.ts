import { clampNumber, firecrawlScrapeMarkdown } from "@/lib/firecrawl";
import { getGitHubTokenFromRequest } from "@/lib/github-auth";
import {
  todoistAddReminder,
  todoistCloseTask,
  todoistCreateTask,
  todoistDeleteReminder,
  todoistDeleteTask,
  todoistListReminders,
  todoistListTasks,
  todoistReopenTask,
  todoistUpdateReminder,
  todoistUpdateTask,
} from "@/lib/todoist";
export const dynamic = "force-dynamic";

type Role = "system" | "user" | "assistant";
type ToolCall =
  | { name: "firecrawl_scrape"; arguments: { url: string } }
  | { name: "github_repos"; arguments: { query?: string } }
  | { name: "github_search"; arguments: { query: string } }
  | { name: "github_read"; arguments: { path: string } }
  | { name: "github_list"; arguments: { path: string } }
  | { name: "todoist_list_tasks"; arguments: { filter?: string; project_id?: string; limit?: number } }
  | {
      name: "todoist_create_task";
      arguments: {
        content: string;
        description?: string;
        due_string?: string;
        due_date?: string;
        due_datetime?: string;
        priority?: number;
        project_id?: string;
        labels?: string[];
      };
    }
  | {
      name: "todoist_update_task";
      arguments: {
        task_id: string;
        content?: string;
        description?: string;
        due_string?: string;
        due_date?: string;
        due_datetime?: string;
        priority?: number;
        labels?: string[];
      };
    }
  | { name: "todoist_close_task"; arguments: { task_id: string } }
  | { name: "todoist_reopen_task"; arguments: { task_id: string } }
  | { name: "todoist_delete_task"; arguments: { task_id: string } }
  | { name: "todoist_list_reminders"; arguments: { task_id?: string; limit?: number } }
  | {
      name: "todoist_add_reminder";
      arguments: {
        task_id: string;
        type?: string;
        due_string?: string;
        due_date?: string;
        due_datetime?: string;
        timezone?: string;
        minute_offset?: number;
        lang?: string;
      };
    }
  | {
      name: "todoist_update_reminder";
      arguments: {
        reminder_id: string;
        type?: string;
        due_string?: string;
        due_date?: string;
        due_datetime?: string;
        timezone?: string;
        minute_offset?: number;
        lang?: string;
      };
    }
  | { name: "todoist_delete_reminder"; arguments: { reminder_id: string } };

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

function parseToolCallFromContent(content: string): ToolCall | null {
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
  if (typeof name !== "string") return null;
  if (!isRecord(parsed.arguments)) return null;
  const args = parsed.arguments;

  if (name === "firecrawl_scrape" || name === "firecrawl.scrape") {
    const url = args.url;
    if (typeof url !== "string" || !url.trim()) return null;
    return { name: "firecrawl_scrape", arguments: { url: url.trim() } };
  }

  if (name === "github_repos" || name === "github.repos") {
    const query = args.query;
    if (typeof query === "string" && query.trim()) {
      return { name: "github_repos", arguments: { query: query.trim() } };
    }
    return { name: "github_repos", arguments: {} };
  }

  if (name === "github_search" || name === "github.search") {
    const query = args.query;
    if (typeof query !== "string" || !query.trim()) return null;
    return { name: "github_search", arguments: { query: query.trim() } };
  }

  if (name === "github_read" || name === "github.read") {
    const path = args.path;
    if (typeof path !== "string" || !path.trim()) return null;
    return { name: "github_read", arguments: { path: path.trim() } };
  }

  if (name === "github_list" || name === "github.list") {
    const path = args.path;
    if (typeof path === "string") return { name: "github_list", arguments: { path: path.trim() } };
    return { name: "github_list", arguments: { path: "" } };
  }

  function readStringArg(...keys: string[]) {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string") return value;
    }
    return undefined;
  }

  function readNumberArg(...keys: string[]) {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "number") return value;
    }
    return undefined;
  }

  function readStringArrayArg(...keys: string[]) {
    for (const key of keys) {
      const value = args[key];
      if (!Array.isArray(value)) continue;
      return value.filter((v) => typeof v === "string");
    }
    return undefined;
  }

  if (name === "todoist_list_tasks" || name === "todoist.list_tasks") {
    const filter = readStringArg("filter")?.trim();
    const project_id = readStringArg("project_id", "projectId")?.trim();
    const limit = readNumberArg("limit");
    return {
      name: "todoist_list_tasks",
      arguments: {
        filter: filter || undefined,
        project_id: project_id || undefined,
        limit: typeof limit === "number" ? limit : undefined,
      },
    };
  }

  if (name === "todoist_create_task" || name === "todoist.create_task") {
    const contentText = readStringArg("content", "text")?.trim();
    if (!contentText) return null;

    const description = readStringArg("description")?.trim();
    const due_string = readStringArg("due_string", "dueString")?.trim();
    const due_date = readStringArg("due_date", "dueDate")?.trim();
    const due_datetime = readStringArg("due_datetime", "dueDatetime")?.trim();
    const priority = readNumberArg("priority");
    const project_id = readStringArg("project_id", "projectId")?.trim();
    const labels = readStringArrayArg("labels");

    return {
      name: "todoist_create_task",
      arguments: {
        content: contentText,
        description: description || undefined,
        due_string: due_string || undefined,
        due_date: due_date || undefined,
        due_datetime: due_datetime || undefined,
        priority: typeof priority === "number" ? priority : undefined,
        project_id: project_id || undefined,
        labels: labels?.length ? labels : undefined,
      },
    };
  }

  if (name === "todoist_update_task" || name === "todoist.update_task") {
    const taskId = readStringArg("task_id", "taskId")?.trim();
    if (!taskId) return null;
    const contentText = readStringArg("content")?.trim();
    const description = readStringArg("description");
    const due_string = readStringArg("due_string", "dueString")?.trim();
    const due_date = readStringArg("due_date", "dueDate")?.trim();
    const due_datetime = readStringArg("due_datetime", "dueDatetime")?.trim();
    const priority = readNumberArg("priority");
    const labels = readStringArrayArg("labels");

    return {
      name: "todoist_update_task",
      arguments: {
        task_id: taskId,
        content: typeof contentText === "string" && contentText ? contentText : undefined,
        description: typeof description === "string" ? description : undefined,
        due_string: due_string || undefined,
        due_date: due_date || undefined,
        due_datetime: due_datetime || undefined,
        priority: typeof priority === "number" ? priority : undefined,
        labels: labels ? labels : undefined,
      },
    };
  }

  if (name === "todoist_close_task" || name === "todoist.close_task") {
    const taskId = readStringArg("task_id", "taskId")?.trim();
    if (!taskId) return null;
    return { name: "todoist_close_task", arguments: { task_id: taskId } };
  }

  if (name === "todoist_reopen_task" || name === "todoist.reopen_task") {
    const taskId = readStringArg("task_id", "taskId")?.trim();
    if (!taskId) return null;
    return { name: "todoist_reopen_task", arguments: { task_id: taskId } };
  }

  if (name === "todoist_delete_task" || name === "todoist.delete_task") {
    const taskId = readStringArg("task_id", "taskId")?.trim();
    if (!taskId) return null;
    return { name: "todoist_delete_task", arguments: { task_id: taskId } };
  }

  if (name === "todoist_list_reminders" || name === "todoist.list_reminders") {
    const taskId = readStringArg("task_id", "taskId")?.trim();
    const limit = readNumberArg("limit");
    return {
      name: "todoist_list_reminders",
      arguments: {
        task_id: taskId || undefined,
        limit: typeof limit === "number" ? limit : undefined,
      },
    };
  }

  if (name === "todoist_add_reminder" || name === "todoist.add_reminder") {
    const taskId = readStringArg("task_id", "taskId")?.trim();
    if (!taskId) return null;
    const type = readStringArg("type")?.trim();
    const due_string = readStringArg("due_string", "dueString")?.trim();
    const due_date = readStringArg("due_date", "dueDate")?.trim();
    const due_datetime = readStringArg("due_datetime", "dueDatetime")?.trim();
    const timezone = readStringArg("timezone")?.trim();
    const minute_offset = readNumberArg("minute_offset", "minuteOffset");
    const lang = readStringArg("lang")?.trim();

    return {
      name: "todoist_add_reminder",
      arguments: {
        task_id: taskId,
        type: type || undefined,
        due_string: due_string || undefined,
        due_date: due_date || undefined,
        due_datetime: due_datetime || undefined,
        timezone: timezone || undefined,
        minute_offset: typeof minute_offset === "number" ? minute_offset : undefined,
        lang: lang || undefined,
      },
    };
  }

  if (name === "todoist_update_reminder" || name === "todoist.update_reminder") {
    const reminderId = readStringArg("reminder_id", "reminderId")?.trim();
    if (!reminderId) return null;
    const type = readStringArg("type")?.trim();
    const due_string = readStringArg("due_string", "dueString")?.trim();
    const due_date = readStringArg("due_date", "dueDate")?.trim();
    const due_datetime = readStringArg("due_datetime", "dueDatetime")?.trim();
    const timezone = readStringArg("timezone")?.trim();
    const minute_offset = readNumberArg("minute_offset", "minuteOffset");
    const lang = readStringArg("lang")?.trim();

    return {
      name: "todoist_update_reminder",
      arguments: {
        reminder_id: reminderId,
        type: type || undefined,
        due_string: due_string || undefined,
        due_date: due_date || undefined,
        due_datetime: due_datetime || undefined,
        timezone: timezone || undefined,
        minute_offset: typeof minute_offset === "number" ? minute_offset : undefined,
        lang: lang || undefined,
      },
    };
  }

  if (name === "todoist_delete_reminder" || name === "todoist.delete_reminder") {
    const reminderId = readStringArg("reminder_id", "reminderId")?.trim();
    if (!reminderId) return null;
    return { name: "todoist_delete_reminder", arguments: { reminder_id: reminderId } };
  }

  return null;
}

function injectToolInstructions(
  messages: Array<{ role: Role; content: string }>,
  opts: {
    firecrawl: boolean;
    github: boolean;
    todoist: boolean;
    githubRepo?: { owner: string; repo: string; ref: string };
  },
) {
  const lines: string[] = ["Tooling available:"];
  if (opts.firecrawl) {
    lines.push("- firecrawl_scrape(url): Fetches a public web page and returns main-content markdown.");
  }
  if (opts.github && opts.githubRepo) {
    const ref = opts.githubRepo.ref ? `@${opts.githubRepo.ref}` : "";
    lines.push("- github_repos(query?): Lists repos you can access for the connected GitHub account.");
    lines.push(
      `- github_search(query): Code search in ${opts.githubRepo.owner}/${opts.githubRepo.repo}${ref}.`,
    );
    lines.push(
      `- github_list(path): Lists files/folders in ${opts.githubRepo.owner}/${opts.githubRepo.repo}${ref} at repo-relative path (use "" for root).`,
    );
    lines.push(
      `- github_read(path): Reads a file from ${opts.githubRepo.owner}/${opts.githubRepo.repo}${ref} by repo-relative path.`,
    );
  } else if (opts.github) {
    lines.push("- github_repos(query?): Lists repos you can access for the connected GitHub account.");
  }
  if (opts.todoist) {
    lines.push("- todoist_list_tasks(filter?, project_id?, limit?): Lists your active Todoist tasks.");
    lines.push("- todoist_create_task(content, due_string?, ...): Creates a Todoist task.");
    lines.push("- todoist_update_task(task_id, ...): Updates a Todoist task.");
    lines.push("- todoist_close_task(task_id): Completes a Todoist task.");
    lines.push("- todoist_list_reminders(task_id?, limit?): Lists Todoist reminders (Sync API).");
    lines.push("- todoist_add_reminder(task_id, due_string|due_datetime|due_date, ...): Adds a reminder.");
  }

  const examples: string[] = [];
  if (opts.firecrawl) {
    examples.push('{"type":"tool_call","name":"firecrawl_scrape","arguments":{"url":"https://example.com"}}');
  }
  if (opts.github) {
    examples.push('{"type":"tool_call","name":"github_repos","arguments":{}}');
    examples.push('{"type":"tool_call","name":"github_search","arguments":{"query":"auth middleware"}}');
    examples.push('{"type":"tool_call","name":"github_list","arguments":{"path":""}}');
    examples.push('{"type":"tool_call","name":"github_read","arguments":{"path":"src/app.ts"}}');
  }
  if (opts.todoist) {
    examples.push('{"type":"tool_call","name":"todoist_list_tasks","arguments":{"filter":"today","limit":10}}');
    examples.push('{"type":"tool_call","name":"todoist_create_task","arguments":{"content":"Pay rent","due_string":"tomorrow 9am"}}');
    examples.push('{"type":"tool_call","name":"todoist_add_reminder","arguments":{"task_id":"123","due_string":"tomorrow 8:30am","timezone":"America/New_York"}}');
  }

  const toolHelp =
    `${lines.join("\n")}\n\n` +
    "If you need a tool, respond with exactly one line of JSON and nothing else:\n" +
    `${examples.join("\n")}\n\n` +
    "After you receive the tool result, answer normally.";

  if (messages.length && messages[0]?.role === "system") {
    messages[0] = { ...messages[0], content: `${messages[0].content}\n\n${toolHelp}` };
    return;
  }

  messages.unshift({ role: "system", content: toolHelp });
}

async function githubSearch(options: {
  token: string;
  owner: string;
  repo: string;
  query: string;
}) {
  const q = `${options.query} repo:${options.owner}/${options.repo}`;
  const url = new URL("https://api.github.com/search/code");
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", "10");

  const upstream = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "Pat",
    },
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`GitHub error (${upstream.status}). ${text}`);
  }

  const data = (await upstream.json().catch(() => null)) as unknown;
  if (!isRecord(data) || !Array.isArray(data.items)) throw new Error("Unexpected GitHub response.");

  const results: Array<{ path: string; htmlUrl: string }> = [];
  for (const item of data.items) {
    if (!isRecord(item)) continue;
    if (typeof item.path !== "string") continue;
    const htmlUrl = typeof item.html_url === "string" ? item.html_url : "";
    results.push({ path: item.path, htmlUrl });
  }
  return results;
}

async function githubRead(options: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  maxChars: number;
}) {
  const encodedPath = options.path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const url = new URL(
    `https://api.github.com/repos/${options.owner}/${options.repo}/contents/${encodedPath}`,
  );
  if (options.ref) url.searchParams.set("ref", options.ref);

  const upstream = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "Pat",
    },
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`GitHub error (${upstream.status}). ${text}`);
  }

  const data = (await upstream.json().catch(() => null)) as unknown;
  if (!isRecord(data)) throw new Error("Unexpected GitHub response.");
  if (data.type !== "file") throw new Error("Path is not a file.");
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error("Unsupported file encoding.");
  }

  const text = Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8");
  if (text.length > options.maxChars) {
    throw new Error(`File too large to attach (${text.length} chars).`);
  }
  return text;
}

async function githubRepos(options: {
  token: string;
  query?: string;
  maxItems: number;
}) {
  const perPage = 100;
  const items: Array<{
    id: number;
    owner: string;
    name: string;
    fullName: string;
    private: boolean;
    defaultBranch: string;
  }> = [];

  for (let page = 1; page <= 5; page += 1) {
    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("visibility", "all");

    const upstream = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${options.token}`,
        accept: "application/vnd.github+json",
        "user-agent": "Pat",
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`GitHub error (${upstream.status}). ${text}`);
    }

    const data = (await upstream.json().catch(() => null)) as unknown;
    if (!Array.isArray(data)) break;

    for (const entry of data) {
      if (!isRecord(entry)) continue;
      if (typeof entry.id !== "number") continue;
      if (typeof entry.name !== "string") continue;
      if (typeof entry.full_name !== "string") continue;
      if (typeof entry.private !== "boolean") continue;
      if (typeof entry.default_branch !== "string") continue;
      if (!isRecord(entry.owner) || typeof entry.owner.login !== "string") continue;

      items.push({
        id: entry.id,
        owner: entry.owner.login,
        name: entry.name,
        fullName: entry.full_name,
        private: entry.private,
        defaultBranch: entry.default_branch,
      });

      if (items.length >= options.maxItems) break;
    }

    if (items.length >= options.maxItems) break;
    if (data.length < perPage) break;
  }

  const query = options.query?.trim().toLowerCase();
  const filtered = query
    ? items.filter((r) => r.fullName.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
    : items;

  return filtered.slice(0, options.maxItems);
}

async function githubList(options: {
  token: string;
  owner: string;
  repo: string;
  path: string;
  ref?: string;
  maxItems: number;
}) {
  const cleanPath = options.path.replace(/^\/+/, "");
  const encodedPath = cleanPath
    ? cleanPath
        .split("/")
        .filter(Boolean)
        .map((p) => encodeURIComponent(p))
        .join("/")
    : "";

  const url = new URL(
    `https://api.github.com/repos/${options.owner}/${options.repo}/contents${encodedPath ? `/${encodedPath}` : ""}`,
  );
  if (options.ref) url.searchParams.set("ref", options.ref);

  const upstream = await fetch(url.toString(), {
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "Pat",
    },
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    throw new Error(`GitHub error (${upstream.status}). ${text}`);
  }

  const data = (await upstream.json().catch(() => null)) as unknown;
  if (!data) throw new Error("Unexpected GitHub response.");

  type Item = { type: "file" | "dir" | "symlink" | "submodule" | "unknown"; path: string; size: number | null };

  const items: Item[] = [];

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (!isRecord(entry)) continue;
      const type = typeof entry.type === "string" ? entry.type : "unknown";
      const path = typeof entry.path === "string" ? entry.path : "";
      const size = typeof entry.size === "number" ? entry.size : null;
      if (!path) continue;
      items.push({
        type:
          type === "file" || type === "dir" || type === "symlink" || type === "submodule"
            ? type
            : "unknown",
        path,
        size,
      });
    }
  } else if (isRecord(data)) {
    const type = typeof data.type === "string" ? data.type : "unknown";
    const path = typeof data.path === "string" ? data.path : cleanPath;
    const size = typeof data.size === "number" ? data.size : null;
    if (!path) throw new Error("Unexpected GitHub response.");
    items.push({
      type:
        type === "file" || type === "dir" || type === "symlink" || type === "submodule"
          ? type
          : "unknown",
      path,
      size,
    });
  } else {
    throw new Error("Unexpected GitHub response.");
  }

  const limited = items.slice(0, options.maxItems);
  return { items: limited, total: items.length };
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
  const githubToolEnabled = tools ? tools.github === true : false;
  const todoistToken = tools && typeof tools.todoistToken === "string" ? tools.todoistToken.trim() : "";
  const todoistToolEnabled = Boolean(todoistToken);
  const githubRepoRaw = tools ? tools.githubRepo : null;
  const githubRepo =
    githubToolEnabled &&
    isRecord(githubRepoRaw) &&
    typeof githubRepoRaw.owner === "string" &&
    typeof githubRepoRaw.repo === "string"
      ? {
          owner: githubRepoRaw.owner,
          repo: githubRepoRaw.repo,
          ref: typeof githubRepoRaw.ref === "string" ? githubRepoRaw.ref : "",
        }
      : null;

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
  if (firecrawlToolEnabled || githubToolEnabled || todoistToolEnabled) {
    injectToolInstructions(preparedMessages, {
      firecrawl: firecrawlToolEnabled,
      github: githubToolEnabled,
      todoist: todoistToolEnabled,
      githubRepo: githubRepo ?? undefined,
    });
  }

  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  function formatTodoistDue(due: { date?: string; datetime?: string; string?: string; timezone?: string | null } | null) {
    if (!due) return "";
    const when = due.datetime || due.date || due.string || "";
    const tz = typeof due.timezone === "string" && due.timezone.trim() ? ` ${due.timezone.trim()}` : "";
    return when ? `${when}${tz}` : "";
  }

  async function runToolCall(toolCall: ToolCall): Promise<string> {
    if (toolCall.name === "firecrawl_scrape") {
      if (!firecrawlToolEnabled) throw new HttpError(400, "Firecrawl tool is disabled.");
      const firecrawlKey = process.env.FIRECRAWL_API_KEY;
      if (!firecrawlKey) throw new HttpError(500, "Missing FIRECRAWL_API_KEY. Set it in pat/.env.local.");

      const base = process.env.FIRECRAWL_BASE_URL?.trim() || undefined;
      const maxCharsEnv = Number(process.env.FIRECRAWL_MAX_CHARS ?? "20000");
      const maxChars = clampNumber(
        Number.isNaN(maxCharsEnv) ? 20000 : maxCharsEnv,
        1000,
        200000,
      );

      const scraped = await firecrawlScrapeMarkdown({
        apiKey: firecrawlKey,
        url: toolCall.arguments.url,
        baseUrl: base,
        onlyMainContent: true,
        maxChars,
      });

      return `Tool result (firecrawl_scrape)\nURL: ${scraped.url}\n\n${scraped.markdown}`;
    }

    if (
      toolCall.name === "github_search" ||
      toolCall.name === "github_read" ||
      toolCall.name === "github_list" ||
      toolCall.name === "github_repos"
    ) {
      if (!githubToolEnabled) throw new HttpError(400, "GitHub tools are disabled.");
      const token = getGitHubTokenFromRequest(req);
      if (!token) throw new HttpError(401, "Not connected to GitHub. Connect in /settings.");

      const maxCharsEnv = Number(process.env.GITHUB_MAX_CHARS ?? "60000");
      const maxChars = clampNumber(
        Number.isNaN(maxCharsEnv) ? 60000 : maxCharsEnv,
        2000,
        200000,
      );
      const maxItemsEnv = Number(process.env.GITHUB_MAX_LIST_ITEMS ?? "200");
      const maxItems = clampNumber(
        Number.isNaN(maxItemsEnv) ? 200 : maxItemsEnv,
        20,
        2000,
      );
      const maxReposEnv = Number(process.env.GITHUB_MAX_REPOS ?? "80");
      const maxRepos = clampNumber(Number.isNaN(maxReposEnv) ? 80 : maxReposEnv, 10, 500);

      if (toolCall.name === "github_repos") {
        const repos = await githubRepos({
          token,
          query: toolCall.arguments.query,
          maxItems: maxRepos,
        });
        return (
          `Tool result (github_repos)\nquery: ${toolCall.arguments.query ?? ""}\n\n` +
          repos
            .map((r) => `- ${r.fullName} (default: ${r.defaultBranch}${r.private ? ", private" : ""})`)
            .join("\n")
        );
      }

      if (!githubRepo) {
        throw new HttpError(400, "GitHub tool requested but no repo selected. Configure it in /settings.");
      }

      if (toolCall.name === "github_search") {
        const results = await githubSearch({
          token,
          owner: githubRepo.owner,
          repo: githubRepo.repo,
          query: toolCall.arguments.query,
        });
        return (
          `Tool result (github_search)\nrepo: ${githubRepo.owner}/${githubRepo.repo}\nquery: ${toolCall.arguments.query}\n\n` +
          results.map((r) => `- ${r.path}${r.htmlUrl ? ` (${r.htmlUrl})` : ""}`).join("\n")
        );
      }

      if (toolCall.name === "github_list") {
        const listing = await githubList({
          token,
          owner: githubRepo.owner,
          repo: githubRepo.repo,
          path: toolCall.arguments.path,
          ref: githubRepo.ref || undefined,
          maxItems,
        });
        const shown = listing.items;
        const labelPath = toolCall.arguments.path?.trim() ? toolCall.arguments.path.trim() : "/";
        return (
          `Tool result (github_list)\nrepo: ${githubRepo.owner}/${githubRepo.repo}\npath: ${labelPath}\n\n` +
          shown
            .map((i) => {
              const kind = i.type === "dir" ? "dir" : i.type === "file" ? "file" : i.type;
              const size = i.size != null && kind === "file" ? ` (${i.size} bytes)` : "";
              return `- [${kind}] ${i.path}${i.type === "dir" ? "/" : ""}${size}`;
            })
            .join("\n") +
          (listing.total > shown.length
            ? `\n\n(truncated: showing ${shown.length} of ${listing.total})`
            : "")
        );
      }

      const fileText = await githubRead({
        token,
        owner: githubRepo.owner,
        repo: githubRepo.repo,
        path: toolCall.arguments.path,
        ref: githubRepo.ref || undefined,
        maxChars,
      });
      return (
        `Tool result (github_read)\nrepo: ${githubRepo.owner}/${githubRepo.repo}\npath: ${toolCall.arguments.path}\n\n` +
        fileText
      );
    }

    if (
      toolCall.name === "todoist_list_tasks" ||
      toolCall.name === "todoist_create_task" ||
      toolCall.name === "todoist_update_task" ||
      toolCall.name === "todoist_close_task" ||
      toolCall.name === "todoist_reopen_task" ||
      toolCall.name === "todoist_delete_task" ||
      toolCall.name === "todoist_list_reminders" ||
      toolCall.name === "todoist_add_reminder" ||
      toolCall.name === "todoist_update_reminder" ||
      toolCall.name === "todoist_delete_reminder"
    ) {
      if (!todoistToolEnabled) throw new HttpError(400, "Todoist tools are disabled.");
      if (!todoistToken) throw new HttpError(401, "Missing Todoist token. Add it in /settings.");

      if (toolCall.name === "todoist_list_tasks") {
        const limitEnv = typeof toolCall.arguments.limit === "number" ? toolCall.arguments.limit : 20;
        const limit = clampNumber(Number.isNaN(limitEnv) ? 20 : limitEnv, 1, 80);
        const tasks = await todoistListTasks({
          token: todoistToken,
          projectId: toolCall.arguments.project_id,
          filter: toolCall.arguments.filter,
          maxItems: limit,
        });

        const header =
          `Tool result (todoist_list_tasks)\nfilter: ${toolCall.arguments.filter ?? ""}\nproject_id: ${toolCall.arguments.project_id ?? ""}\n\n`;
        const lines = tasks.tasks.map((t) => {
          const due = formatTodoistDue(t.due);
          const dueText = due ? ` (due: ${due})` : "";
          const prioText = typeof t.priority === "number" ? ` [p${t.priority}]` : "";
          return `- ${t.id}${prioText}: ${t.content}${dueText}`;
        });
        const trunc = tasks.total > tasks.tasks.length ? `\n\n(truncated: showing ${tasks.tasks.length} of ${tasks.total})` : "";
        return header + (lines.join("\n") || "(no tasks)") + trunc;
      }

      if (toolCall.name === "todoist_create_task") {
        const task = await todoistCreateTask({
          token: todoistToken,
          content: toolCall.arguments.content,
          description: toolCall.arguments.description,
          dueString: toolCall.arguments.due_string,
          dueDate: toolCall.arguments.due_date,
          dueDatetime: toolCall.arguments.due_datetime,
          priority: toolCall.arguments.priority,
          projectId: toolCall.arguments.project_id,
          labels: toolCall.arguments.labels,
        });
        const due = formatTodoistDue(task.due);
        return (
          `Tool result (todoist_create_task)\n` +
          `id: ${task.id}\n` +
          `content: ${task.content}\n` +
          `due: ${due}\n` +
          `url: ${task.url}\n`
        );
      }

      if (toolCall.name === "todoist_update_task") {
        const task = await todoistUpdateTask({
          token: todoistToken,
          taskId: toolCall.arguments.task_id,
          content: toolCall.arguments.content,
          description: toolCall.arguments.description,
          dueString: toolCall.arguments.due_string,
          dueDate: toolCall.arguments.due_date,
          dueDatetime: toolCall.arguments.due_datetime,
          priority: toolCall.arguments.priority,
          labels: toolCall.arguments.labels,
        });
        const due = formatTodoistDue(task.due);
        return (
          `Tool result (todoist_update_task)\n` +
          `id: ${task.id}\n` +
          `content: ${task.content}\n` +
          `due: ${due}\n` +
          `url: ${task.url}\n`
        );
      }

      if (toolCall.name === "todoist_close_task") {
        await todoistCloseTask({ token: todoistToken, taskId: toolCall.arguments.task_id });
        return `Tool result (todoist_close_task)\ntask_id: ${toolCall.arguments.task_id}\nok: true`;
      }

      if (toolCall.name === "todoist_reopen_task") {
        await todoistReopenTask({ token: todoistToken, taskId: toolCall.arguments.task_id });
        return `Tool result (todoist_reopen_task)\ntask_id: ${toolCall.arguments.task_id}\nok: true`;
      }

      if (toolCall.name === "todoist_delete_task") {
        await todoistDeleteTask({ token: todoistToken, taskId: toolCall.arguments.task_id });
        return `Tool result (todoist_delete_task)\ntask_id: ${toolCall.arguments.task_id}\nok: true`;
      }

      if (toolCall.name === "todoist_list_reminders") {
        const limitEnv = typeof toolCall.arguments.limit === "number" ? toolCall.arguments.limit : 20;
        const limit = clampNumber(Number.isNaN(limitEnv) ? 20 : limitEnv, 1, 80);
        const reminders = await todoistListReminders({
          token: todoistToken,
          maxItems: limit,
          taskId: toolCall.arguments.task_id,
        });

        const header =
          `Tool result (todoist_list_reminders)\ntask_id: ${toolCall.arguments.task_id ?? ""}\n\n`;
        const lines = reminders.reminders.map((r) => {
          const due = formatTodoistDue(r.due);
          const dueText = due ? ` (due: ${due})` : "";
          const offsetText = typeof r.minuteOffset === "number" ? ` (minute_offset: ${r.minuteOffset})` : "";
          const typeText = r.type ? ` (${r.type})` : "";
          return `- ${r.id}${typeText}: task_id=${r.taskId}${dueText}${offsetText}`;
        });
        const trunc =
          reminders.total > reminders.reminders.length
            ? `\n\n(truncated: showing ${reminders.reminders.length} of ${reminders.total})`
            : "";
        return header + (lines.join("\n") || "(no reminders)") + trunc;
      }

      if (toolCall.name === "todoist_add_reminder") {
        const result = await todoistAddReminder({
          token: todoistToken,
          taskId: toolCall.arguments.task_id,
          type: toolCall.arguments.type,
          dueString: toolCall.arguments.due_string,
          dueDate: toolCall.arguments.due_date,
          dueDatetime: toolCall.arguments.due_datetime,
          timezone: toolCall.arguments.timezone,
          minuteOffset: toolCall.arguments.minute_offset,
          lang: toolCall.arguments.lang,
        });

        let status: string | null = null;
        if (isRecord(result.raw) && isRecord(result.raw.sync_status)) {
          const st = result.raw.sync_status[result.uuid];
          if (typeof st === "string") status = st;
        }

        return (
          `Tool result (todoist_add_reminder)\n` +
          `task_id: ${toolCall.arguments.task_id}\n` +
          `reminder_id: ${result.reminderId ?? ""}\n` +
          `status: ${status ?? ""}\n`
        );
      }

      if (toolCall.name === "todoist_update_reminder") {
        const result = await todoistUpdateReminder({
          token: todoistToken,
          reminderId: toolCall.arguments.reminder_id,
          type: toolCall.arguments.type,
          dueString: toolCall.arguments.due_string,
          dueDate: toolCall.arguments.due_date,
          dueDatetime: toolCall.arguments.due_datetime,
          timezone: toolCall.arguments.timezone,
          minuteOffset: toolCall.arguments.minute_offset,
          lang: toolCall.arguments.lang,
        });

        let status: string | null = null;
        if (isRecord(result.raw) && isRecord(result.raw.sync_status)) {
          const st = result.raw.sync_status[result.uuid];
          if (typeof st === "string") status = st;
        }

        return (
          `Tool result (todoist_update_reminder)\n` +
          `reminder_id: ${toolCall.arguments.reminder_id}\n` +
          `status: ${status ?? ""}\n`
        );
      }

      const result = await todoistDeleteReminder({
        token: todoistToken,
        reminderId: toolCall.arguments.reminder_id,
      });

      let status: string | null = null;
      if (isRecord(result.raw) && isRecord(result.raw.sync_status)) {
        const st = result.raw.sync_status[result.uuid];
        if (typeof st === "string") status = st;
      }

      return (
        `Tool result (todoist_delete_reminder)\n` +
        `reminder_id: ${toolCall.arguments.reminder_id}\n` +
        `status: ${status ?? ""}\n`
      );
    }

    throw new HttpError(400, "Unknown tool.");
  }

  const maxToolCallsEnv = Number(process.env.PAT_MAX_TOOL_CALLS ?? "4");
  const maxToolCalls = clampNumber(
    Number.isNaN(maxToolCallsEnv) ? 4 : maxToolCallsEnv,
    0,
    10,
  );

  const conversation = preparedMessages.slice() as Array<{ role: Role; content: string }>;
  let toolCallsUsed = 0;
  for (;;) {
    const upstream = await callXai({
      apiKey,
      baseUrl,
      model,
      temperature,
      messages: conversation,
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

    const toolCall = parseToolCallFromContent(content);
    if (!toolCall) {
      return json({ ok: true, message: { role: "assistant", content } });
    }

    toolCallsUsed += 1;
    if (toolCallsUsed > maxToolCalls) {
      return json(
        { ok: false, error: "Too many tool calls requested; aborting." },
        { status: 400 },
      );
    }

    let toolResult: string;
    try {
      toolResult = await runToolCall(toolCall);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Tool failed.";
      const status = e instanceof HttpError ? e.status : 502;
      return json({ ok: false, error: message }, { status });
    }

    conversation.push({ role: "assistant", content });
    conversation.push({ role: "system", content: toolResult });
  }
}
