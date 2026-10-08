"use client";

import { useEffect, useState } from "react";
import { deletePushSubscription, savePushSubscription } from "@/app/notifications/push-actions";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

// Turns browser notifications on or off for this device. They arrive even when BoldHub is closed.
export function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState("unsupported"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    navigator.serviceWorker.register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState(permission === "denied" ? "denied" : "off"); return; }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const saved = await savePushSubscription(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, navigator.userAgent);
      if (!saved) { await subscription.unsubscribe(); setState("off"); return; }
      setState("on");
    } catch { setState("off"); } finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) { await deletePushSubscription(subscription.endpoint); await subscription.unsubscribe(); }
      setState("off");
    } finally { setBusy(false); }
  }

  if (state === "loading" || state === "unsupported") return null;
  if (state === "denied") return <p className="push-toggle muted">Notificările sunt blocate în browser. Le poți permite din setările site-ului.</p>;
  return <div className="push-toggle">
    <span>{state === "on" ? "Primești notificări pe acest dispozitiv." : "Primește notificări și când BoldHub e închis."}</span>
    <button type="button" className="text-button" disabled={busy} onClick={state === "on" ? disable : enable}>{state === "on" ? "Oprește" : "Activează"}</button>
  </div>;
}
