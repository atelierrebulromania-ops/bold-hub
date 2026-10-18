import { timingSafeEqual } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { leadSources, normalizeLead, type LeadSource } from "@/lib/leads";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function sameKey(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
    payload = type.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
  } catch {
    return Response.json({ error: "Conținut invalid." }, { status: 400, headers: noStore });
  }
  // MailerLite and some tools send a batch of events; each one is a lead.
  const items = Array.isArray(payload) ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { events?: unknown }).events) ? (payload as { events: unknown[] }).events
    : [payload];

  const ids: string[] = [];
  for (const item of items.slice(0, 50)) {
    const lead = normalizeLead(item, source);
    if (!lead) continue;
    const { data, error } = await supabase.rpc("ingest_lead", { p_lead: lead as unknown as Json });
    if (error) return Response.json({ error: "Lead-ul nu a putut fi salvat.", saved: ids.length }, { status: 500, headers: noStore });
    if (data) ids.push(data);
  }
  if (!ids.length) return Response.json({ error: "Nu am găsit nume, firmă, email sau telefon în cerere." }, { status: 422, headers: noStore });
  return Response.json({ status: "ok", leads: ids.length }, { headers: noStore });
}
