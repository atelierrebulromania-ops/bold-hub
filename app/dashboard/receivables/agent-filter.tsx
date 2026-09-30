"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

// Filters the receivables by agent as soon as one is picked.
export function AgentFilter({ agents, current }: { agents: string[]; current: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="filter-field receivables-agent">
      <span>Agent</span>
      <select value={current} disabled={pending} onChange={(event) => {
        const agent = event.target.value;
        start(() => router.push(agent ? `/dashboard/receivables?agent=${encodeURIComponent(agent)}` : "/dashboard/receivables"));
      }}>
        <option value="">Toți agenții</option>{agents.map((agent) => <option key={agent} value={agent}>{agent}</option>)}</select>
    </label>
  );
}
