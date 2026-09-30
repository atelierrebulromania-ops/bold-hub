"use client";

import { useState, useTransition } from "react";
import { recheckPayments } from "./actions";

export function RecheckButton() {
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="recheck">
      <button type="button" className="recheck-button" disabled={pending} onClick={() => start(async () => setFeedback(await recheckPayments()))}>
        {pending ? <span className="busy-spinner" aria-hidden="true" />
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>}
        {pending ? "Verific în BOCP…" : "Reverifică plățile"}</button>
      {feedback && <span className={`recheck-feedback ${feedback.ok ? "success" : "error"}`} role="status">{feedback.message}</span>}
    </div>
  );
}
