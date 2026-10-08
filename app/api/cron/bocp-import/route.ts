import type { Json } from "@/lib/database.types";
import { readBocpFeeds } from "@/lib/bocp/feeds";
import { analyzeBocpImport } from "@/lib/bocp/preview";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

function bucharestDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

// The last week of invoices, but never before the day of the first manual import (the launch).
function importWindowStart(today: string, launchedOn: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  const lookback = date.toISOString().slice(0, 10);
  return lookback > launchedOn ? lookback : launchedOn;
}

// Scheduled job: imports new BOCP online orders once the admin turned on "Import automat"
// (Admin → Integrări), which is possible only after the first manual import.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }
  const supabase = createAdminClient();
  if (!supabase) {
    return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers: noStore });
  }
  const { data: settings } = await supabase.from("app_settings").select("auto_import,launched_on").eq("id", 1).maybeSingle();
  if (!settings?.auto_import || !settings.launched_on) {
    return Response.json({ status: "disabled" }, { headers: noStore });
  }

  const from = importWindowStart(bucharestDate(), settings.launched_on);
  const finish = async (status: number, body: Record<string, unknown>) => {
    await supabase.rpc("record_auto_import", { p_result: { ...body, ok: status === 200 } as Json });
    return Response.json(body, { status, headers: noStore });
  };
  let inserted = 0;
  let alreadyPresent = 0;
  try {
    const feeds = await readBocpFeeds(from);
    if (!feeds.complete) return finish(409, { error: "BOCP a depășit limita de pagini; nu s-a importat nimic." });
    const { candidates, summary } = analyzeBocpImport(feeds.orders.rows, feeds.invoices.rows, from);
    for (let index = 0; index < candidates.length; index += 25) {
      const batch = candidates.slice(index, index + 25);
      const { data, error } = await supabase.rpc("import_bocp_online_orders_job", { p_orders: batch as unknown as Json });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("BOCP scheduled import batch failed.");
      }
      const result = data as { inserted?: unknown; alreadyPresent?: unknown };
      if (typeof result.inserted !== "number" || typeof result.alreadyPresent !== "number") {
        throw new Error("BOCP scheduled import result has an unexpected shape.");
      }
      inserted += result.inserted;
      alreadyPresent += result.alreadyPresent;
    }
    return finish(200, { status: "ok", invoiceFrom: from, inserted, alreadyPresent, blockedInvoices: summary.blockedInvoices });
  } catch {
    return finish(502, { error: "Importul automat nu s-a finalizat; loturile deja salvate pot fi reluate fără dubluri.", inserted, alreadyPresent });
  }
}
