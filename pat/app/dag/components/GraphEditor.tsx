"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createsCycle } from "./dag";
import NodeEditorDrawer from "./NodeEditorDrawer";
import { loadGraph, saveGraph, type PersistedGraph } from "./storage";
import Toolbar from "./Toolbar";
import type { DagEdge, DagNode, Viewport } from "./types";

type Selection =
  | { type: "none" }
  | { type: "node"; id: string }
  | { type: "edge"; id: string };

type DragState =
  | { type: "none" }
  | { type: "pan"; startX: number; startY: number; origX: number; origY: number }
  | {
      type: "node";
      id: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      moved: boolean;
    };

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractCanvasActionsBlock(text: string) {
  const startTag = "<canvas_actions>";
  const endTag = "</canvas_actions>";
  const start = text.indexOf(startTag);
  const end = text.indexOf(endTag);
  if (start === -1 || end === -1 || end <= start) {
    return { visibleText: text.trim(), jsonText: null as string | null };
  }
  const jsonText = text.slice(start + startTag.length, end).trim();
  const visibleText = `${text.slice(0, start)}${text.slice(end + endTag.length)}`.trim();
  return { visibleText, jsonText };
}

function screenToGraph(p: { x: number; y: number }, viewport: Viewport) {
  return { x: (p.x - viewport.x) / viewport.zoom, y: (p.y - viewport.y) / viewport.zoom };
}

function categoryFromTags(tags?: string[]) {
  const first = (tags ?? [])[0]?.toLowerCase() ?? "";
  if (first.includes("problem")) return "problem";
  if (first.includes("market")) return "market";
  if (first.includes("tech")) return "tech";
  if (first.includes("gtm") || first.includes("growth")) return "gtm";
  if (first.includes("scale")) return "scale";
  if (first.includes("execution")) return "execution";
  if (first.includes("vision")) return "vision";
  return "default";
}

function nodeColorClass(node: DagNode) {
  const cat = categoryFromTags(node.tags);
  if (cat === "problem") return "border-[rgba(255,125,125,0.22)] bg-[rgba(255,125,125,0.06)]";
  if (cat === "market") return "border-[rgba(255,215,140,0.22)] bg-[rgba(255,215,140,0.06)]";
  if (cat === "tech") return "border-[rgba(139,243,255,0.22)] bg-[rgba(139,243,255,0.06)]";
  if (cat === "gtm") return "border-[rgba(206,255,153,0.20)] bg-[rgba(206,255,153,0.06)]";
  if (cat === "scale") return "border-[rgba(165,210,255,0.22)] bg-[rgba(165,210,255,0.06)]";
  if (cat === "execution") return "border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.05)]";
  if (cat === "vision") return "border-[rgba(210,170,255,0.20)] bg-[rgba(210,170,255,0.06)]";
  return "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)]";
}

function defaultGraph(): PersistedGraph {
  const nodes: DagNode[] = [
    { id: "vision", title: "Vision", x: -240, y: -120, tags: ["vision"] },
    { id: "market", title: "Market Entry Strategies", x: 60, y: -180, tags: ["market"] },
    { id: "arch", title: "Technical Architecture Paths", x: 60, y: -40, tags: ["tech"] },
    { id: "monetization", title: "Monetization Paths", x: 60, y: 100, tags: ["gtm"] },
    { id: "validation", title: "Validation Paths", x: 360, y: -160, tags: ["market"] },
    { id: "execution", title: "Execution Roadmap", x: 360, y: 80, tags: ["execution"] },
  ];
  const edges: DagEdge[] = [
    { id: "e1", source: "vision", target: "market" },
    { id: "e2", source: "vision", target: "arch" },
    { id: "e3", source: "vision", target: "monetization" },
    { id: "e4", source: "market", target: "validation" },
    { id: "e5", source: "monetization", target: "execution" },
    { id: "e6", source: "arch", target: "execution" },
  ];
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, version: 1 };
}

type CanvasAction =
  | { type: "add_node"; id?: string; title: string; x?: number; y?: number; description?: string; score?: number; tags?: string[] }
  | { type: "update_node"; id: string; title?: string; description?: string; score?: number; tags?: string[] }
  | { type: "move_node"; id: string; x: number; y: number }
  | { type: "delete_node"; id: string }
  | { type: "add_edge"; id?: string; source: string; target: string }
  | { type: "delete_edge"; id?: string; source?: string; target?: string }
  | { type: "auto_layout"; direction?: "LR" | "TB"; spacingX?: number; spacingY?: number };

type PatCanvasResponse = { message?: string; actions?: CanvasAction[] } | CanvasAction[];

type PatSettings = {
  model: string;
  temperature: number;
  systemPrompt: string;
  webScrapeEnabled: boolean;
};

const SETTINGS_KEY = "pat.settings.v1";
const PAT_CHAT_KEY = "pat.dag.patChat.v1";

export default function GraphEditor() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<DragState>({ type: "none" });
  const lastPointerGraphRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastMovedNodeIdRef = useRef<string | null>(null);

  const [mode, setMode] = useState<"select" | "connect">("select");
  const [nodes, setNodes] = useState<DagNode[]>([]);
  const [edges, setEdges] = useState<DagEdge[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selection, setSelection] = useState<Selection>({ type: "none" });
  const [editorOpen, setEditorOpen] = useState(false);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const [patOpen, setPatOpen] = useState(false);
  const [patBusy, setPatBusy] = useState(false);
  const [patError, setPatError] = useState<string | null>(null);
  const [patDraft, setPatDraft] = useState("");
  const [patMessages, setPatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const patScrollRef = useRef<HTMLDivElement | null>(null);

  const [undoStack, setUndoStack] = useState<Array<{ nodes: DagNode[]; edges: DagEdge[]; viewport: Viewport }>>([]);

  const selectedNode = useMemo(() => {
    if (selection.type !== "node") return null;
    return nodes.find((n) => n.id === selection.id) ?? null;
  }, [nodes, selection]);

  const deleteSelection = useCallback(() => {
    if (selection.type === "node") {
      const nodeId = selection.id;
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelection({ type: "none" });
      setEditorOpen(false);
      setConnectFrom(null);
    } else if (selection.type === "edge") {
      const edgeId = selection.id;
      setEdges((prev) => prev.filter((e) => e.id !== edgeId));
      setSelection({ type: "none" });
    }
  }, [selection]);

  function readSettings(): PatSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) {
        return {
          model: "grok-3",
          temperature: 0.3,
          systemPrompt:
            "You are Grok. Be direct, helpful, and technical. Use short, actionable answers. Ask clarifying questions when needed.",
          webScrapeEnabled: false,
        };
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) throw new Error("Invalid settings");
      const model = typeof parsed.model === "string" ? parsed.model : "grok-3";
      const temperature = typeof parsed.temperature === "number" ? parsed.temperature : 0.3;
      const systemPrompt =
        typeof parsed.systemPrompt === "string"
          ? parsed.systemPrompt
          : "You are Grok. Be direct, helpful, and technical.";
      const webScrapeEnabled = typeof parsed.webScrapeEnabled === "boolean" ? parsed.webScrapeEnabled : false;
      return { model, temperature, systemPrompt, webScrapeEnabled };
    } catch {
      return {
        model: "grok-3",
        temperature: 0.3,
        systemPrompt:
          "You are Grok. Be direct, helpful, and technical. Use short, actionable answers. Ask clarifying questions when needed.",
        webScrapeEnabled: false,
      };
    }
  }

  function unwrapJsonCandidate(text: string) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return (fenced?.[1] ?? trimmed).trim();
  }

  function parsePatJson(text: string): PatCanvasResponse | null {
    const candidate = unwrapJsonCandidate(text);
    const firstBrace = candidate.indexOf("{");
    const firstBracket = candidate.indexOf("[");
    const start =
      firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace) ? firstBracket : firstBrace;
    if (start === -1) return null;
    const end = candidate.lastIndexOf(start === firstBracket ? "]" : "}");
    if (end === -1 || end <= start) return null;
    const jsonText = candidate.slice(start, end + 1);
    try {
      return JSON.parse(jsonText) as PatCanvasResponse;
    } catch {
      return null;
    }
  }

  function ensureId(preferred: string | undefined, used: Set<string>) {
    const base = (preferred || uid()).replace(/\s+/g, "-").slice(0, 64) || uid();
    if (!used.has(base)) return base;
    for (let i = 2; i < 9999; i += 1) {
      const next = `${base}-${i}`;
      if (!used.has(next)) return next;
    }
    return uid();
  }

  function applyAutoLayout(nextNodes: DagNode[], nextEdges: DagEdge[], direction: "LR" | "TB", spacingX: number, spacingY: number) {
    const byId = new Map(nextNodes.map((n) => [n.id, n]));
    const indeg = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nextNodes) {
      indeg.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of nextEdges) {
      if (!byId.has(e.source) || !byId.has(e.target)) continue;
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      (adj.get(e.source) ?? []).push(e.target);
    }

    const queue: string[] = [];
    for (const [id, d] of indeg.entries()) if (d === 0) queue.push(id);

    const topo: string[] = [];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur) break;
      topo.push(cur);
      for (const nxt of adj.get(cur) ?? []) {
        const nd = (indeg.get(nxt) ?? 0) - 1;
        indeg.set(nxt, nd);
        if (nd === 0) queue.push(nxt);
      }
    }

    const layer = new Map<string, number>();
    for (const id of topo) layer.set(id, 0);
    for (const id of topo) {
      const base = layer.get(id) ?? 0;
      for (const nxt of adj.get(id) ?? []) {
        layer.set(nxt, Math.max(layer.get(nxt) ?? 0, base + 1));
      }
    }

    const groups = new Map<number, DagNode[]>();
    for (const n of nextNodes) {
      const l = layer.get(n.id) ?? 0;
      const g = groups.get(l) ?? [];
      g.push(n);
      groups.set(l, g);
    }

    for (const g of groups.values()) g.sort((a, b) => a.y - b.y);

    const layers = Array.from(groups.keys()).sort((a, b) => a - b);
    const laidOut: DagNode[] = [];
    for (const l of layers) {
      const g = groups.get(l) ?? [];
      for (let i = 0; i < g.length; i += 1) {
        const n = g[i];
        const x = direction === "LR" ? l * spacingX : i * spacingX;
        const y = direction === "LR" ? i * spacingY : l * spacingY;
        laidOut.push({ ...n, x, y });
      }
    }

    const byId2 = new Map(laidOut.map((n) => [n.id, n]));
    return nextNodes.map((n) => byId2.get(n.id) ?? n);
  }

  function applyCanvasActions(actions: CanvasAction[], options?: { origin?: { x: number; y: number } }) {
    const origin = options?.origin ?? { x: 0, y: 0 };
    const nextNodes = nodes.slice();
    const nextEdges = edges.slice();
    const usedNodeIds = new Set(nextNodes.map((n) => n.id));
    const usedEdgeIds = new Set(nextEdges.map((e) => e.id));

    const findNode = (id: string) => nextNodes.find((n) => n.id === id) ?? null;

    let added = 0;
    let updated = 0;
    let moved = 0;
    let deleted = 0;
    let edgeAdded = 0;
    let edgeDeleted = 0;

    for (const act of actions) {
      if (!act || typeof act !== "object") continue;

      if (act.type === "add_node") {
        const id = ensureId(act.id, usedNodeIds);
        usedNodeIds.add(id);
        nextNodes.push({
          id,
          title: act.title || "New node",
          x: typeof act.x === "number" ? act.x : origin.x + 40 * (added + 1),
          y: typeof act.y === "number" ? act.y : origin.y + 34 * (added + 1),
          description: act.description,
          score: typeof act.score === "number" ? act.score : undefined,
          tags: Array.isArray(act.tags) ? act.tags.filter((t) => typeof t === "string") : undefined,
        });
        added += 1;
        continue;
      }

      if (act.type === "update_node") {
        const n = findNode(act.id);
        if (!n) continue;
        Object.assign(n, {
          title: typeof act.title === "string" ? act.title : n.title,
          description: typeof act.description === "string" ? act.description : n.description,
          score: typeof act.score === "number" ? act.score : n.score,
          tags: Array.isArray(act.tags) ? act.tags.filter((t) => typeof t === "string") : n.tags,
        });
        updated += 1;
        continue;
      }

      if (act.type === "move_node") {
        const n = findNode(act.id);
        if (!n) continue;
        n.x = act.x;
        n.y = act.y;
        moved += 1;
        continue;
      }

      if (act.type === "delete_node") {
        const idx = nextNodes.findIndex((n) => n.id === act.id);
        if (idx === -1) continue;
        nextNodes.splice(idx, 1);
        for (let i = nextEdges.length - 1; i >= 0; i -= 1) {
          const e = nextEdges[i];
          if (e.source === act.id || e.target === act.id) nextEdges.splice(i, 1);
        }
        deleted += 1;
        continue;
      }

      if (act.type === "add_edge") {
        if (!usedNodeIds.has(act.source) || !usedNodeIds.has(act.target)) continue;
        if (createsCycle(nextEdges, act.source, act.target)) continue;
        const id = ensureId(act.id, usedEdgeIds);
        usedEdgeIds.add(id);
        nextEdges.push({ id, source: act.source, target: act.target });
        edgeAdded += 1;
        continue;
      }

      if (act.type === "delete_edge") {
        const before = nextEdges.length;
        if (act.id) {
          for (let i = nextEdges.length - 1; i >= 0; i -= 1) {
            if (nextEdges[i]?.id === act.id) nextEdges.splice(i, 1);
          }
        } else if (act.source && act.target) {
          for (let i = nextEdges.length - 1; i >= 0; i -= 1) {
            const e = nextEdges[i];
            if (e?.source === act.source && e?.target === act.target) nextEdges.splice(i, 1);
          }
        }
        edgeDeleted += before - nextEdges.length;
        continue;
      }

      if (act.type === "auto_layout") {
        const direction = act.direction === "TB" ? "TB" : "LR";
        const spacingX = typeof act.spacingX === "number" ? clampNumber(act.spacingX, 180, 520) : 320;
        const spacingY = typeof act.spacingY === "number" ? clampNumber(act.spacingY, 120, 420) : 160;
        const laidOut = applyAutoLayout(nextNodes, nextEdges, direction, spacingX, spacingY);
        nextNodes.splice(0, nextNodes.length, ...laidOut);
        continue;
      }
    }

    if (
      added ||
      updated ||
      moved ||
      deleted ||
      edgeAdded ||
      edgeDeleted
    ) {
      setUndoStack((prev) => [...prev.slice(-9), { nodes, edges, viewport }]);
      setNodes(nextNodes);
      setEdges(nextEdges);
      setToast(
        `Applied: ${added} add, ${updated} edit, ${moved} move, ${deleted} delete, ${edgeAdded} edge+, ${edgeDeleted} edge-`,
      );
    } else {
      setToast("No canvas changes applied.");
    }
  }

  async function sendToPat(text: string) {
    const question = text.trim();
    if (!question || patBusy) return;

    setPatBusy(true);
    setPatError(null);

    const settings = readSettings();
    const graphContext = {
      nodes: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        description: n.description ?? "",
        score: typeof n.score === "number" ? n.score : null,
        tags: n.tags ?? [],
        x: n.x,
        y: n.y,
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };

    const instructions = [
      "You are Pat, a collaborative agent embedded in a startup strategy DAG canvas.",
      "Speak normally and keep the conversation going: ask clarifying questions, propose options, and check alignment.",
      "If (and only if) you want to change the canvas, include a JSON action payload inside this tag block and nowhere else:",
      "<canvas_actions>{\"message\":\"short summary\",\"actions\":[...]}</canvas_actions>",
      "Do NOT mention or explain the JSON block in your visible response.",
      "Your job: reorganize the graph, add/rename/edit nodes, add/remove edges, create clearer branching paths, and reduce decision fog.",
      "DAG rule: never create cycles.",
      "",
      "Action payload schema (inside <canvas_actions>):",
      `{ "message": "short summary", "actions": [ ... ] } OR [ ...actions ]`,
      "Action types:",
      "- add_node {type,id?,title,x?,y?,description?,score?,tags?}",
      "- update_node {type,id,title?,description?,score?,tags?}",
      "- move_node {type,id,x,y}",
      "- delete_node {type,id}",
      "- add_edge {type,id?,source,target}",
      "- delete_edge {type,id? OR source+target}",
      "- auto_layout {type,direction:\"LR\"|\"TB\",spacingX?,spacingY?}",
      "",
      "Prefer minimal, high-impact edits. Ask before big restructures. If you need clarification, keep actions empty.",
    ].join("\n");

    const history = patMessages.slice(-14).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const messages = [
      { role: "system" as const, content: `${settings.systemPrompt}\n\n${instructions}` },
      { role: "system" as const, content: `Current DAG canvas:\n${JSON.stringify(graphContext)}` },
      ...history,
      { role: "user" as const, content: question },
    ];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: settings.model,
          temperature: clampNumber(settings.temperature, 0, 1.2),
          messages,
          tools: { firecrawl: settings.webScrapeEnabled, github: false, githubRepo: null },
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | { ok: true; message: { role: "assistant"; content: string } }
        | { ok: false; error: string }
        | null;

      if (!res.ok || !data || data.ok !== true) {
        throw new Error((data && "error" in data && data.error) || `Request failed (${res.status})`);
      }

      const raw = data.message.content || "";
      const { visibleText, jsonText } = extractCanvasActionsBlock(raw);
      setPatMessages((prev) => [...prev, { role: "assistant", content: visibleText || "…" }]);

      if (!jsonText) return;
      const parsed = parsePatJson(jsonText);
      if (!parsed) {
        setPatError("Pat included a canvas action block but it wasn't valid JSON.");
        return;
      }

      const actionsUnknown = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { actions?: unknown }).actions)
          ? ((parsed as { actions: unknown[] }).actions as unknown[])
          : [];

      const normalized: CanvasAction[] = [];
      for (const a of actionsUnknown) {
        if (!isRecord(a) || typeof a.type !== "string") continue;
        normalized.push(a as unknown as CanvasAction);
      }

      if (!normalized.length) return;

      applyCanvasActions(normalized, { origin: lastPointerGraphRef.current });
      if (!Array.isArray(parsed) && typeof (parsed as { message?: unknown }).message === "string") {
        setToast((parsed as { message: string }).message);
      }
    } catch (e) {
      setPatError(e instanceof Error ? e.message : "Ask Pat failed.");
    } finally {
      setPatBusy(false);
    }
  }

  function undoLast() {
    setUndoStack((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      setNodes(last.nodes);
      setEdges(last.edges);
      setViewport(last.viewport);
      setToast("Undone.");
      return prev.slice(0, -1);
    });
  }

  useEffect(() => {
    const loaded = loadGraph() ?? defaultGraph();
    setNodes(loaded.nodes);
    setEdges(loaded.edges);
    setViewport(loaded.viewport);
    viewportRef.current = loaded.viewport;
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PAT_CHAT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const loaded: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const item of parsed) {
        if (!isRecord(item)) continue;
        if (item.role !== "user" && item.role !== "assistant") continue;
        if (typeof item.content !== "string") continue;
        loaded.push({ role: item.role, content: item.content });
      }
      if (loaded.length) setPatMessages(loaded.slice(-40));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PAT_CHAT_KEY, JSON.stringify(patMessages.slice(-60)));
    } catch {
      // ignore
    }
  }, [patMessages]);

  useEffect(() => {
    patScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [patMessages, patBusy]);

  useEffect(() => {
    viewportRef.current = viewport;
    saveGraph({ nodes, edges, viewport, version: 1 });
  }, [edges, nodes, viewport]);

  useEffect(() => {
    if (!rootRef.current) return;
    // Fit to view on first load if viewport is default-ish.
    if (nodes.length === 0) return;
    const v = viewportRef.current;
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || Math.abs(v.zoom - 1) > 0.001) return;
    fitToView(nodes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConnectFrom(null);
        setMode("select");
        setSelection({ type: "none" });
        setEditorOpen(false);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
        if ((e.target as HTMLElement | null)?.tagName === "TEXTAREA") return;
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  function fitToView(nextNodes: DagNode[]) {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nextNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    if (!Number.isFinite(minX)) return;

    const padding = 180;
    const width = Math.max(1, maxX - minX + padding);
    const height = Math.max(1, maxY - minY + padding);
    const zx = rect.width / width;
    const zy = rect.height / height;
    const zoom = clampNumber(Math.min(zx, zy), 0.35, 1.2);

    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const screenCenter = { x: rect.width / 2, y: rect.height / 2 };
    const x = screenCenter.x - center.x * zoom;
    const y = screenCenter.y - center.y * zoom;
    setViewport({ x, y, zoom });
  }

  function createNodeAt(graphPos: { x: number; y: number }) {
    const id = uid();
    const node: DagNode = {
      id,
      title: "New node",
      x: graphPos.x,
      y: graphPos.y,
      tags: ["execution"],
      description: "",
    };
    setNodes((prev) => [...prev, node]);
    setSelection({ type: "node", id });
    setEditorOpen(true);
  }

  function addEdge(source: string, target: string) {
    if (createsCycle(edges, source, target)) {
      setToast("Rejected: would create a cycle.");
      return;
    }
    const id = uid();
    setEdges((prev) => [...prev, { id, source, target }]);
  }

  function onCanvasDoubleClick(e: React.MouseEvent) {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const graph = screenToGraph(screen, viewportRef.current);
    createNodeAt(graph);
  }

  function onCanvasPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement | null)?.closest?.("[data-node]")) return;
    const root = rootRef.current;
    if (!root) return;

    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      type: "pan",
      startX: e.clientX,
      startY: e.clientY,
      origX: viewportRef.current.x,
      origY: viewportRef.current.y,
    };
    setSelection({ type: "none" });
    setEditorOpen(false);
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    lastPointerGraphRef.current = screenToGraph(screen, viewportRef.current);

    const d = dragRef.current;
    if (d.type === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setViewport((prev) => ({ ...prev, x: d.origX + dx, y: d.origY + dy }));
    } else if (d.type === "node") {
      const movedDistance = Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY);
      if (movedDistance > 4) d.moved = true;
      const dx = (e.clientX - d.startX) / viewportRef.current.zoom;
      const dy = (e.clientY - d.startY) / viewportRef.current.zoom;
      setNodes((prev) =>
        prev.map((n) => (n.id === d.id ? { ...n, x: d.origX + dx, y: d.origY + dy } : n)),
      );
    }
  }

  function onCanvasPointerUp() {
    const d = dragRef.current;
    if (d.type === "node" && d.moved) {
      lastMovedNodeIdRef.current = d.id;
      window.setTimeout(() => {
        if (lastMovedNodeIdRef.current === d.id) lastMovedNodeIdRef.current = null;
      }, 0);
    }
    dragRef.current = { type: "none" };
  }

  function onWheel(e: React.WheelEvent) {
    const root = rootRef.current;
    if (!root) return;
    e.preventDefault();
    const rect = root.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const prev = viewportRef.current;
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.08 : 0.92;
    const nextZoom = clampNumber(prev.zoom * factor, 0.25, 2.5);

    const before = screenToGraph(screen, prev);
    const nextX = screen.x - before.x * nextZoom;
    const nextY = screen.y - before.y * nextZoom;
    setViewport({ x: nextX, y: nextY, zoom: nextZoom });
  }

  function onNodePointerDown(e: React.PointerEvent, node: DagNode) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      type: "node",
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
      moved: false,
    };
    setSelection({ type: "node", id: node.id });
  }

  function onNodeClick(node: DagNode) {
    if (lastMovedNodeIdRef.current === node.id) {
      lastMovedNodeIdRef.current = null;
      return;
    }
    if (mode === "connect") {
      if (!connectFrom) {
        setConnectFrom(node.id);
        setToast("Select a target node.");
        return;
      }
      if (connectFrom === node.id) {
        setToast("Pick a different target.");
        return;
      }
      addEdge(connectFrom, node.id);
      setConnectFrom(null);
      setMode("select");
      return;
    }
    setSelection({ type: "node", id: node.id });
    setEditorOpen(true);
  }

  function onNodeDoubleClick(node: DagNode) {
    setSelection({ type: "node", id: node.id });
    setEditorOpen(true);
  }

  const connectPreview = useMemo(() => {
    if (!connectFrom) return null;
    const source = nodes.find((n) => n.id === connectFrom);
    if (!source) return null;
    const target = lastPointerGraphRef.current;
    return { source, target };
  }, [connectFrom, nodes]);

  const edgePaths = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return edges
      .map((e) => {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        if (!s || !t) return null;
        const sx = s.x + 140;
        const sy = s.y + 28;
        const tx = t.x;
        const ty = t.y + 28;
        const dx = Math.max(80, Math.abs(tx - sx) * 0.5);
        const c1 = { x: sx + dx, y: sy };
        const c2 = { x: tx - dx, y: ty };
        const d = `M ${sx} ${sy} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${tx} ${ty}`;
        return { edge: e, d };
      })
      .filter(Boolean) as Array<{ edge: DagEdge; d: string }>;
  }, [edges, nodes]);

  const gridStyle = useMemo(() => {
    const size = 44 * viewport.zoom;
    const x = viewport.x % size;
    const y = viewport.y % size;
    return {
      backgroundImage:
        "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.08) 1px, rgba(0,0,0,0) 1px)",
      backgroundSize: `${size}px ${size}px`,
      backgroundPosition: `${x}px ${y}px`,
    } as const;
  }, [viewport.x, viewport.y, viewport.zoom]);

  function exportJson() {
    const payload = JSON.stringify({ nodes, edges }, null, 2);
    try {
      navigator.clipboard.writeText(payload).catch(() => {});
    } catch {
      // ignore
    }
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pat-dag.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("Exported JSON (downloaded + copied).");
  }

  function openImport() {
    setImportText("");
    setImportOpen(true);
  }

  function applyImport() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setToast("Invalid JSON.");
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      setToast("Invalid JSON.");
      return;
    }
    const rec = parsed as Record<string, unknown>;
    if (!Array.isArray(rec.nodes) || !Array.isArray(rec.edges)) {
      setToast("JSON must include nodes[] and edges[].");
      return;
    }

    const nextNodes: DagNode[] = [];
    for (const n of rec.nodes) {
      if (!n || typeof n !== "object") continue;
      const nn = n as Record<string, unknown>;
      if (typeof nn.id !== "string" || typeof nn.title !== "string") continue;
      if (typeof nn.x !== "number" || typeof nn.y !== "number") continue;
      nextNodes.push({
        id: nn.id,
        title: nn.title,
        x: nn.x,
        y: nn.y,
        description: typeof nn.description === "string" ? nn.description : undefined,
        score: typeof nn.score === "number" ? nn.score : undefined,
        tags: Array.isArray(nn.tags) ? nn.tags.filter((t) => typeof t === "string") : undefined,
      });
    }

    const nodeIds = new Set(nextNodes.map((n) => n.id));
    const nextEdges: DagEdge[] = [];
    for (const e of rec.edges) {
      if (!e || typeof e !== "object") continue;
      const ee = e as Record<string, unknown>;
      if (typeof ee.id !== "string" || typeof ee.source !== "string" || typeof ee.target !== "string") continue;
      if (!nodeIds.has(ee.source) || !nodeIds.has(ee.target)) continue;
      if (createsCycle(nextEdges, ee.source, ee.target)) continue;
      nextEdges.push({ id: ee.id, source: ee.source, target: ee.target });
    }

    setNodes(nextNodes);
    setEdges(nextEdges);
    setImportOpen(false);
    setSelection({ type: "none" });
    setConnectFrom(null);
    window.setTimeout(() => fitToView(nextNodes), 0);
    setToast("Imported.");
  }

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute left-0 top-0 z-20 w-full">
          <div className="pointer-events-auto border-b border-[rgba(255,255,255,0.10)] bg-[rgba(0,0,0,0.55)] backdrop-blur-md">
          <Toolbar
            mode={mode}
            onMode={setMode}
            onAddNode={() => {
              const base = { x: 0, y: 0 };
              const g = screenToGraph(base, viewportRef.current);
              createNodeAt({ x: g.x + 40, y: g.y + 40 });
            }}
            onDelete={deleteSelection}
            onAskPat={() => {
              setPatError(null);
              setPatOpen((v) => !v);
            }}
            askPatActive={patOpen}
            onZoomIn={() => setViewport((v) => ({ ...v, zoom: clampNumber(v.zoom * 1.12, 0.25, 2.5) }))}
            onZoomOut={() => setViewport((v) => ({ ...v, zoom: clampNumber(v.zoom / 1.12, 0.25, 2.5) }))}
            onCenter={() => fitToView(nodes)}
            onExport={exportJson}
            onImport={openImport}
            viewport={viewport}
            backHref="/chat"
          />
          </div>
        </div>

        <div
          ref={rootRef}
          className="absolute inset-0"
          style={gridStyle}
          onDoubleClick={onCanvasDoubleClick}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onWheel={onWheel}
        >
          <div
            className="absolute left-0 top-0 h-full w-full"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
              transformOrigin: "0 0",
            }}
          >
            <svg className="absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.45)" />
                </marker>
              </defs>

              {edgePaths.map(({ edge, d }) => (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  stroke={
                    selection.type === "edge" && selection.id === edge.id
                      ? "rgba(255,255,255,0.70)"
                      : "rgba(255,255,255,0.38)"
                  }
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelection({ type: "edge", id: edge.id });
                  }}
                  style={{ cursor: "pointer" }}
                />
              ))}

              {connectPreview ? (
                <path
                  d={`M ${connectPreview.source.x + 140} ${connectPreview.source.y + 28} C ${connectPreview.source.x + 220} ${
                    connectPreview.source.y + 28
                  }, ${connectPreview.target.x - 220} ${connectPreview.target.y}, ${connectPreview.target.x} ${
                    connectPreview.target.y
                  }`}
                  fill="none"
                  stroke="rgba(255,255,255,0.22)"
                  strokeWidth={2}
                  strokeDasharray="6 6"
                />
              ) : null}
            </svg>

            {nodes.map((n) => {
              const isSelected = selection.type === "node" && selection.id === n.id;
              const isConnectFrom = connectFrom === n.id;
              return (
                <div
                  key={n.id}
                  data-node
                  className={[
                    "absolute select-none rounded-2xl border px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.35)]",
                    nodeColorClass(n),
                    isSelected ? "ring-2 ring-[rgba(255,255,255,0.18)]" : "",
                    isConnectFrom ? "ring-2 ring-[rgba(255,255,255,0.22)]" : "",
                  ].join(" ")}
                  style={{ left: n.x, top: n.y, width: 220 }}
                  onPointerDown={(e) => onNodePointerDown(e, n)}
                  onClick={() => onNodeClick(n)}
                  onDoubleClick={() => onNodeDoubleClick(n)}
                  title={n.description ? n.description : n.title}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[color:var(--jarvis-text)]">
                        {n.title}
                      </div>
                      <div className="mt-1 max-h-10 overflow-hidden text-ellipsis text-[12px] leading-5 text-[color:var(--jarvis-muted)]">
                        {n.description ? n.description : (n.tags ?? []).slice(0, 3).join(", ")}
                      </div>
                    </div>
                    <div className="text-[11px] font-medium text-[color:var(--jarvis-muted)]">
                      {typeof n.score === "number" ? n.score.toFixed(2) : ""}
                    </div>
                  </div>
                  {(n.tags ?? []).length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(n.tags ?? []).slice(0, 3).map((t) => (
                        <span
                          key={`${n.id}-${t}`}
                          className="rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] px-2 py-0.5 text-[11px] text-[color:var(--jarvis-muted)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

      <NodeEditorDrawer
        open={editorOpen && selection.type === "node"}
        node={selectedNode}
        onClose={() => setEditorOpen(false)}
        onDelete={() => deleteSelection()}
        onChange={(next) => {
          setNodes((prev) => prev.map((n) => (n.id === next.id ? next : n)));
        }}
      />

      {importOpen ? (
        <div className="pointer-events-auto absolute inset-0 z-40 bg-[rgba(0,0,0,0.72)] backdrop-blur-sm">
          <div className="mx-auto mt-24 w-[min(720px,94vw)] rounded-2xl border border-[rgba(255,255,255,0.10)] bg-[rgba(11,11,11,0.92)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-semibold text-[color:var(--jarvis-text)]">Import JSON</div>
              <button type="button" className="jarvis-button h-9 px-3" onClick={() => setImportOpen(false)}>
                Close
              </button>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={10}
              placeholder='Paste JSON like {"nodes":[...],"edges":[...]}'
              className="jarvis-input mt-4 w-full resize-none px-3 py-2 text-[13px]"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" className="jarvis-button h-10 px-4" onClick={applyImport}>
                Import
              </button>
            </div>
            <div className="mt-3 text-[12px] text-[color:var(--jarvis-muted)]">
              Cycle-causing edges are skipped automatically.
            </div>
          </div>
        </div>
      ) : null}

      </div>

      <aside
        className="jarvis-right-sidebar jarvis-dag-pat"
        data-collapsed={patOpen ? "false" : "true"}
        style={{ width: patOpen ? 360 : 0 }}
        aria-label="Pat canvas chat"
      >
        <div className="jarvis-dag-pat-header">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[color:var(--jarvis-text)]">Pat</div>
            <div className="truncate text-[12px] text-[color:var(--jarvis-muted)]">Canvas copilot</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="jarvis-button h-9 px-3"
              onClick={undoLast}
              disabled={!undoStack.length}
              title={!undoStack.length ? "Nothing to undo" : "Undo last applied change"}
            >
              Undo
            </button>
            <button
              type="button"
              className="jarvis-button h-9 px-3"
              onClick={() => {
                setPatMessages([]);
                setPatDraft("");
                setPatError(null);
                setToast("Pat chat cleared.");
              }}
              title="Clear Pat chat"
            >
              Clear
            </button>
            <button
              type="button"
              className="jarvis-button h-9 px-3"
              onClick={() => setPatOpen(false)}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="jarvis-dag-pat-body">
          <div className="space-y-3">
            {patMessages.length ? null : (
              <div className="text-[12px] text-[color:var(--jarvis-muted)]">
                Start with: “Summarize this DAG and propose 3 clearer paths.”
              </div>
            )}
            {patMessages.map((m, idx) => (
              <div
                key={`${m.role}-${idx}`}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    m.role === "user"
                      ? "jarvis-dag-pat-bubble jarvis-dag-pat-bubble-user"
                      : "jarvis-dag-pat-bubble jarvis-dag-pat-bubble-pat"
                  }
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ))}
            {patBusy ? (
              <div className="text-[12px] text-[color:var(--jarvis-muted)]">Pat is thinking…</div>
            ) : null}
            {patError ? <div className="jarvis-error text-sm">{patError}</div> : null}
            <div ref={patScrollRef} />
          </div>
        </div>

        <div className="jarvis-dag-pat-input">
          <textarea
            value={patDraft}
            onChange={(e) => setPatDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const text = patDraft.trim();
                if (!text) return;
                setPatMessages((prev) => [...prev, { role: "user", content: text }]);
                setPatDraft("");
                void sendToPat(text);
              }
            }}
            rows={3}
            placeholder="Ask Pat…"
            className="jarvis-dag-pat-textarea"
          />
          <div className="jarvis-dag-pat-inputbar">
            <div className="text-[12px] text-[color:var(--jarvis-muted)]">Enter to send</div>
            <button
              type="button"
              className="jarvis-button h-9 px-3"
              disabled={patBusy || !patDraft.trim()}
              onClick={() => {
                const text = patDraft.trim();
                if (!text) return;
                setPatMessages((prev) => [...prev, { role: "user", content: text }]);
                setPatDraft("");
                void sendToPat(text);
              }}
            >
              Send
            </button>
          </div>
        </div>
      </aside>

      {toast ? (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2">
          <div className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(11,11,11,0.70)] px-4 py-2 text-[12px] text-[color:var(--jarvis-text)] backdrop-blur-md">
            {toast}
          </div>
        </div>
      ) : null}

      {mode === "connect" ? (
        <div className="pointer-events-none absolute bottom-6 right-6 z-30 hidden md:block">
          <div className="rounded-xl border border-[rgba(255,255,255,0.10)] bg-[rgba(11,11,11,0.70)] px-4 py-3 text-[12px] text-[color:var(--jarvis-muted)] backdrop-blur-md">
            Connect mode: click a source node, then a target node.
          </div>
        </div>
      ) : null}
    </div>
  );
}
