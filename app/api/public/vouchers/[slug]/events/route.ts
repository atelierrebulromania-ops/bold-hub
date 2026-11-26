import { corsHeaders, originAllowed, publicVoucher, recordEvent, withinRate } from "@/lib/vouchers/server";
import { clientEventTypes, type VoucherEventType } from "@/lib/vouchers/voucher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };
const methods = "POST, OPTIONS";

// Tracking from the landing page: { type, sessionId?, utmSource?, utmMedium?, utmCampaign?, referrer? }.
// Only the events a browser observes are accepted here; wallet and e-mail events are recorded by the
// server itself. Requests from other sites (Origin not allowed) are refused; all are rate limited.
export async function POST(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  if (!lookup.ok) return Response.json({ error: lookup.error, message: lookup.message }, { status: lookup.status, headers: corsHeaders(request, null, methods) });
  const { voucher, db } = lookup;
  const headers = corsHeaders(request, voucher, methods);
  if (!originAllowed(request, voucher)) return Response.json({ error: "forbidden_origin", message: "This site may not send events." }, { status: 403, headers });
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return Response.json({ error: "too_large", message: "The request is too large." }, { status: 413, headers });
  if (!(await withinRate(db, request, "events"))) return Response.json({ error: "rate_limited", message: "Too many requests. Try again in a minute." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2048) throw new Error("size");
    body = JSON.parse(text) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("shape");
  } catch {
    return Response.json({ error: "invalid_body", message: "Send a JSON object." }, { status: 400, headers });
  }
  const type = body.type as VoucherEventType;
  if (!clientEventTypes.includes(type)) {
    return Response.json({ error: "invalid_type", message: `Unknown event type. Allowed: ${clientEventTypes.join(", ")}.` }, { status: 400, headers });
  }
  const saved = await recordEvent(db, request, voucher.id, type, body);
  if (!saved) return Response.json({ error: "not_saved", message: "The event could not be saved." }, { status: 500, headers });
  return Response.json({ ok: true }, { status: 202, headers });
}

export async function OPTIONS(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  return new Response(null, { status: 204, headers: corsHeaders(request, lookup.ok ? lookup.voucher : null, methods) });
}
