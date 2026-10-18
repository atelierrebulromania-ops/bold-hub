import "server-only";
import { keyOf } from "@/lib/leads";

let cached: { at: number; labels: Record<string, string> } | null = null;

// The names of the MailerLite subscriber fields (as written in MailerLite), by field key. Read once
// every 10 minutes; without an API key (or if MailerLite is down) answers keep their key-based labels.
export async function mailerliteFieldLabels(): Promise<Record<string, string> | undefined> {
  const key = process.env.MAILERLITE_API_KEY;
  if (!key) return undefined;
  if (cached && Date.now() - cached.at < 600_000) return cached.labels;
  try {
    const response = await fetch("https://connect.mailerlite.com/api/fields?limit=100", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return cached?.labels;
    const body = await response.json() as { data?: { key?: string; name?: string }[] };
    const labels: Record<string, string> = {};
    for (const field of body.data ?? []) if (field.key && field.name) labels[keyOf(field.key)] = field.name.slice(0, 200);
    cached = { at: Date.now(), labels };
    return labels;
  } catch {
    return cached?.labels;
  }
}
