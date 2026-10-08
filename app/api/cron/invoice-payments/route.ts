import { refreshInvoicePayments } from "@/lib/invoice-payments";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

// Daily job (each morning): re-reads every unpaid B2B invoice in BOCP so due dates and payments stay
// current. Runs in batches until none are left or the time budget is spent.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }
  const supabase = createAdminClient();
  if (!supabase) {
    return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers: noStore });
  }
  const started = Date.now();
  const total = { checked: 0, failed: 0 };
  while (Date.now() - started < 240_000) {
    const batch = await refreshInvoicePayments(supabase, 100);
    total.checked += batch.checked;
    total.failed += batch.failed;
    // Done when a batch was not full; stop too when nothing could be read (BOCP down).
    if (batch.checked + batch.failed < 100 || batch.checked === 0) break;
  }
  return Response.json({ status: "ok", ...total }, { headers: noStore });
}
