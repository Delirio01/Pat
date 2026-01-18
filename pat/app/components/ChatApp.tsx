"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";

type Role = "system" | "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Exclude<Role, "system">;
  content: string;
};

type Settings = {
  model: string;
  temperature: number;
  systemPrompt: string;
  webScrapeEnabled: boolean;
  webScrapeAuto: boolean;
};

type Project = {
  id: string;
  name: string;
};

type Task = {
  id: string;
  title: string;
  completed: boolean;
};

type WebPin = {
  id: string;
  title: string;
  url: string;
  createdAt: number;
};

type ApiResponse =
  | { ok: true; message: { role: "assistant"; content: string } }
  | { ok: false; error: string };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const SETTINGS_KEY = "pat.settings.v1";
const MESSAGES_KEY = "pat.messages.v1";
const PROJECTS_KEY = "pat.projects.v1";
const TASKS_KEY = "pat.tasks.v1";
const WEB_PINS_KEY = "pat.webPins.v1";
const ACTIVE_PROJECT_KEY = "pat.activeProjectId.v1";
const SIDEBAR_KEY = "pat.sidebar.v1";

const DEFAULT_SETTINGS: Settings = {
  model: "grok-3",
  temperature: 0.3,
  systemPrompt:
    "You are Grok, running in a sleek JARVIS-style console. Be direct, helpful, and technical. Use short, actionable answers. Ask clarifying questions when needed.",
  webScrapeEnabled: false,
  webScrapeAuto: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clampNumber(value, min, max));
}

function safeLocalStorageGet(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readJson(key: string): unknown {
  const raw = safeLocalStorageGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function titleFromUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const lastPath = u.pathname.split("/").filter(Boolean).slice(-1)[0] ?? "";
    const cleanedPath = decodeURIComponent(lastPath).replace(/[-_]+/g, " ").trim();
    const parts = cleanedPath ? cleanedPath.split(/\s+/) : [];
    const words = parts.slice(0, 3);
    if (words.length) return `${host} ${words.join(" ")}`.trim();
    return host;
  } catch {
    return url;
  }
}

function toFiveWords(text: string) {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[`*_#[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 5);
  return words.join(" ");
}

function extractMarkdownLinkTitle(message: string, url: string) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\[([^\\]]{1,120})\\]\\(${escaped}\\)`, "i");
  const match = message.match(re);
  return match?.[1]?.trim() || null;
}

function findLatestUrl(
  messages: ChatMessage[],
  opts?: { role?: ChatMessage["role"] },
): { url: string; context: string } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (opts?.role && msg.role !== opts.role) continue;
    const text = msg.content ?? "";
    const match = text.match(/https?:\/\/[^\s<>()\]]+/i);
    if (!match) continue;
    const url = match[0].replace(/[).,]+$/, "");
    return { url, context: text };
  }
  return null;
}

function normalizePinUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)/.test(trimmed)) return null;
  if (/^\/\//.test(trimmed)) return `https:${trimmed}`;

  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, "");
  const hostish = withoutScheme.split("/")[0] ?? "";

  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(hostish)) {
    return `http://${withoutScheme}`;
  }

  if (/^www\./i.test(withoutScheme) || withoutScheme.includes(".")) {
    return `https://${withoutScheme}`;
  }

  return null;
}

export default function ChatApp() {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceTranscriptRef = useRef("");
  const voiceStopShouldSendRef = useRef(false);
  const sendRef = useRef<(override?: unknown) => Promise<void> | void>(() => {});

  const [model, setModel] = useState(DEFAULT_SETTINGS.model);
  const [temperature, setTemperature] = useState(DEFAULT_SETTINGS.temperature);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SETTINGS.systemPrompt);
  const [webScrapeEnabled, setWebScrapeEnabled] = useState(DEFAULT_SETTINGS.webScrapeEnabled);
  const [webScrapeAuto, setWebScrapeAuto] = useState(DEFAULT_SETTINGS.webScrapeAuto);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid(),
      role: "assistant",
      content:
        "JARVIS online. Give me your objective, and I’ll route it through Grok.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [modelOpen, setModelOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [pinsOpen, setPinsOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(320);

  const [projects, setProjects] = useState<Project[]>([
    { id: "inbox", name: "Inbox" },
  ]);
  const [activeProjectId, setActiveProjectId] = useState("inbox");
  const [tasksByProject, setTasksByProject] = useState<Record<string, Task[]>>({
    inbox: [],
  });
  const [pinsByProject, setPinsByProject] = useState<Record<string, WebPin[]>>({
    inbox: [],
  });

  const [newProjectName, setNewProjectName] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newPinUrl, setNewPinUrl] = useState("");

  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragPinId, setDragPinId] = useState<string | null>(null);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const apiMessages = useMemo(() => {
    const wire: Array<{ role: Role; content: string }> = [];
    if (systemPrompt.trim()) wire.push({ role: "system", content: systemPrompt });
    for (const m of messages) wire.push({ role: m.role, content: m.content });
    return wire;
  }, [messages, systemPrompt]);

  const workspaceContextForModel = useMemo(() => {
    const activeProject =
      projects.find((p) => p.id === activeProjectId) ?? { id: activeProjectId, name: "Inbox" };

    const projectsPayload = projects.slice(0, 30).map((p) => ({ id: p.id, name: p.name }));
    const tasks = (tasksByProject[activeProjectId] ?? [])
      .slice(0, 60)
      .map((t) => ({ id: t.id, title: t.title, completed: t.completed }));
    const webPins = (pinsByProject[activeProjectId] ?? [])
      .slice(0, 60)
      .map((p) => ({ id: p.id, title: p.title, url: p.url }));

    const payload = {
      activeProject: { id: activeProject.id, name: activeProject.name },
      projects: projectsPayload,
      tasks,
      webPins,
      meta: {
        truncated: {
          projects: projects.length > projectsPayload.length,
          tasks: (tasksByProject[activeProjectId] ?? []).length > tasks.length,
          webPins: (pinsByProject[activeProjectId] ?? []).length > webPins.length,
        },
      },
    };

    return `Workspace context (Projects/Tasks/Web Pins): ${JSON.stringify(payload)}`;
  }, [activeProjectId, pinsByProject, projects, tasksByProject]);

  useEffect(() => {
    try {
      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings) as unknown;
        if (isRecord(parsed)) {
          if (typeof parsed.model === "string") setModel(parsed.model);
          if (typeof parsed.temperature === "number") {
            setTemperature(clampNumber(parsed.temperature, 0, 2));
          }
          if (typeof parsed.systemPrompt === "string") {
            setSystemPrompt(parsed.systemPrompt);
          }
          if (typeof parsed.webScrapeEnabled === "boolean") {
            setWebScrapeEnabled(parsed.webScrapeEnabled);
          }
          if (typeof parsed.webScrapeAuto === "boolean") {
            setWebScrapeAuto(parsed.webScrapeAuto);
          }
        }
      }

      const rawMessages = localStorage.getItem(MESSAGES_KEY);
      if (rawMessages) {
        const parsed = JSON.parse(rawMessages) as unknown;
        if (Array.isArray(parsed)) {
          const loaded: ChatMessage[] = [];
          for (const item of parsed) {
            if (!isRecord(item)) continue;
            const role = item.role;
            const content = item.content;
            if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
              continue;
            }
            loaded.push({ id: uid(), role, content });
          }
          if (loaded.length) setMessages(loaded);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const parsedProjects = readJson(PROJECTS_KEY);
    if (Array.isArray(parsedProjects)) {
      const loaded: Project[] = [];
      for (const item of parsedProjects) {
        if (!isRecord(item)) continue;
        if (typeof item.id !== "string" || typeof item.name !== "string") continue;
        loaded.push({ id: item.id, name: item.name });
      }
      const hasInbox = loaded.some((p) => p.id === "inbox");
      setProjects(hasInbox ? loaded : [{ id: "inbox", name: "Inbox" }, ...loaded]);
    }

    const parsedTasks = readJson(TASKS_KEY);
    if (isRecord(parsedTasks)) {
      const loaded: Record<string, Task[]> = {};
      for (const [projectId, value] of Object.entries(parsedTasks)) {
        if (!Array.isArray(value)) continue;
        const tasks: Task[] = [];
        for (const item of value) {
          if (!isRecord(item)) continue;
          if (typeof item.id !== "string" || typeof item.title !== "string") continue;
          tasks.push({
            id: item.id,
            title: item.title,
            completed: typeof item.completed === "boolean" ? item.completed : false,
          });
        }
        loaded[projectId] = tasks;
      }
      if (!loaded.inbox) loaded.inbox = [];
      setTasksByProject(loaded);
    }

    const parsedPins = readJson(WEB_PINS_KEY);
    if (isRecord(parsedPins)) {
      const loaded: Record<string, WebPin[]> = {};
      for (const [projectId, value] of Object.entries(parsedPins)) {
        if (!Array.isArray(value)) continue;
        const pins: WebPin[] = [];
        for (const item of value) {
          if (!isRecord(item)) continue;
          if (typeof item.id !== "string") continue;
          if (typeof item.title !== "string") continue;
          if (typeof item.url !== "string") continue;
          const normalized = normalizePinUrl(item.url);
          if (!normalized) continue;
          pins.push({
            id: item.id,
            title: item.title,
            url: normalized,
            createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
          });
        }
        loaded[projectId] = pins;
      }
      if (!loaded.inbox) loaded.inbox = [];
      setPinsByProject(loaded);
    }

    const parsedActive = safeLocalStorageGet(ACTIVE_PROJECT_KEY);
    if (parsedActive) setActiveProjectId(parsedActive);

    const parsedSidebar = readJson(SIDEBAR_KEY);
    if (isRecord(parsedSidebar)) {
      if (typeof parsedSidebar.collapsed === "boolean") setSidebarCollapsed(parsedSidebar.collapsed);
      if (typeof parsedSidebar.modelOpen === "boolean") setModelOpen(parsedSidebar.modelOpen);
      if (typeof parsedSidebar.projectsOpen === "boolean") setProjectsOpen(parsedSidebar.projectsOpen);
      if (typeof parsedSidebar.tasksOpen === "boolean") setTasksOpen(parsedSidebar.tasksOpen);
      if (typeof parsedSidebar.pinsOpen === "boolean") setPinsOpen(parsedSidebar.pinsOpen);
      if (typeof parsedSidebar.width === "number") {
        setSidebarWidth(clampInt(parsedSidebar.width, 260, 520));
      }
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify(
          { model, temperature, systemPrompt, webScrapeEnabled, webScrapeAuto } satisfies Settings,
        ),
      );
    } catch {
      // ignore
    }
  }, [model, systemPrompt, temperature, webScrapeAuto, webScrapeEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(
        MESSAGES_KEY,
        JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content }))),
      );
    } catch {
      // ignore
    }
  }, [messages]);

  useEffect(() => {
    safeLocalStorageSet(PROJECTS_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    safeLocalStorageSet(TASKS_KEY, JSON.stringify(tasksByProject));
  }, [tasksByProject]);

  useEffect(() => {
    safeLocalStorageSet(WEB_PINS_KEY, JSON.stringify(pinsByProject));
  }, [pinsByProject]);

  useEffect(() => {
    safeLocalStorageSet(ACTIVE_PROJECT_KEY, activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    safeLocalStorageSet(
      SIDEBAR_KEY,
      JSON.stringify({
        collapsed: sidebarCollapsed,
        modelOpen,
        projectsOpen,
        tasksOpen,
        pinsOpen,
        width: sidebarWidth,
      }),
    );
  }, [modelOpen, pinsOpen, projectsOpen, sidebarCollapsed, sidebarWidth, tasksOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setVoiceSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: unknown) => {
      const e = event as {
        resultIndex?: number;
        results?: ArrayLike<ArrayLike<{ transcript?: string } & { confidence?: number }> & { isFinal?: boolean }>;
      };
      const results = e.results;
      if (!results) return;

      let finalText = voiceTranscriptRef.current;
      let interimText = "";
      const start = typeof e.resultIndex === "number" ? e.resultIndex : 0;

      for (let i = start; i < results.length; i += 1) {
        const result = results[i];
        const transcript = (result?.[0]?.transcript ?? "").trim();
        if (!transcript) continue;
        if (result?.isFinal) {
          finalText = `${finalText} ${transcript}`.trim();
        } else {
          interimText = `${interimText} ${transcript}`.trim();
        }
      }

      voiceTranscriptRef.current = finalText;
      const combined = `${finalText} ${interimText}`.trim();
      if (combined) setDraft(combined);
    };

    recognition.onerror = (event: unknown) => {
      const e = event as { error?: string };
      setVoiceError(e.error ? `Voice error: ${e.error}` : "Voice error.");
      setIsListening(false);
      setVoiceEnabled(false);
      voiceStopShouldSendRef.current = false;
    };

    recognition.onend = () => {
      setIsListening(false);
      if (!voiceStopShouldSendRef.current) return;
      voiceStopShouldSendRef.current = false;
      const text = voiceTranscriptRef.current.trim();
      voiceTranscriptRef.current = "";
      if (text) sendRef.current(text);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!voiceEnabled) window.speechSynthesis?.cancel();
  }, [voiceEnabled]);

  function parseScrapeRequest(text: string): { url: string; prompt: string; isCommand: boolean } | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("/scrape")) {
      const match = trimmed.match(/^\/scrape\s+(\S+)(?:\s+([\s\S]*))?$/);
      if (!match) return null;
      const url = match[1] ?? "";
      const prompt = (match[2] ?? "").trim();
      return { url, prompt: prompt || "Summarize the page.", isCommand: true };
    }

    if (!webScrapeAuto) return null;
    const urlMatch = trimmed.match(/https?:\/\/[^\s<>()\]]+/i);
    if (!urlMatch) return null;
    const url = urlMatch[0].replace(/[).,]+$/, "");
    return { url, prompt: trimmed, isCommand: false };
  }

  function parsePinCommand(text: string): { url?: string; scope: "any" | "assistant" } | null {
    const normalized = text.trim().replace(/[.!?]+$/, "").trim();
    if (!normalized) return null;

    if (/^\/pin(\s+|$)/i.test(normalized)) {
      const match = normalized.match(/^\/pin(?:\s+(\S+))?/i);
      const url = (match?.[1] ?? "").trim();
      return { url: url || undefined, scope: "any" };
    }

    if (/^web pin this$/i.test(normalized) || /^pin this$/i.test(normalized)) {
      return { scope: "any" };
    }

    if (
      /^(?:web\s+)?pin\s+(?:that\s+)?(?:url|link)(?:\s+you\s+just\s+sent)?$/i.test(normalized) ||
      /^web pin that$/i.test(normalized) ||
      /^pin that$/i.test(normalized)
    ) {
      return { scope: "assistant" };
    }

    return null;
  }

  function toggleVoice() {
    if (!voiceSupported) {
      setVoiceError("Voice input is not supported in this browser.");
      return;
    }

    const recognition = recognitionRef.current;
    if (!recognition) {
      setVoiceError("Voice input is not available.");
      return;
    }

    setVoiceError(null);

    if (isListening) {
      voiceStopShouldSendRef.current = true;
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      setIsListening(false);
      if (!voiceEnabled) setVoiceEnabled(true);
      return;
    }

    voiceTranscriptRef.current = "";
    voiceStopShouldSendRef.current = false;
    if (!voiceEnabled) setVoiceEnabled(true);
    try {
      recognition.start();
    } catch {
      // ignore
    }
    setIsListening(true);
  }

  function speak(text: string) {
    if (!voiceEnabled) return;
    if (typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      synth.speak(utter);
    } catch {
      // ignore
    }
  }

  async function send(override?: unknown) {
    const raw = typeof override === "string" ? override.trim() : draft.trim();
    if (!raw || isSending) return;

    const pinCommand = parsePinCommand(raw);
    if (pinCommand) {
      const maybeUrl = pinCommand.url?.trim();
      const source = maybeUrl
        ? { url: maybeUrl, context: maybeUrl }
        : findLatestUrl(messages, pinCommand.scope === "assistant" ? { role: "assistant" } : undefined);
      const userMsg: ChatMessage = { id: uid(), role: "user", content: raw };
      if (!source?.url) {
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content:
            "No URL found to pin. Send a link, then say “web pin this”, or use `/pin https://…`.",
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setDraft("");
        return;
      }

      const normalized = normalizePinUrl(source.url);
      if (!normalized) {
        const assistantMsg: ChatMessage = {
          id: uid(),
          role: "assistant",
          content: "That doesn’t look like a valid web URL. Use a full `https://` link.",
        };
        setMessages((prev) => [...prev, userMsg, assistantMsg]);
        setDraft("");
        return;
      }

      addPinFrom(normalized, source.context);
      const assistantMsg: ChatMessage = {
        id: uid(),
        role: "assistant",
        content: "Pinned.",
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setDraft("");
      return;
    }

    const scrapeRequest = webScrapeEnabled ? parseScrapeRequest(raw) : null;
    const contentForModel = scrapeRequest?.prompt ?? raw;
    const contentForUi =
      scrapeRequest && scrapeRequest.isCommand ? contentForModel : raw;

    setError(null);
    setDraft("");
    setIsSending(true);

    const userMsg: ChatMessage = { id: uid(), role: "user", content: contentForUi };
    const placeholder: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: "…",
    };

    setMessages((prev) => [...prev, userMsg, placeholder]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let outgoingMessages: Array<{ role: Role; content: string }> = [...apiMessages];
      const contextMessage: { role: Role; content: string } = {
        role: "system",
        content: workspaceContextForModel,
      };
      const insertAt = outgoingMessages.length && outgoingMessages[0].role === "system" ? 1 : 0;
      outgoingMessages.splice(insertAt, 0, contextMessage);
      outgoingMessages.push({ role: "user", content: contentForModel });

      if (scrapeRequest?.url) {
        setMessages((prev) =>
          prev.map((m) => (m.id === placeholder.id ? { ...m, content: "Scraping…" } : m)),
        );

        const scrapeRes = await fetch("/api/scrape", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: scrapeRequest.url }),
          signal: controller.signal,
        });

        const scrapeJson = (await scrapeRes.json().catch(() => null)) as
          | { ok: true; url: string; markdown: string }
          | { ok: false; error: string }
          | null;

        if (!scrapeRes.ok || !scrapeJson || scrapeJson.ok === false) {
          const message = (scrapeJson && "error" in scrapeJson && scrapeJson.error) || "Scrape failed";
          setError(message);
        } else {
          const context = `Webpage content (via Firecrawl)\nURL: ${scrapeJson.url}\n\n${scrapeJson.markdown}`;
          outgoingMessages = [
            ...apiMessages,
            { role: "system", content: context },
            { role: "user", content: contentForModel },
          ];
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === placeholder.id ? { ...m, content: "…" } : m)),
        );
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature,
          messages: outgoingMessages,
          tools: {
            firecrawl: webScrapeEnabled,
          },
        }),
        signal: controller.signal,
      });

      const data = (await res.json()) as ApiResponse;
      if (!res.ok || !data || data.ok === false) {
        throw new Error(
          (data && "error" in data && data.error) || `Request failed (${res.status})`,
        );
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === placeholder.id ? { ...m, content: data.message.content } : m)),
      );
      speak(data.message.content);
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== placeholder.id));
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      abortRef.current = null;
      setIsSending(false);
    }
  }

  sendRef.current = send;

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsSending(false);
  }

  function clearChat() {
    setMessages([
      {
        id: uid(),
        role: "assistant",
        content:
          "Memory wiped. New session. What are we building or debugging?",
      },
    ]);
    setError(null);
  }

  function addProject() {
    const name = newProjectName.trim();
    if (!name) return;
    const id = uid();
    setProjects((prev) => [...prev, { id, name }]);
    setTasksByProject((prev) => ({ ...prev, [id]: prev[id] ?? [] }));
    setActiveProjectId(id);
    setNewProjectName("");
  }

  function addTask() {
    const title = newTaskTitle.trim();
    if (!title) return;
    const task: Task = { id: uid(), title, completed: false };
    setTasksByProject((prev) => {
      const list = prev[activeProjectId] ?? [];
      return { ...prev, [activeProjectId]: [...list, task] };
    });
    setNewTaskTitle("");
  }

  function toggleTaskCompleted(taskId: string) {
    setTasksByProject((prev) => {
      const list = prev[activeProjectId] ?? [];
      return {
        ...prev,
        [activeProjectId]: list.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t)),
      };
    });
  }

  function removeTask(taskId: string) {
    setTasksByProject((prev) => {
      const list = prev[activeProjectId] ?? [];
      return { ...prev, [activeProjectId]: list.filter((t) => t.id !== taskId) };
    });
  }

  function addPinFrom(url: string, context: string) {
    const normalized = normalizePinUrl(url);
    if (!normalized) {
      setError("Invalid pin URL. Use a full https:// link.");
      return;
    }
    const baseTitle = extractMarkdownLinkTitle(context, url) ?? context;
    const titleCandidate = toFiveWords(baseTitle);
    const title = titleCandidate || toFiveWords(titleFromUrl(normalized)) || "Web pin";
    const pin: WebPin = { id: uid(), url: normalized, title, createdAt: Date.now() };
    setPinsByProject((prev) => {
      const list = prev[activeProjectId] ?? [];
      return { ...prev, [activeProjectId]: [...list, pin] };
    });
  }

  function addPinFromInput() {
    const url = newPinUrl.trim();
    if (!url) return;
    const normalized = normalizePinUrl(url);
    if (!normalized) {
      setError("Invalid pin URL. Use a full https:// link.");
      return;
    }
    addPinFrom(normalized, url);
    setNewPinUrl("");
  }

  function removePin(pinId: string) {
    setPinsByProject((prev) => {
      const list = prev[activeProjectId] ?? [];
      return { ...prev, [activeProjectId]: list.filter((p) => p.id !== pinId) };
    });
  }

  function movePinWithinActive(dragId: string, overId: string) {
    if (dragId === overId) return;
    setPinsByProject((prev) => {
      const list = prev[activeProjectId] ?? [];
      const from = list.findIndex((p) => p.id === dragId);
      const to = list.findIndex((p) => p.id === overId);
      if (from === -1 || to === -1) return prev;
      const next = list.slice();
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      return { ...prev, [activeProjectId]: next };
    });
  }

  function moveTaskWithinActive(dragId: string, overId: string) {
    if (dragId === overId) return;
    setTasksByProject((prev) => {
      const list = prev[activeProjectId] ?? [];
      const from = list.findIndex((t) => t.id === dragId);
      const to = list.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1) return prev;
      const next = list.slice();
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      return { ...prev, [activeProjectId]: next };
    });
  }

  function beginResizeSidebar(e: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return;
    e.preventDefault();
    setIsResizingSidebar(true);

    const startCursor = document.body.style.cursor;
    const startSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const update = (clientX: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clampInt(rect.right - clientX, 260, 520);
      setSidebarWidth(next);
    };

    update(e.clientX);

    const onMove = (ev: PointerEvent) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = startCursor;
      document.body.style.userSelect = startSelect;
      setIsResizingSidebar(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  const modelOptions = [
    "grok-4-1-fast-reasoning",
    "grok-4-1-fast-non-reasoning",
    "grok-4-fast-reasoning",
    "grok-4-fast-non-reasoning",
    "grok-4-0709",
    "grok-code-fast-1",
    "grok-3",
    "grok-3-mini",
    "grok-2-vision-1212",
  ];

  const activeTasks = tasksByProject[activeProjectId] ?? [];
  const activePins = pinsByProject[activeProjectId] ?? [];
  const activeProjectName = projects.find((p) => p.id === activeProjectId)?.name ?? "Inbox";
  const hasUserMessage = messages.some((m) => m.role === "user");

  return (
    <div className="jarvis-bg h-dvh overflow-hidden">
      <div ref={containerRef} className="relative mx-auto flex h-full w-full max-w-7xl gap-0 px-4 py-0">
        {sidebarCollapsed ? (
          <button
            type="button"
            className="jarvis-sidebar-handle"
            onClick={() => setSidebarCollapsed(false)}
            aria-label="Open sidebar"
            title="Open sidebar"
          >
            ☰
          </button>
        ) : null}

        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-8 md:px-8">
            {hasUserMessage ? (
              <div className="mx-auto w-full max-w-[860px] space-y-8">
                {messages.map((m) => (
                  <div key={m.id} className="group flex gap-4">
                    <div
                      className={
                        m.role === "assistant"
                          ? "jarvis-avatar jarvis-avatar-assistant"
                          : "jarvis-avatar jarvis-avatar-user"
                      }
                      aria-hidden="true"
                    >
                      {m.role === "assistant" ? "G" : "Y"}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-[12px] font-medium text-[color:var(--jarvis-muted)]">
                          {m.role === "assistant" ? "Grok" : "You"}
                        </div>
                        <button
                          type="button"
                          className="jarvis-icon-button opacity-0 transition-opacity group-hover:opacity-100"
                          onClick={() => navigator.clipboard.writeText(m.content).catch(() => {})}
                          aria-label="Copy message"
                          title="Copy"
                        >
                          ⧉
                        </button>
                      </div>

                      <div
                        className={
                          m.role === "assistant"
                            ? "jarvis-bubble jarvis-bubble-assistant"
                            : "jarvis-bubble jarvis-bubble-user"
                        }
                      >
                        <div className="jarvis-prose whitespace-pre-wrap text-[15px] leading-7 text-[color:var(--jarvis-text)]">
                          {m.content}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            ) : (
              <div className="mx-auto flex h-full w-full max-w-[860px] flex-col justify-center pb-10">
                <div className="jarvis-hero">
                  <div className="jarvis-hero-title">How can I help today?</div>
                  <div className="jarvis-hero-sub">
                    Grok inside Pat • Model <span className="jarvis-hero-pill">{model}</span>
                  </div>
                </div>

                <div className="mt-8">
                  <div className="jarvis-composer">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={4}
                      placeholder="Ask anything…"
                      className="jarvis-composer-textarea"
                    />
                    <div className="jarvis-composer-bar">
                      <div className="jarvis-composer-left">
                        <button type="button" className="jarvis-composer-icon" disabled title="Coming soon">
                          +
                        </button>
                        <button type="button" className="jarvis-composer-icon" disabled title="Coming soon">
                          ⏱
                        </button>
                        <button
                          type="button"
                          onClick={toggleVoice}
                          className="jarvis-composer-icon"
                          data-active={isListening ? "true" : "false"}
                          aria-pressed={isListening}
                          aria-label={isListening ? "Stop listening and send" : "Start voice input"}
                          title={
                            !voiceSupported
                              ? "Voice not supported"
                              : isListening
                                ? "Stop (send)"
                                : "Speak"
                          }
                          disabled={!voiceSupported}
                        >
                          {isListening ? "■" : "⏺"}
                        </button>
                      </div>
                      <div className="jarvis-composer-right">
                        <Link
                          href="/settings"
                          className="jarvis-composer-icon"
                          aria-label="Configuration"
                          title="Configuration"
                        >
                          ⚙
                        </Link>
                        {isSending ? (
                          <button type="button" onClick={stop} className="jarvis-button h-10 px-4">
                            Stop
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={send}
                          disabled={isSending || !draft.trim()}
                          className="jarvis-send-round"
                          aria-label="Send"
                          title="Send"
                        >
                          ↑
                        </button>
                      </div>
                    </div>
                    {voiceError ? <div className="jarvis-error mt-3 text-sm">{voiceError}</div> : null}
                    {error ? <div className="jarvis-error mt-3 text-sm">{error}</div> : null}
                  </div>
                </div>
              </div>
            )}
          </section>

          {hasUserMessage ? (
            <footer className="px-6 py-4 md:px-8">
              {error ? (
                <div className="jarvis-error mb-3 text-sm">
                  {error}
                  <div className="mt-1 text-[12px] text-[color:var(--jarvis-muted)]">
                    Ensure `XAI_API_KEY` is set in `pat/.env.local`.
                  </div>
                </div>
              ) : null}

              <div className="mx-auto w-full max-w-[860px]">
                <div className="jarvis-composer">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={2}
                    placeholder="Message Grok…"
                    className="jarvis-composer-textarea"
                  />
                  <div className="jarvis-composer-bar">
                    <div className="jarvis-composer-left">
                      <button type="button" className="jarvis-composer-icon" disabled title="Coming soon">
                        +
                      </button>
                      <button type="button" className="jarvis-composer-icon" disabled title="Coming soon">
                        ⏱
                      </button>
                      <button
                        type="button"
                        onClick={toggleVoice}
                        className="jarvis-composer-icon"
                        data-active={isListening ? "true" : "false"}
                        aria-pressed={isListening}
                        aria-label={isListening ? "Stop listening and send" : "Start voice input"}
                        title={
                          !voiceSupported
                            ? "Voice not supported"
                            : isListening
                              ? "Stop (send)"
                              : "Speak"
                        }
                        disabled={!voiceSupported}
                      >
                        {isListening ? "■" : "⏺"}
                      </button>
                    </div>
                    <div className="jarvis-composer-right">
                      <div className="jarvis-composer-meta" title={model}>
                        {model}
                      </div>
                      <Link
                        href="/settings"
                        className="jarvis-composer-icon"
                        aria-label="Configuration"
                        title="Configuration"
                      >
                        ⚙
                      </Link>
                      {isSending ? (
                        <button type="button" onClick={stop} className="jarvis-button h-10 px-4">
                          Stop
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={send}
                        disabled={isSending || !draft.trim()}
                        className="jarvis-send-round"
                        aria-label="Send"
                        title="Send"
                      >
                        ↑
                      </button>
                    </div>
                  </div>
                </div>
                {voiceError ? <div className="jarvis-error mt-3 text-sm">{voiceError}</div> : null}
              </div>
            </footer>
          ) : null}
        </main>

        <aside
          data-collapsed={sidebarCollapsed ? "true" : "false"}
          className={`jarvis-panel jarvis-right-sidebar hidden h-full shrink-0 overflow-hidden md:flex md:flex-col ${
            sidebarCollapsed ? "md:ml-0" : "md:ml-4"
          }`}
          style={{ width: sidebarCollapsed ? 0 : `${sidebarWidth}px` }}
        >
            <div
              className={isResizingSidebar ? "jarvis-sidebar-resize jarvis-sidebar-resize-active" : "jarvis-sidebar-resize"}
              onPointerDown={beginResizeSidebar}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
            />
            <div className="flex items-center justify-between px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="jarvis-logo" aria-hidden="true">
                  P
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[color:var(--jarvis-text)]">
                    Pat
                  </div>
                  <div className="truncate text-[12px] text-[color:var(--jarvis-muted)]">
                    Projects • Tasks
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="jarvis-icon-button"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Close sidebar"
                title="Close sidebar"
                >
                  ×
                </button>
            </div>

            <div className="jarvis-divider" />

            <div className="min-h-0 flex-1 overflow-hidden px-4 py-4">
              <div className="flex h-full flex-col gap-4">
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-medium text-[color:var(--jarvis-muted)]">
                        Model
                      </div>
                      <button
                        type="button"
                        className="jarvis-icon-button"
                        onClick={() => setModelOpen((v) => !v)}
                        aria-label={modelOpen ? "Collapse model" : "Expand model"}
                        title={modelOpen ? "Collapse" : "Expand"}
                        aria-expanded={modelOpen}
                      >
                        {modelOpen ? "–" : "+"}
                      </button>
                    </div>

                    <div className="jarvis-collapsible" data-open={modelOpen ? "true" : "false"}>
                      <div className="pt-2">
                        <select
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          className="jarvis-input h-10 w-full px-3 text-[13px]"
                          aria-label="Model"
                        >
                          {modelOptions.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-medium text-[color:var(--jarvis-muted)]">
                        Projects
                      </div>
                      <button
                        type="button"
                        className="jarvis-icon-button"
                        onClick={() => setProjectsOpen((v) => !v)}
                        aria-label={projectsOpen ? "Collapse projects" : "Expand projects"}
                        title={projectsOpen ? "Collapse" : "Expand"}
                      >
                        {projectsOpen ? "–" : "+"}
                      </button>
                    </div>

                    {projectsOpen ? (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          {projects.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setActiveProjectId(p.id)}
                              className={
                                p.id === activeProjectId
                                  ? "jarvis-list-item jarvis-list-item-active"
                                  : "jarvis-list-item"
                              }
                            >
                              <span className="truncate">{p.name}</span>
                            </button>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <input
                            value={newProjectName}
                            onChange={(e) => setNewProjectName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addProject();
                            }}
                            placeholder="New project…"
                            className="jarvis-input h-10 min-w-0 flex-1 px-3 text-[13px]"
                          />
                          <button type="button" onClick={addProject} className="jarvis-button px-3">
                            Add
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-medium text-[color:var(--jarvis-muted)]">
                        Tasks
                      </div>
                      <button
                        type="button"
                        className="jarvis-icon-button"
                        onClick={() => setTasksOpen((v) => !v)}
                        aria-label={tasksOpen ? "Collapse tasks" : "Expand tasks"}
                        title={tasksOpen ? "Collapse" : "Expand"}
                        aria-expanded={tasksOpen}
                      >
                        {tasksOpen ? "–" : "+"}
                      </button>
                    </div>

                    <div className="jarvis-collapsible" data-open={tasksOpen ? "true" : "false"}>
                      <div className="space-y-3 pt-1">
                        <div className="jarvis-active-project" title={`Active project: ${activeProjectName}`}>
                          <span className="jarvis-active-project-label">Active</span>
                          <span className="jarvis-active-project-name">{activeProjectName}</span>
                        </div>

                        <div className="space-y-2">
                          {activeTasks.length ? (
                            activeTasks.map((t) => (
                              <div
                                key={t.id}
                                className={
                                  dragTaskId === t.id
                                    ? "jarvis-task-item jarvis-task-item-dragging"
                                    : "jarvis-task-item"
                                }
                                draggable
                                onDragStart={(e) => {
                                  setDragTaskId(t.id);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", t.id);
                                }}
                                onDragEnd={() => setDragTaskId(null)}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  const dragged = e.dataTransfer.getData("text/plain") || dragTaskId;
                                  if (dragged) moveTaskWithinActive(dragged, t.id);
                                  setDragTaskId(null);
                                }}
                              >
                                <button
                                  type="button"
                                  className="jarvis-task-check"
                                  onClick={() => toggleTaskCompleted(t.id)}
                                  aria-label={
                                    t.completed
                                      ? "Mark task as not completed"
                                      : "Mark task as completed"
                                  }
                                  title={t.completed ? "Uncomplete" : "Complete"}
                                >
                                  {t.completed ? "✓" : "○"}
                                </button>

                                <div
                                  className={
                                    t.completed
                                      ? "jarvis-task-title jarvis-task-title-completed"
                                      : "jarvis-task-title"
                                  }
                                  title={t.title}
                                >
                                  {t.title}
                                </div>
                                <button
                                  type="button"
                                  className="jarvis-icon-button jarvis-task-remove"
                                  onClick={() => removeTask(t.id)}
                                  aria-label="Remove task"
                                  title="Remove"
                                >
                                  ×
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="text-[12px] text-[color:var(--jarvis-muted)]">
                              No tasks yet.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-medium text-[color:var(--jarvis-muted)]">
                        Web Pins
                      </div>
                      <button
                        type="button"
                        className="jarvis-icon-button"
                        onClick={() => setPinsOpen((v) => !v)}
                        aria-label={pinsOpen ? "Collapse web pins" : "Expand web pins"}
                        title={pinsOpen ? "Collapse" : "Expand"}
                        aria-expanded={pinsOpen}
                      >
                        {pinsOpen ? "–" : "+"}
                      </button>
                    </div>

                    <div className="jarvis-collapsible" data-open={pinsOpen ? "true" : "false"}>
                      <div className="space-y-2 pt-1">
                        {activePins.length ? (
                          activePins.map((p) => (
                            <div
                              key={p.id}
                              className={
                                dragPinId === p.id
                                  ? "jarvis-pin-item jarvis-pin-item-dragging"
                                  : "jarvis-pin-item"
                              }
                              draggable
                              onDragStart={(e) => {
                                setDragPinId(p.id);
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", p.id);
                              }}
                              onDragEnd={() => setDragPinId(null)}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = "move";
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const dragged = e.dataTransfer.getData("text/plain") || dragPinId;
                                if (dragged) movePinWithinActive(dragged, p.id);
                                setDragPinId(null);
                              }}
                            >
                              <button
                                type="button"
                                className="jarvis-pin-open"
                                onClick={() => window.open(p.url, "_blank", "noopener,noreferrer")}
                                aria-label="Open web pin"
                                title={p.url}
                              >
                                ↗
                              </button>
                              <div className="jarvis-pin-title" title={p.title}>
                                {p.title}
                              </div>
                              <button
                                type="button"
                                className="jarvis-icon-button jarvis-pin-remove"
                                onClick={() => removePin(p.id)}
                                aria-label="Remove web pin"
                                title="Remove"
                              >
                                ×
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="text-[12px] text-[color:var(--jarvis-muted)]">
                            No web pins yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-auto space-y-3">
                  <div className="jarvis-collapsible" data-open={tasksOpen ? "true" : "false"}>
                    <div className="flex gap-2 pt-2">
                      <input
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addTask();
                        }}
                        placeholder={`New task in ${activeProjectName}…`}
                        className="jarvis-input h-10 min-w-0 flex-1 px-3 text-[13px]"
                      />
                      <button type="button" onClick={addTask} className="jarvis-button px-3">
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="jarvis-collapsible" data-open={pinsOpen ? "true" : "false"}>
                    <div className="flex gap-2 pt-2">
                      <input
                        value={newPinUrl}
                        onChange={(e) => setNewPinUrl(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addPinFromInput();
                        }}
                        placeholder="Pin URL…"
                        className="jarvis-input h-10 min-w-0 flex-1 px-3 text-[13px]"
                      />
                      <button type="button" onClick={addPinFromInput} className="jarvis-button px-3">
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link href="/settings" className="jarvis-link-button flex-1">
                      Configuration
                    </Link>
                    <button type="button" onClick={clearChat} className="jarvis-button flex-1">
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </aside>
      </div>
    </div>
  );
}
