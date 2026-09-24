"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Keeps the sidebar counters live: any change on a counted table refreshes the server-rendered shell.
export function NavCountsListener({ tables }: { tables: string[] }) {
  const router = useRouter();
  const key = tables.join(",");
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A single action touches several rows, so batch the burst into one refresh.
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => router.refresh(), 400); };
    let channel = supabase.channel(`boldhub-nav-counts-${key}`);
    for (const table of key.split(",")) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    channel.subscribe();
    return () => { clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [router, key]);
  return null;
}
