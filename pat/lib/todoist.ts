import { randomUUID } from "crypto";

type TodoistRequestOptions = {
  token: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

type TodoistSyncOptions = {
  token: string;
  syncToken?: string;
  resourceTypes?: string[];
  commands?: unknown[];
};

export type TodoistDue = {
  date?: string;
  datetime?: string;
  string?: string;
  timezone?: string | null;
  lang?: string | null;
  is_recurring?: boolean;
};

export type TodoistTask = {
  id: string;
  content: string;
  description: string;
  isCompleted: boolean;
  priority: number;
  projectId: string;
  labels: string[];
  due: TodoistDue | null;
  url: string;
};

export type TodoistReminder = {
  id: string;
  taskId: string;
  type: string;
  due: TodoistDue | null;
  minuteOffset: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTodoistBaseUrl() {
  const base = process.env.TODOIST_BASE_URL?.trim() || "https://api.todoist.com/api/v1";
  return base.replace(/\/+$/, "");
}

async function readTodoistErrorMessage(res: Response) {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await res.json().catch(() => null)) as unknown;
    if (isRecord(data) && typeof data.message === "string" && data.message.trim()) {
      return data.message.trim();
    }
    if (typeof data === "string" && data.trim()) return data.trim();
  }

  const text = await res.text().catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > 800 ? `${trimmed.slice(0, 800)}…` : trimmed;
}

async function todoistRequest<T>(options: TodoistRequestOptions): Promise<T | null> {
  const baseUrl = getTodoistBaseUrl();
  const url = new URL(`${baseUrl}${options.path.startsWith("/") ? options.path : `/${options.path}`}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (!value?.trim()) continue;
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${options.token}`,
    accept: "application/json",
    "user-agent": "Pat",
  };

  let body: string | undefined;
  if (options.body != null) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const upstream = await fetch(url.toString(), { method: options.method, headers, body });

  if (!upstream.ok) {
    const message = await readTodoistErrorMessage(upstream);
    throw new Error(`Todoist error (${upstream.status}). ${message || "No response body."}`);
  }

  if (upstream.status === 204) return null;

  const data = (await upstream.json().catch(() => null)) as T | null;
  return data;
}

async function todoistSync<T>(options: TodoistSyncOptions): Promise<T> {
  const baseUrl = getTodoistBaseUrl();
  const url = `${baseUrl}/sync`;

  const body = new URLSearchParams();
  if (options.syncToken != null) body.set("sync_token", options.syncToken);
  if (options.resourceTypes != null) body.set("resource_types", JSON.stringify(options.resourceTypes));
  if (options.commands != null) body.set("commands", JSON.stringify(options.commands));

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Pat",
    },
    body,
  });

  if (!upstream.ok) {
    const message = await readTodoistErrorMessage(upstream);
    throw new Error(`Todoist error (${upstream.status}). ${message || "No response body."}`);
  }

  const data = (await upstream.json().catch(() => null)) as T | null;
  if (!data) throw new Error("Unexpected Todoist response (missing JSON).");
  return data;
}

function parseDue(raw: unknown): TodoistDue | null {
  if (!isRecord(raw)) return null;
  const date = typeof raw.date === "string" ? raw.date : undefined;
  const datetime = typeof raw.datetime === "string" ? raw.datetime : undefined;
  const string = typeof raw.string === "string" ? raw.string : undefined;
  const timezone = typeof raw.timezone === "string" ? raw.timezone : raw.timezone === null ? null : undefined;
  const lang = typeof raw.lang === "string" ? raw.lang : raw.lang === null ? null : undefined;
  const is_recurring = typeof raw.is_recurring === "boolean" ? raw.is_recurring : undefined;
  if (!date && !datetime && !string && timezone === undefined && lang === undefined && is_recurring === undefined) return null;
  return { date, datetime, string, timezone, lang, is_recurring };
}

function parseTask(raw: unknown): TodoistTask | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.content !== "string") return null;
  const id = raw.id;
  const content = raw.content;
  const description = typeof raw.description === "string" ? raw.description : "";
  const isCompleted = typeof raw.is_completed === "boolean" ? raw.is_completed : false;
  const priority = typeof raw.priority === "number" ? raw.priority : 1;
  const projectId = typeof raw.project_id === "string" ? raw.project_id : "";
  const labels = Array.isArray(raw.labels) ? raw.labels.filter((l) => typeof l === "string") : [];
  const due = parseDue(raw.due);
  const url = typeof raw.url === "string" ? raw.url : "";
  return { id, content, description, isCompleted, priority, projectId, labels, due, url };
}

function parseReminder(raw: unknown): TodoistReminder | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.item_id !== "string") return null;
  const id = raw.id;
  const taskId = raw.item_id;
  const type = typeof raw.type === "string" ? raw.type : "";
  const due = parseDue(raw.due);
  const minuteOffset = typeof raw.minute_offset === "number" ? raw.minute_offset : null;
  return { id, taskId, type, due, minuteOffset };
}

export async function todoistListTasks(options: {
  token: string;
  projectId?: string;
  filter?: string;
  maxItems: number;
}) {
  const data = await todoistRequest<unknown>({
    token: options.token,
    method: "GET",
    path: "/tasks",
    query: {
      project_id: options.projectId,
      filter: options.filter,
    },
  });

  if (!Array.isArray(data)) throw new Error("Unexpected Todoist response (tasks).");
  const parsed = data.map(parseTask).filter((t): t is TodoistTask => Boolean(t));
  return { tasks: parsed.slice(0, options.maxItems), total: parsed.length };
}

export async function todoistCreateTask(options: {
  token: string;
  content: string;
  description?: string;
  projectId?: string;
  labels?: string[];
  priority?: number;
  dueString?: string;
  dueDate?: string;
  dueDatetime?: string;
}) {
  const body: Record<string, unknown> = { content: options.content };
  if (options.description) body.description = options.description;
  if (options.projectId) body.project_id = options.projectId;
  if (options.labels?.length) body.labels = options.labels;
  if (typeof options.priority === "number") body.priority = options.priority;
  if (options.dueString) body.due_string = options.dueString;
  if (options.dueDate) body.due_date = options.dueDate;
  if (options.dueDatetime) body.due_datetime = options.dueDatetime;

  const data = await todoistRequest<unknown>({
    token: options.token,
    method: "POST",
    path: "/tasks",
    body,
  });

  const task = parseTask(data);
  if (!task) throw new Error("Unexpected Todoist response (create task).");
  return task;
}

export async function todoistUpdateTask(options: {
  token: string;
  taskId: string;
  content?: string;
  description?: string;
  labels?: string[];
  priority?: number;
  dueString?: string;
  dueDate?: string;
  dueDatetime?: string;
}) {
  const body: Record<string, unknown> = {};
  if (typeof options.content === "string") body.content = options.content;
  if (typeof options.description === "string") body.description = options.description;
  if (options.labels != null) body.labels = options.labels;
  if (typeof options.priority === "number") body.priority = options.priority;
  if (typeof options.dueString === "string") body.due_string = options.dueString;
  if (typeof options.dueDate === "string") body.due_date = options.dueDate;
  if (typeof options.dueDatetime === "string") body.due_datetime = options.dueDatetime;

  const data = await todoistRequest<unknown>({
    token: options.token,
    method: "POST",
    path: `/tasks/${encodeURIComponent(options.taskId)}`,
    body,
  });

  const task = parseTask(data);
  if (!task) throw new Error("Unexpected Todoist response (update task).");
  return task;
}

export async function todoistCloseTask(options: { token: string; taskId: string }) {
  await todoistRequest({
    token: options.token,
    method: "POST",
    path: `/tasks/${encodeURIComponent(options.taskId)}/close`,
  });
}

export async function todoistReopenTask(options: { token: string; taskId: string }) {
  await todoistRequest({
    token: options.token,
    method: "POST",
    path: `/tasks/${encodeURIComponent(options.taskId)}/reopen`,
  });
}

export async function todoistDeleteTask(options: { token: string; taskId: string }) {
  await todoistRequest({
    token: options.token,
    method: "DELETE",
    path: `/tasks/${encodeURIComponent(options.taskId)}`,
  });
}

export async function todoistListReminders(options: { token: string; maxItems: number; taskId?: string }) {
  const data = await todoistSync<unknown>({
    token: options.token,
    syncToken: "*",
    resourceTypes: ["reminders"],
  });

  if (!isRecord(data) || !Array.isArray(data.reminders)) {
    throw new Error("Unexpected Todoist response (reminders).");
  }

  const reminders = data.reminders
    .map(parseReminder)
    .filter((r): r is TodoistReminder => Boolean(r));

  const filtered = options.taskId ? reminders.filter((r) => r.taskId === options.taskId) : reminders;

  return { reminders: filtered.slice(0, options.maxItems), total: filtered.length };
}

export async function todoistAddReminder(options: {
  token: string;
  taskId: string;
  type?: string;
  dueString?: string;
  dueDate?: string;
  dueDatetime?: string;
  timezone?: string;
  minuteOffset?: number;
  lang?: string;
}) {
  const uuid = randomUUID();
  const tempId = randomUUID();
  const args: Record<string, unknown> = { item_id: options.taskId };

  if (typeof options.type === "string" && options.type.trim()) args.type = options.type.trim();
  if (typeof options.minuteOffset === "number") args.minute_offset = options.minuteOffset;

  const due: Record<string, unknown> = {};
  if (typeof options.dueString === "string" && options.dueString.trim()) due.string = options.dueString.trim();
  if (typeof options.dueDate === "string" && options.dueDate.trim()) due.date = options.dueDate.trim();
  if (typeof options.dueDatetime === "string" && options.dueDatetime.trim()) due.datetime = options.dueDatetime.trim();
  if (typeof options.timezone === "string" && options.timezone.trim()) due.timezone = options.timezone.trim();
  if (typeof options.lang === "string" && options.lang.trim()) due.lang = options.lang.trim();
  if (Object.keys(due).length) args.due = due;

  const data = await todoistSync<unknown>({
    token: options.token,
    commands: [{ type: "reminder_add", temp_id: tempId, uuid, args }],
  });

  let reminderId: string | null = null;
  if (isRecord(data) && isRecord(data.temp_id_mapping)) {
    const mapped = data.temp_id_mapping[tempId];
    if (typeof mapped === "string") reminderId = mapped;
  }

  return { uuid, tempId, reminderId, raw: data };
}

export async function todoistUpdateReminder(options: {
  token: string;
  reminderId: string;
  type?: string;
  dueString?: string;
  dueDate?: string;
  dueDatetime?: string;
  timezone?: string;
  minuteOffset?: number;
  lang?: string;
}) {
  const uuid = randomUUID();
  const args: Record<string, unknown> = { id: options.reminderId };
  if (typeof options.type === "string" && options.type.trim()) args.type = options.type.trim();
  if (typeof options.minuteOffset === "number") args.minute_offset = options.minuteOffset;

  const due: Record<string, unknown> = {};
  if (typeof options.dueString === "string" && options.dueString.trim()) due.string = options.dueString.trim();
  if (typeof options.dueDate === "string" && options.dueDate.trim()) due.date = options.dueDate.trim();
  if (typeof options.dueDatetime === "string" && options.dueDatetime.trim()) due.datetime = options.dueDatetime.trim();
  if (typeof options.timezone === "string" && options.timezone.trim()) due.timezone = options.timezone.trim();
  if (typeof options.lang === "string" && options.lang.trim()) due.lang = options.lang.trim();
  if (Object.keys(due).length) args.due = due;

  const data = await todoistSync<unknown>({
    token: options.token,
    commands: [{ type: "reminder_update", uuid, args }],
  });

  return { uuid, raw: data };
}

export async function todoistDeleteReminder(options: { token: string; reminderId: string }) {
  const uuid = randomUUID();
  const data = await todoistSync<unknown>({
    token: options.token,
    commands: [{ type: "reminder_delete", uuid, args: { id: options.reminderId } }],
  });
  return { uuid, raw: data };
}

