"use client";

import Link from "next/link";
import type { Viewport } from "./types";

export default function Toolbar(props: {
  mode: "select" | "connect";
  onMode: (mode: "select" | "connect") => void;
  onAddNode: () => void;
  onDelete: () => void;
  onAskPat?: () => void;
  askPatActive?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenter: () => void;
  onExport: () => void;
  onImport: () => void;
  viewport: Viewport;
  backHref?: string;
}) {
  const {
    mode,
    onMode,
    onAddNode,
    onDelete,
    onAskPat,
    askPatActive,
    onZoomIn,
    onZoomOut,
    onCenter,
    onExport,
    onImport,
    viewport,
    backHref,
  } = props;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-6 py-3 md:flex-row md:items-center md:justify-between md:px-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {backHref ? (
            <Link href={backHref} className="jarvis-button h-10 px-3">
              ← Chat
            </Link>
          ) : null}
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[color:var(--jarvis-text)]">
              Startup DAG Strategy Mapper
            </div>
            <div className="text-[12px] text-[color:var(--jarvis-muted)]">
              {Math.round(viewport.zoom * 100)}% • Drag, connect, branch
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {onAskPat ? (
          <button
            type="button"
            className={askPatActive ? "jarvis-button h-10 px-3" : "jarvis-button h-10 px-3 opacity-75"}
            onClick={onAskPat}
            aria-pressed={askPatActive}
          >
            Pat
          </button>
        ) : null}
        <button type="button" className="jarvis-button h-10 px-3" onClick={onAddNode}>
          Add
        </button>
        <button
          type="button"
          className={mode === "connect" ? "jarvis-button h-10 px-3" : "jarvis-button h-10 px-3 opacity-75"}
          onClick={() => onMode(mode === "connect" ? "select" : "connect")}
          aria-pressed={mode === "connect"}
          title="Connect nodes"
        >
          Connect
        </button>
        <button type="button" className="jarvis-button h-10 px-3" onClick={onDelete}>
          Delete
        </button>
        <div className="mx-1 hidden h-6 w-px bg-[rgba(255,255,255,0.10)] md:block" />
        <button type="button" className="jarvis-button h-10 px-3" onClick={onZoomOut}>
          –
        </button>
        <button type="button" className="jarvis-button h-10 px-3" onClick={onZoomIn}>
          +
        </button>
        <button type="button" className="jarvis-button h-10 px-3" onClick={onCenter}>
          Center
        </button>
        <div className="mx-1 hidden h-6 w-px bg-[rgba(255,255,255,0.10)] md:block" />
        <button type="button" className="jarvis-button h-10 px-3" onClick={onExport}>
          Export
        </button>
        <button type="button" className="jarvis-button h-10 px-3" onClick={onImport}>
          Import
        </button>
      </div>
    </div>
  );
}
