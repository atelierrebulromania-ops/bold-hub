import { timingSafeEqual } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { leadSources, normalizeLead, type LeadSource } from "@/lib/leads";
import { mailerliteFieldLabels } from "@/lib/mailerlite";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function sameKey(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Make sends the form answers as one JSON field (they differ per form); unpack it next to the other fields.
function expandJsonFields(fields: Record<string, FormDataEntryValue>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { out[key] = JSON.parse(trimmed); continue; } catch { /* plain text */ }
    }
    out[key] = value;
  }
  return out;
}

// MailerLite sends the subscriber with extras the person never typed (IP location, time zone, API
// version, campaign stats): keep only the email and the subscriber's form fields.
function mailerliteSubscriber(item: unknown): unknown {
  const root = item as { subscriber?: unknown } | null;
  const subscriber = (root && typeof root === "object" && root.subscriber ? root.subscriber : root) as { email?: unknown; fields?: unknown } | null;
  if (!subscriber || typeof subscriber !== "object" || !subscriber.fields || typeof subscriber.fields !== "object") return item;
  return { email: subscriber.email, ...(subscriber.fields as Record<string, unknown>) };
}

// Where lead sources post new leads: Meta Lead Ads through Make/Zapier, the MailerLite form on the
// site, later Google and TikTok. The key from Admin → Setări authorizes the call (?key=… or a Bearer header).
export async function POST(request: Request) {
  const url = new URL(request.url);
  const source = (url.searchParams.get("source") ?? "website") as LeadSource;
  if (!leadSources.includes(source) || source === "import") return Response.json({ error: "Sursă necunoscută." }, { status: 400, headers: noStore });
  if (Number(request.headers.get("content-length") ?? 0) > 200_000) return Response.json({ error: "Cerere prea mare." }, { status: 413, headers: noStore });

  const supabase = createAdminClient();
  if (!supabase) return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers: noStore });
  const given = url.searchParams.get("key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: settings } = await supabase.from("app_settings").select("leads_webhook_key").eq("id", 1).maybeSingle();
  if (!settings?.leads_webhook_key || !sameKey(given, settings.leads_webhook_key)) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }

  let payload: unknown;
  const type = request.headers.get("content-type") ?? "";
  try {
    payload = type.includes("application/json") ? await request.json() : expandJsonFields(Object.fromEntries(await request.formData()));
  } catch {
    return Response.json({ error: "Conținut invalid." }, { status: 400, headers: noStore });
  }
  // MailerLite and some tools send a batch of events; each one is a lead.
  const items = Array.isArray(payload) ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { events?: unknown }).events) ? (payload as { events: unknown[] }).events
    : [payload];

  // ?group=<id>: only events that mention this group (e.g. the site form's MailerLite group, not the newsletter).
  const group = url.searchParams.get("group");
  // Site form leads come from MailerLite: show its own field names on the answers.
  const labels = source === "website" ? await mailerliteFieldLabels() : undefined;
  const ids: string[] = [];
  let ignored = 0;
  for (const item of items.slice(0, 50)) {
    if (group && !JSON.stringify(item).includes(group)) { ignored++; continue; }
    const lead = normalizeLead(source === "website" ? mailerliteSubscriber(item) : item, source, labels);
    if (!lead) continue;
    // ?form=<name>: which form the source posts for (MailerLite does not send it).
    lead.form_name ??= url.searchParams.get("form")?.slice(0, 300) || null;
    const { data, error } = await supabase.rpc("ingest_lead", { p_lead: lead as unknown as Json });
    if (error) return Response.json({ error: "Lead-ul nu a putut fi salvat.", saved: ids.length }, { status: 500, headers: noStore });
    if (data) ids.push(data);
  }
  // Events for other groups are acknowledged, so the sender does not retry them.
  if (!ids.length && ignored) return Response.json({ status: "ignored", ignored }, { headers: noStore });
  if (!ids.length) return Response.json({ error: "Nu am găsit nume, firmă, email sau telefon în cerere." }, { status: 422, headers: noStore });
  return Response.json({ status: "ok", leads: ids.length }, { headers: noStore });
}
