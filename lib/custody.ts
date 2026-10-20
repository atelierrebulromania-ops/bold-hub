// Custody items (stay ours at the client): labels shared by the agent's and the partner's screens.
export function custodyKindLabel(kind: string, trialEnds: string | null) {
  if (kind === "trial") return trialEnds ? `Probă până pe ${formatDay(trialEnds)}` : "Probă";
  return kind === "tester" ? "Tester" : "Material POS";
}

export function custodyStatusLabel(status: string) {
  return ({ at_client: "la client", returned: "returnat", missing: "lipsă", converted: "convertit în vânzare" } as Record<string, string>)[status] ?? status;
}

export function formatDay(value: string) {
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}
