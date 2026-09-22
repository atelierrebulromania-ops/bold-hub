import { createClient } from "@/lib/supabase/server";
import { BOCP_EARLIEST_AUDIT_DATE, BOCP_LAUNCH_DATE, readBocpFeeds, validDate } from "@/lib/bocp/feeds";
import { summarizeBocpImport } from "@/lib/bocp/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) return Response.json({ error: "Autentificare necesară." }, { status: 401 });

  const { data: profile, error: profileError } = await supabase.from("app_users")
    .select("role,active").eq("id", authData.claims.sub).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "admin") {
    return Response.json({ error: "Acces permis doar administratorului." }, { status: 403 });
  }

  const from = new URL(request.url).searchParams.get("from") ?? BOCP_LAUNCH_DATE;
  if (!validDate(from) || from < BOCP_EARLIEST_AUDIT_DATE) {
    return Response.json({ error: "Data trebuie să fie validă și cel puțin 2026-09-01." }, { status: 400 });
  }

  // An order can be invoiced days after it was placed. Include a lookback.
  try {
    const { orders, invoices, orderFrom, complete } = await readBocpFeeds(from);

    return Response.json({
      mode: "read-only-preview",
      operationalLaunchDate: BOCP_LAUNCH_DATE,
      invoiceFrom: from,
      orderFrom,
      complete,
      pages: { orders: orders.pages, invoices: invoices.pages },
      truncated: { orders: orders.truncated, invoices: invoices.truncated },
      summary: summarizeBocpImport(orders.rows, invoices.rows, from),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Previzualizarea BOCP nu este disponibilă acum." }, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
