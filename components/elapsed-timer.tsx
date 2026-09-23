"use client";

import { useEffect, useState } from "react";

const limitHours = 48;

function format(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Live time since the refill request, against the 48h delivery target (display only).
export function ElapsedTimer({ since }: { since: string | null }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (!since) return <span className="partner-tag">— / {limitHours}h</span>;
  const start = new Date(since).getTime();
  const elapsed = now === null ? null : now - start;
  const hours = elapsed === null ? 0 : elapsed / 3600000;
  const tone = hours >= limitHours ? "countdown-over" : hours >= 36 ? "countdown-warn" : "";
  return (
    <span className={`partner-tag countdown-timer ${tone}`} title={`De la solicitare. Ținta de livrare este ${limitHours}h.`}>
      <span aria-hidden="true">⏱</span> <time dateTime={since}>{elapsed === null ? "…" : format(elapsed)}</time> / {limitHours}h
    </span>
  );
}
