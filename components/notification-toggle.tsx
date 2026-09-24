"use client";

import { useEffect, useState, type ReactNode } from "react";

const storageKey = "boldhub-notification-rail";
const narrowQuery = "(max-width: 1200px)";

// The bell shows or hides the notification rail. On wide screens the rail is a column and the
// choice is remembered; on narrow screens it opens as an overlay and starts closed.
export function NotificationToggle({ unread, icon }: { unread: number; icon: ReactNode }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem(storageKey); } catch {}
    setOpen(window.matchMedia(narrowQuery).matches ? false : saved !== "closed");
  }, []);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".app-shell");
    if (!shell) return;
    const narrow = window.matchMedia(narrowQuery).matches;
    shell.dataset.rail = open ? (narrow ? "overlay" : "open") : "closed";
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!window.matchMedia(narrowQuery).matches) {
      try { window.localStorage.setItem(storageKey, next ? "open" : "closed"); } catch {}
    }
  }

  return (
    <button type="button" className={`bell-link ${open ? "active" : ""}`} onClick={toggle} aria-expanded={open}
      aria-label={`${open ? "Ascunde" : "Arată"} notificările${unread ? `, ${unread} necitite` : ""}`} title={open ? "Ascunde notificările" : "Arată notificările"}>
      {icon}{unread ? <span className="bell-count">{unread > 99 ? "99+" : unread}</span> : null}
    </button>
  );
}
