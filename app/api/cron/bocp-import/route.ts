import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { BOCP_LAUNCH_DATE, readBocpFeeds } from "@/lib/bocp/feeds";
import { analyzeBocpImport } from "@/lib/bocp/preview";

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

function importWindowStart(today: string): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 7);
  const lookback = date.toISOString().slice(0, 10);
  return lookback > BOCP_LAUNCH_DATE ? lookback : BOCP_LAUNCH_DATE;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }

  if (process.env.BOCP_AUTO_IMPORT_ENABLED !== "true") {
    return Response.json({ status: "disabled" }, { headers: noStore });
  }
  const today = bucharestDate();
  if (today < BOCP_LAUNCH_DATE) {
    return Response.json({ status: "before-launch" }, { headers: noStore });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers: noStore });
  }

  const from = importWindowStart(today);
  let inserted = 0;
  let alreadyPresent = 0;
  try {
    const feeds = await readBocpFeeds(from);
    if (!feeds.complete) {
      return Response.json({ error: "BOCP a depășit limita de pagini; nu s-a importat nimic." }, {
        status: 409, headers: noStore,
      });
    }
    const { candidates, summary } = analyzeBocpImport(feeds.orders.rows, feeds.invoices.rows, from);
    const supabase = createClient<Database>(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    for (let index = 0; index < candidates.length; index += 25) {
      const batch = candidates.slice(index, index + 25);
      const { data, error } = await supabase.rpc("import_bocp_online_orders", { p_orders: batch as unknown as Json });
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
    return Response.json({ status: "ok", invoiceFrom: from, inserted, alreadyPresent,
      blockedInvoices: summary.blockedInvoices }, { headers: noStore });
  } catch {
    return Response.json({ error: "Sincronizarea BOCP nu s-a finalizat; loturile deja salvate pot fi reluate fără dubluri.",
      inserted, alreadyPresent }, { status: 502, headers: noStore });
  }
}
