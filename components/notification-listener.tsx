"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type NotificationRow = { message: string; recipient_role: string | null; recipient_user_id: string | null; recipient_reseller_id: string | null };

// Refreshes the badge on new notifications and, if the user allowed it, shows a browser notification.
export function NotificationListener({ role, userId, resellerId }: { role?: string; userId: string; resellerId?: string }) {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`boldhub-notifications-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, payload => {
        const row = payload.new as NotificationRow;
        const mine = row.recipient_user_id === userId
          || (!!role && row.recipient_role === role)
          || (!!resellerId && row.recipient_reseller_id === resellerId);
        if (!mine) return;
        router.refresh();
        if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
          new Notification("BoldHub", { body: row.message, icon: "/favicon.svg" });
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [router, role, userId, resellerId]);
  return null;
}

export function EnableBrowserNotifications() {
  return (
    <button type="button" className="button button-outline" onClick={() => {
      if (typeof Notification === "undefined") { alert("Browserul nu suportă notificări."); return; }
      void Notification.requestPermission().then(permission => {
        alert(permission === "granted" ? "Notificările în browser sunt active pe acest dispozitiv." : "Notificările nu au fost permise în browser.");
      });
    }}>Activează notificările în browser</button>
  );
}
