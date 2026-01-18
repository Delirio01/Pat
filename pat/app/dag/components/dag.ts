import type { DagEdge } from "./types";

export function createsCycle(edges: DagEdge[], source: string, target: string) {
  // Adding source -> target creates a cycle if target can already reach source.
  if (source === target) return true;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }

  const stack: string[] = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const next = adj.get(cur) ?? [];
    for (const n of next) stack.push(n);
  }

  return false;
}

