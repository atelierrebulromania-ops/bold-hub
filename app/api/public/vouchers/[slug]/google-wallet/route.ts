import { googleSaveUrl, syncGoogleWallet } from "@/lib/vouchers/google-wallet";
import { corsHeaders, googleWalletReady, publicVoucher, queryContext, recordEvent, withinRate } from "@/lib/vouchers/server";
import { allowedOrigins, voucherStatus } from "@/lib/vouchers/voucher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

// The Add to Google Wallet link of a voucher. JSON by default ({ saveUrl }); with ?redirect=1 it sends the
// browser straight to Google, so a plain link works on the landing page. Saving is allowed before the start
// date (scheduled) and refused after the end. The voucher's Google resources are created or brought up to
// date first if they changed (idempotent). Records google_wallet_request and, on success,
// google_wallet_link_generated; neither means the customer actually saved the pass.
export async function GET(request: Request, { params }: Context) {
  const url = new URL(request.url);
  const redirect = url.searchParams.get("redirect") === "1";
  const lookup = await publicVoucher((await params).slug);
  if (!lookup.ok) return Response.json({ error: lookup.error, message: lookup.message }, { status: lookup.status, headers: corsHeaders(request, null) });
  const { voucher, db } = lookup;
  const headers = corsHeaders(request, voucher);
  if (!(await withinRate(db, request, "wallet"))) return Response.json({ error: "rate_limited", message: "Too many requests. Try again in a minute." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });

  const context = queryContext(url);
  await recordEvent(db, request, voucher.id, "google_wallet_request", context);
  const status = voucherStatus(voucher);
  if (status === "expired") return Response.json({ error: "expired", message: "This voucher has expired." }, { status: 410, headers });
  if (!voucher.google_wallet_enabled) return Response.json({ error: "disabled", message: "Google Wallet is not available for this voucher." }, { status: 404, headers });
  if (!googleWalletReady()) return Response.json({ error: "unavailable", message: "Google Wallet is not available right now." }, { status: 503, headers });

  const sync = await syncGoogleWallet(db, voucher);
  const saveUrl = sync.ok ? googleSaveUrl(sync.ids, allowedOrigins(voucher)) : null;
  if (!saveUrl) return Response.json({ error: "wallet_error", message: "The Google Wallet pass could not be prepared. Try again later." }, { status: 502, headers });
  await recordEvent(db, request, voucher.id, "google_wallet_link_generated", context);
  if (redirect) return new Response(null, { status: 302, headers: { ...headers, Location: saveUrl } });
  return Response.json({ saveUrl }, { headers });
}

export async function OPTIONS(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  return new Response(null, { status: 204, headers: corsHeaders(request, lookup.ok ? lookup.voucher : null) });
}
