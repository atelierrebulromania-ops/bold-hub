"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Re-renders the server page when any of the watched tables change, with a slow fallback poll.
export function LiveRefresh({ channel, tables }: { channel: string; tables: string[] }) {
  const router = useRouter();
  const key = tables.join(",");
  useEffect(() => {
    const supabase = createClient();
    let subscription = supabase.channel(channel);
    for (const table of key.split(",")) {
      subscription = subscription.on("postgres_changes", { event: "*", schema: "public", table }, () => router.refresh());
    }
    subscription.subscribe();
    const interval = window.setInterval(() => router.refresh(), 60000);
    return () => { window.clearInterval(interval); void supabase.removeChannel(subscription); };
  }, [router, channel, key]);
  return null;
}
