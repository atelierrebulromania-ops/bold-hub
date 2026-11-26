"use client";

import { useState } from "react";

// Copies a link or a code to the clipboard and says so for two seconds.
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState(""), 2000);
  }
  return (
    <button type="button" className="button button-outline dv-copy" onClick={copy} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}
