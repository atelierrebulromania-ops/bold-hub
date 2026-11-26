import { apiBase, corsHeaders, publicPayload, publicVoucher, withinRate } from "@/lib/vouchers/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

// Public data of one voucher for the landing page (no BoldHub account needed). Only published, non-archived
// vouchers answer; there is deliberately no endpoint that lists vouchers.
export async function GET(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  if (!lookup.ok) return Response.json({ error: lookup.error, message: lookup.message }, { status: lookup.status, headers: corsHeaders(request, null) });
  const headers = corsHeaders(request, lookup.voucher);
  if (!(await withinRate(lookup.db, request, "read"))) return Response.json({ error: "rate_limited", message: "Too many requests. Try again in a minute." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  return Response.json(publicPayload(lookup.voucher, apiBase(request)), { headers });
}

export async function OPTIONS(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  return new Response(null, { status: 204, headers: corsHeaders(request, lookup.ok ? lookup.voucher : null) });
}
