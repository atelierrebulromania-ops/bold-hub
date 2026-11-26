import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { publicAssetUrl } from "@/lib/vouchers/google-wallet";
import { corsHeaders, publicVoucher, withinRate } from "@/lib/vouchers/server";
import { benefitLabel, validityLabel, voucherLabels, voucherStatus, type Voucher } from "@/lib/vouchers/voucher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

const fontDir = join(process.cwd(), "lib", "horeca", "assets", "fonts");
let fonts: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }[]> | null = null;
const loadFonts = () => fonts ??= Promise.all([
  readFile(join(fontDir, "EBGaramond_400Regular.ttf")).then(data => ({ name: "Garamond", data: new Uint8Array(data).buffer, weight: 400 as const, style: "normal" as const })),
  readFile(join(fontDir, "EBGaramond_600SemiBold.ttf")).then(data => ({ name: "Garamond", data: new Uint8Array(data).buffer, weight: 600 as const, style: "normal" as const })),
]);

const host = (url: string | null) => { try { return url ? new URL(url).host.replace(/^www\./, "") : null; } catch { return null; } };

// The voucher as a PNG the customer can keep in the phone's photos (1080 × 1350). Same rules as the data
// endpoint: published, not archived, not expired, and image download turned on for the voucher.
export async function GET(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  if (!lookup.ok) return Response.json({ error: lookup.error, message: lookup.message }, { status: lookup.status, headers: corsHeaders(request, null) });
  const { voucher, db } = lookup;
  const headers = corsHeaders(request, voucher);
  if (!(await withinRate(db, request, "image"))) return Response.json({ error: "rate_limited", message: "Too many requests. Try again in a minute." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  const status = voucherStatus(voucher);
  if (status === "expired") return Response.json({ error: "expired", message: "This voucher has expired." }, { status: 410, headers });
  if (!voucher.image_download_enabled) return Response.json({ error: "disabled", message: "Image download is not available for this voucher." }, { status: 404, headers });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new ImageResponse(<VoucherImage voucher={voucher} />, {
    width: 1080, height: 1350, fonts: await loadFonts(),
    headers: { ...headers, "Cache-Control": "public, max-age=300", ...(download ? { "Content-Disposition": `attachment; filename="${voucher.slug}-voucher.png"` } : {}) },
  });
}

export async function OPTIONS(request: Request, { params }: Context) {
  const lookup = await publicVoucher((await params).slug);
  return new Response(null, { status: 204, headers: corsHeaders(request, lookup.ok ? lookup.voucher : null) });
}

function VoucherImage({ voucher }: { voucher: Voucher }) {
  const labels = voucherLabels[voucher.language];
  const site = host(voucher.website_url ?? voucher.landing_url);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", background: voucher.background_color, color: voucher.text_color, fontFamily: "Garamond" }}>
      {voucher.hero_path
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={publicAssetUrl(voucher.hero_path)} width={1080} height={352} style={{ objectFit: "cover" }} alt="" />
        : <div style={{ height: 300, display: "flex", alignItems: "flex-end", fontSize: 56, letterSpacing: 12 }}>{voucher.brand.toUpperCase()}</div>}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "56px 90px 0", textAlign: "center" }}>
        {voucher.title && <div style={{ fontSize: 64, fontWeight: 600, color: voucher.accent_color }}>{voucher.title}</div>}
        {voucher.subtitle && <div style={{ marginTop: 18, fontSize: 34, lineHeight: 1.3, opacity: 0.92 }}>{voucher.subtitle}</div>}
        {voucher.show_discount_value && <div style={{ marginTop: 40, display: "flex", alignItems: "baseline", gap: 20 }}>
          <span style={{ fontSize: 170, fontWeight: 600, lineHeight: 1 }}>{benefitLabel(voucher)}</span>
          <span style={{ fontSize: 44, color: voucher.accent_color }}>{labels.discount}</span>
        </div>}
        {voucher.show_discount_code && <div style={{ marginTop: 40, display: "flex", flexDirection: "column", alignItems: "center", padding: "22px 70px", border: `3px dashed ${voucher.accent_color}`, borderRadius: 16 }}>
          <span style={{ fontSize: 26, letterSpacing: 4, textTransform: "uppercase", color: voucher.accent_color }}>{labels.code}</span>
          <span style={{ marginTop: 6, fontSize: 76, fontWeight: 600, letterSpacing: 10 }}>{voucher.discount_code}</span>
        </div>}
        <div style={{ marginTop: 36, fontSize: 32 }}>{`${labels.validity}: ${validityLabel(voucher)}`}</div>
        {site && <div style={{ marginTop: 14, fontSize: 32, color: voucher.accent_color }}>{site}</div>}
      </div>
    </div>
  );
}
