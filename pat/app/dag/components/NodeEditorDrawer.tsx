"use client";

import type { DagNode } from "./types";

function parseTags(raw: string) {
  const parts = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

export default function NodeEditorDrawer(props: {
  open: boolean;
  node: DagNode | null;
  onClose: () => void;
  onChange: (next: DagNode) => void;
  onDelete: () => void;
}) {
  const { open, node, onClose, onChange, onDelete } = props;
  if (!open || !node) return null;

  const suggestedTags = [
    "problem",
    "vision",
    "market",
    "growth",
    "gtm",
    "tech",
    "scale",
    "execution",
  ];

  return (
    <div className="pointer-events-auto absolute right-0 top-0 z-30 h-full w-[min(420px,92vw)] bg-[rgba(11,11,11,0.92)] backdrop-blur-md">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.10)] px-5 py-4">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[color:var(--jarvis-text)]">Edit node</div>
            <div className="truncate text-[12px] text-[color:var(--jarvis-muted)]">{node.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="jarvis-button h-9 px-3" onClick={onDelete}>
              Delete
            </button>
            <button type="button" className="jarvis-button h-9 px-3" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-[12px] font-medium text-[color:var(--jarvis-muted)]">Title</div>
              <input
                value={node.title}
                onChange={(e) => onChange({ ...node, title: e.target.value })}
                className="jarvis-input h-11 w-full px-3 text-[14px]"
              />
            </div>

            <div>
              <div className="mb-2 text-[12px] font-medium text-[color:var(--jarvis-muted)]">Description</div>
              <textarea
                value={node.description ?? ""}
                onChange={(e) => onChange({ ...node, description: e.target.value || undefined })}
                rows={4}
                className="jarvis-input w-full resize-none px-3 py-2 text-[14px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-2 text-[12px] font-medium text-[color:var(--jarvis-muted)]">Score</div>
                <input
                  value={node.score ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    onChange({ ...node, score: v ? Number(v) : undefined });
                  }}
                  inputMode="decimal"
                  placeholder="e.g. 0.8"
                  className="jarvis-input h-11 w-full px-3 text-[14px]"
                />
              </div>
              <div>
                <div className="mb-2 text-[12px] font-medium text-[color:var(--jarvis-muted)]">Tags</div>
                <input
                  value={(node.tags ?? []).join(", ")}
                  onChange={(e) => onChange({ ...node, tags: parseTags(e.target.value) })}
                  placeholder="market, tech, gtm"
                  list="pat-dag-tags"
                  className="jarvis-input h-11 w-full px-3 text-[14px]"
                />
                <datalist id="pat-dag-tags">
                  {suggestedTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <div className="mb-2 text-[12px] font-medium text-[color:var(--jarvis-muted)]">Quick tags</div>
              <div className="flex flex-wrap gap-2">
                {suggestedTags.map((tag) => {
                  const active = (node.tags ?? []).map((t) => t.toLowerCase()).includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={
                        active
                          ? "rounded-full border border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.07)] px-3 py-1 text-[12px] text-[color:var(--jarvis-text)]"
                          : "rounded-full border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[12px] text-[color:var(--jarvis-muted)]"
                      }
                      onClick={() => {
                        const existing = node.tags ?? [];
                        const lower = existing.map((t) => t.toLowerCase());
                        if (lower.includes(tag)) {
                          const next = existing.filter((t) => t.toLowerCase() !== tag);
                          onChange({ ...node, tags: next.length ? next : undefined });
                          return;
                        }
                        onChange({ ...node, tags: [...existing, tag] });
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-[12px] text-[color:var(--jarvis-muted)]">
                First tag drives node color (try <span className="jarvis-kbd">problem</span>,{" "}
                <span className="jarvis-kbd">growth</span>, <span className="jarvis-kbd">scale</span>).
              </div>
            </div>

            <div className="rounded-xl border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
              <div className="text-[12px] text-[color:var(--jarvis-muted)]">
                Tip: Use tags like <span className="jarvis-kbd">market</span>,{" "}
                <span className="jarvis-kbd">tech</span>,{" "}
                <span className="jarvis-kbd">gtm</span>,{" "}
                <span className="jarvis-kbd">execution</span> to color-code nodes.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
