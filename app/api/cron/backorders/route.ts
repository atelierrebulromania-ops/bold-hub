import { bocpProductStock } from "@/lib/b2b-bocp";
import type { Json } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

// Every morning: for products owed to partners (restanțe), read the stock in BOCP; when it is back,
// the warehouse is told once, to put the backorders on the partners' shelves.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }
  const supabase = createAdminClient();
  if (!supabase) return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers: noStore });

  const { data: owed, error } = await supabase.rpc("backorder_products");
  if (error) return Response.json({ error: "Restanțele nu pot fi citite." }, { status: 500, headers: noStore });
  const waiting = (owed ?? []).filter((row) => row.unnotified > 0 && row.sku);
  if (!waiting.length) return Response.json({ status: "ok", checked: 0, back: 0 }, { headers: noStore });

  let stock;
  try { stock = await bocpProductStock(waiting.map((row) => row.sku)); }
  catch { return Response.json({ error: "BOCP nu a răspuns." }, { status: 502, headers: noStore }); }
  const back = waiting.flatMap((row) => {
    const available = stock.get(row.sku)?.available ?? 0;
    return available > 0 ? [{ product_id: row.product_id, name: row.name, available, units: row.units, partners: row.partners }] : [];
  });
  if (back.length) await supabase.rpc("notify_backorder_stock", { p_items: back as unknown as Json });
  return Response.json({ status: "ok", checked: waiting.length, back: back.length }, { headers: noStore });
}
