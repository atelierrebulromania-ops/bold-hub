import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import { BOCP_LAUNCH_DATE, readBocpFeeds, validDate } from "@/lib/bocp/feeds";
import { analyzeBocpImport } from "@/lib/bocp/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function bucharestDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameOrigin = false;
  try {
    const parsedOrigin = new URL(origin ?? "");
    sameOrigin = parsedOrigin.host.toLowerCase() === host?.toLowerCase()
      && parsedOrigin.protocol === new URL(request.url).protocol;
  } catch { /* Missing or invalid Origin header. */ }
  if (!sameOrigin || !request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Cerere invalidă." }, { status: 403, headers: noStore });
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) {
    return Response.json({ error: "Autentificare necesară." }, { status: 401, headers: noStore });
  }
  const { data: profile, error: profileError } = await supabase.from("app_users")
    .select("role,active").eq("id", authData.claims.sub).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "admin") {
    return Response.json({ error: "Acces permis doar administratorului." }, { status: 403, headers: noStore });
  }

  const body: unknown = await request.json().catch(() => null);
  const from = body && typeof body === "object" && "from" in body ? (body as { from: unknown }).from : null;
  if (typeof from !== "string" || !validDate(from) || from < BOCP_LAUNCH_DATE) {
    return Response.json({ error: "Importul începe cel mai devreme la 1 octombrie 2026." }, { status: 400, headers: noStore });
  }
  if (bucharestDate() < BOCP_LAUNCH_DATE) {
    return Response.json({ error: "Importul real nu este activ înainte de 1 octombrie 2026." }, { status: 409, headers: noStore });
  }

  let inserted = 0;
  let alreadyPresent = 0;
  try {
    const feeds = await readBocpFeeds(from);
    if (!feeds.complete) {
      return Response.json({ error: "BOCP are mai multe pagini decât limita de siguranță. Nu s-a importat nimic." }, {
        status: 409, headers: noStore,
      });
    }
    const { summary, candidates } = analyzeBocpImport(feeds.orders.rows, feeds.invoices.rows, from);
    for (let index = 0; index < candidates.length; index += 25) {
      const batch = candidates.slice(index, index + 25);
      const { data, error } = await supabase.rpc("import_bocp_online_orders", { p_orders: batch as unknown as Json });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("BOCP import batch failed.");
      }
      const result = data as { inserted?: unknown; alreadyPresent?: unknown };
      if (typeof result.inserted !== "number" || typeof result.alreadyPresent !== "number") {
        throw new Error("BOCP import result has an unexpected shape.");
      }
      inserted += result.inserted;
      alreadyPresent += result.alreadyPresent;
    }
    return Response.json({
      mode: "sku-confirmation",
      invoiceFrom: from,
      inserted,
      alreadyPresent,
      blockedInvoices: summary.blockedInvoices,
      missingSkuLines: summary.missingSkuLines,
      consideredInvoices: summary.matchedInvoices,
    }, { headers: noStore });
  } catch {
    return Response.json({
      error: "Importul nu s-a putut finaliza. Unele loturi pot fi deja importate; poți reîncerca fără dubluri.",
      inserted,
      alreadyPresent,
    }, {
      status: 502, headers: noStore,
    });
  }
}
