import { corsHeaders, publicVoucher, queryContext, recordEvent, withinRate } from "@/lib/vouchers/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

// Reserved for Apple Wallet. Until the Apple Developer account and the pass certificates exist it answers
// 501 "not_configured" and never returns a link; the landing page hides the button (features.appleWallet).
export async function GET(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  if (!lookup.ok) return Response.json({ error: lookup.error, message: lookup.message }, { status: lookup.status, headers: corsHeaders(request, null) });
  const headers = corsHeaders(request, lookup.voucher);
  if (!(await withinRate(lookup.db, request, "wallet"))) return Response.json({ error: "rate_limited", message: "Too many requests. Try again in a minute." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  await recordEvent(lookup.db, request, lookup.voucher.id, "apple_wallet_request", queryContext(new URL(request.url)));
  // When Apple Wallet is built, the signed .pkpass is returned here (appleWalletReady() and the voucher's
  // apple_wallet_enabled both true).
  return Response.json({ error: "not_configured", message: "Apple Wallet is not available yet." }, { status: 501, headers });
}

export async function OPTIONS(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  return new Response(null, { status: 204, headers: corsHeaders(request, lookup.ok ? lookup.voucher : null) });
}
