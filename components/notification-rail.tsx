"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNotificationsRead } from "@/app/notifications/actions";

export type RailNotification = {
  id: string;
  message: string;
  related_entity_type: string | null;
  read_at: string | null;
  created_at: string;
};

const entityLinks: Record<string, string> = {
  delivery: "/partners",
  partner_cart: "/partners",
  order_return: "/returns",
};

function timeAgo(value: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "acum";
  if (minutes < 60) return `acum ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `acum ${hours} h`;
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(value));
}

// Always-visible feed on the right. New rows arrive through NotificationListener's refresh.
export function NotificationRail({ notifications, role }: { notifications: RailNotification[]; role: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const unread = notifications.filter((item) => !item.read_at);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  // Highlight rows that appeared after the first render.
  useEffect(() => {
    if (seen.current === null) { seen.current = new Set(notifications.map((item) => item.id)); return; }
    const added = notifications.filter((item) => !seen.current!.has(item.id)).map((item) => item.id);
    added.forEach((id) => seen.current!.add(id));
    if (added.length === 0) return;
    setFresh((current) => new Set([...current, ...added]));
    const timeout = window.setTimeout(() => setFresh((current) => new Set([...current].filter((id) => !added.includes(id)))), 6000);
    return () => window.clearTimeout(timeout);
  }, [notifications]);

  const linkFor = (type: string | null) => (type === "delivery" || type === "partner_cart") && role === "operator_facturare"
    ? "/billing" : type ? entityLinks[type] : undefined;

  function markRead(ids: string[] | null) {
    startTransition(async () => {
      await markNotificationsRead(ids);
      router.refresh();
    });
  }

  return (
    <aside className="notification-rail" aria-label="Notificări în timp real">
      <div className="rail-heading">
        <div><h2>Notificări</h2><p><span className="live-dot" /> {unread.length ? `${unread.length} necitite` : "Totul e la zi"}</p></div>
        {unread.length > 0 && <button type="button" className="text-button" disabled={pending} onClick={() => markRead(null)}>Marchează toate</button>}
      </div>
      {notifications.length === 0 ? <p className="rail-empty">Nu ai notificări.</p> : <ul className="rail-list" aria-live="polite">
        {notifications.map((item) => {
          const href = linkFor(item.related_entity_type);
          return (
            <li key={item.id} className={`rail-item ${item.read_at ? "read" : ""} ${fresh.has(item.id) ? "fresh" : ""}`}>
              <span className="notification-dot" aria-hidden="true" />
              <div>
                <p>{item.message}</p>
                <small>{now === null ? "" : timeAgo(item.created_at, now)}</small>
                <span className="rail-actions">
                  {href && <Link className="text-button" href={href}>Deschide</Link>}
                  {!item.read_at && <button type="button" className="text-button" disabled={pending} onClick={() => markRead([item.id])}>Citită</button>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>}
      <Link className="rail-footer" href="/notifications">Toate notificările</Link>
    </aside>
  );
}
