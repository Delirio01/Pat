"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const AUTH_KEY = "pat.auth.v1";
const PASSWORD = "12345";

function safeSessionGet(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export default function EntryGate() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [focused, setFocused] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const barClassName = useMemo(() => {
    const base =
      "fixed left-1/2 w-[min(560px,92vw)] transition-all duration-300 ease-out";
    const pos = focused
      ? "top-1/2 -translate-x-1/2 -translate-y-1/2"
      : "top-[65%] -translate-x-1/2 -translate-y-1/2";
    return `${base} ${pos}`;
  }, [focused]);

  useEffect(() => {
    const authed = safeSessionGet(AUTH_KEY);
    if (authed === "1") router.replace("/chat");
  }, [router]);

  function submit() {
    const trimmed = password.trim();
    if (!trimmed) return;
    if (trimmed !== PASSWORD) {
      setError("Incorrect password.");
      return;
    }
    safeSessionSet(AUTH_KEY, "1");
    router.replace("/chat");
  }

  return (
    <div className="jarvis-bg h-dvh overflow-hidden" data-theme="default">
      <main className="relative mx-auto flex h-full w-full max-w-7xl flex-col px-6 py-10 md:px-10">
        <div className="flex flex-1 flex-col items-center justify-start pt-20 text-center md:pt-24">
          <h1 className="text-[42px] font-semibold tracking-tight text-[color:var(--jarvis-text)] md:text-[56px]">
            Pat for Delirio
          </h1>
          <p className="mt-4 max-w-[720px] text-[14px] leading-6 text-[color:var(--jarvis-muted)] opacity-50 md:text-[15px]">
            A central working agent for brainstorming and decisivness
          </p>
        </div>
      </main>

      <div className={barClassName}>
        <div className="jarvis-gate-bar">
          <input
            ref={inputRef}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            type="password"
            placeholder="Enter password…"
            className="jarvis-gate-input"
            aria-label="Password"
          />
          {error ? <div className="jarvis-error mt-3 text-sm">{error}</div> : null}
        </div>
      </div>
    </div>
  );
}
