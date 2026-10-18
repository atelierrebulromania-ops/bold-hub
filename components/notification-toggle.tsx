"use client";

import { useEffect, useState, type ReactNode } from "react";
import { railCookie } from "@/lib/rail";

const narrowQuery = "(max-width: 1200px)";

// The bell shows or hides the notification rail. On wide screens the rail is a column and the
// choice is remembered in a cookie, so the server renders it in the right state (no flash on
// navigation); on narrow screens it opens as an overlay and starts closed.
export function NotificationToggle({ unread, icon, initialOpen }: { unread: number; icon: ReactNode; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    if (window.matchMedia(narrowQuery).matches) { setOpen(false); return; }
    // The choice used to live in localStorage: carry it over once.
    try {
      const legacy = window.localStorage.getItem("boldhub-notification-rail");
      if (legacy && !document.cookie.includes(`${railCookie}=`)) {
        document.cookie = `${railCookie}=${legacy}; path=/; max-age=31536000; samesite=lax`;
        setOpen(legacy !== "closed");
      }
      window.localStorage.removeItem("boldhub-notification-rail");
    } catch {}
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
      document.cookie = `${railCookie}=${next ? "open" : "closed"}; path=/; max-age=31536000; samesite=lax`;
    }
  }

  return (
    <button type="button" className={`bell-link ${open ? "active" : ""}`} onClick={toggle} aria-expanded={open}
      aria-label={`${open ? "Ascunde" : "Arată"} notificările${unread ? `, ${unread} necitite` : ""}`} title={open ? "Ascunde notificările" : "Arată notificările"}>
      {icon}{unread ? <span className="bell-count">{unread > 99 ? "99+" : unread}</span> : null}
    </button>
  );
}
