import type { DagEdge, DagNode, Viewport } from "./types";

const STORAGE_KEY = "pat.dag.v1";

export type PersistedGraph = {
  nodes: DagNode[];
  edges: DagEdge[];
  viewport: Viewport;
  version: 1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function loadGraph(): PersistedGraph | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.version !== 1) return null;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;

    const nodes: DagNode[] = [];
    for (const n of parsed.nodes) {
      if (!isRecord(n)) continue;
      if (typeof n.id !== "string" || typeof n.title !== "string") continue;
      if (typeof n.x !== "number" || typeof n.y !== "number") continue;
      nodes.push({
        id: n.id,
        title: n.title,
        x: n.x,
        y: n.y,
        description: typeof n.description === "string" ? n.description : undefined,
        score: typeof n.score === "number" ? n.score : undefined,
        tags: Array.isArray(n.tags) ? n.tags.filter((t) => typeof t === "string") : undefined,
      });
    }

    const edges: DagEdge[] = [];
    for (const e of parsed.edges) {
      if (!isRecord(e)) continue;
      if (typeof e.id !== "string" || typeof e.source !== "string" || typeof e.target !== "string") continue;
      edges.push({ id: e.id, source: e.source, target: e.target });
    }

    const vpRaw = parsed.viewport;
    const viewport: Viewport = isRecord(vpRaw)
      ? {
          x: typeof vpRaw.x === "number" ? vpRaw.x : 0,
          y: typeof vpRaw.y === "number" ? vpRaw.y : 0,
          zoom: typeof vpRaw.zoom === "number" ? clampNumber(vpRaw.zoom, 0.2, 2.5) : 1,
        }
      : { x: 0, y: 0, zoom: 1 };

    return { nodes, edges, viewport, version: 1 };
  } catch {
    return null;
  }
}

export function saveGraph(graph: PersistedGraph) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
  } catch {
    // ignore
  }
}

