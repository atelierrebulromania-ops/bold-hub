import { refreshInvoicePayments } from "@/lib/invoice-payments";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

// Hourly job: re-reads the unpaid B2B invoices in BOCP so due dates and payments stay current.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }
  const supabase = createAdminClient();
  if (!supabase) {
    return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers: noStore });
  }
  const result = await refreshInvoicePayments(supabase, 60);
  return Response.json({ status: "ok", ...result }, { headers: noStore });
}
