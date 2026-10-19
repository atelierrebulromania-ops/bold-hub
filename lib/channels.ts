// Order channels: a partner orders for resale (products on its shelf for its customers) or for its own
// consumption (e.g. a hotel using our products). Each channel has its own initial stock; both channels
// travel in the same order and go on the same invoice.
export type Channel = "resale" | "consumption";

export const channels: { id: Channel; label: string }[] = [
  { id: "resale", label: "Revânzare" },
  { id: "consumption", label: "Consum" },
];

export function channelLabel(channel: string | null | undefined) {
  return channel === "consumption" ? "Consum" : "Revânzare";
}

export function parseChannel(value: unknown): Channel {
  return value === "consumption" ? "consumption" : "resale";
}

// The channels a partner orders on, from its initial stock (resale first).
export function usedChannels(levels: { channel: string }[]): Channel[] {
  const used = new Set(levels.map((level) => parseChannel(level.channel)));
  return channels.map((channel) => channel.id).filter((id) => used.has(id));
}
