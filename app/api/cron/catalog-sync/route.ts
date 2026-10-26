import { syncCatalogFromBocp } from "@/lib/bocp/catalog-sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

// Every 15 minutes (pg_cron): products, prices and stock from BOCP, so the agents' catalog and the B2B orders show
// the current stock.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }
  const supabase = createAdminClient();
  if (!supabase) return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers: noStore });
  const result = await syncCatalogFromBocp(supabase);
  return Response.json(result.ok ? { status: "ok", ...result, flagged: result.flagged.length } : { status: "error", error: result.error },
    { status: result.ok ? 200 : 502, headers: noStore });
}
