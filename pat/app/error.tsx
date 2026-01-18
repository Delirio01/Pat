"use client";

import Link from "next/link";

export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  const { error, reset } = props;

  return (
    <div className="jarvis-bg h-dvh overflow-hidden" data-theme="default">
      <div className="mx-auto flex h-full w-full max-w-4xl flex-col items-center justify-center px-6 text-center">
        <div className="text-[16px] font-semibold text-[color:var(--jarvis-text)]">Page error</div>
        <div className="mt-2 max-w-[720px] text-[13px] text-[color:var(--jarvis-muted)]">
          {error?.message || "Unknown error"}
        </div>
        <div className="mt-6 flex items-center gap-2">
          <button type="button" className="jarvis-button h-10 px-4" onClick={() => reset()}>
            Retry
          </button>
          <Link href="/chat" className="jarvis-button h-10 px-4">
            Back to chat
          </Link>
        </div>
      </div>
    </div>
  );
}

