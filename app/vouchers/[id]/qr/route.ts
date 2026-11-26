import QRCode from "qrcode";
import { loadVoucher, voucherAccess } from "@/lib/vouchers/server";
import { qrDestination } from "@/lib/vouchers/voucher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// QR export for managers: ?format=svg|png. It encodes the QR destination with the campaign's UTM tags,
// in the voucher's colours only if ?brand=1 (black on white by default, the safest to scan and print).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await voucherAccess();
  if (!access) return new Response(null, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 400 });
  const voucher = await loadVoucher(access.supabase, id);
  if (!voucher) return new Response(null, { status: 404 });
  const destination = qrDestination(voucher);
  if (!destination) return Response.json({ error: "Set the QR destination URL or the landing page first." }, { status: 422 });
  const url = new URL(request.url);
  const brand = url.searchParams.get("brand") === "1";
  const color = brand ? { dark: `${voucher.text_color}FF`, light: `${voucher.background_color}FF` } : { dark: "#000000FF", light: "#FFFFFFFF" };
  const name = `${voucher.slug}-qr`;
  if (url.searchParams.get("format") === "png") {
    const png = await QRCode.toBuffer(destination, { type: "png", errorCorrectionLevel: "M", margin: 4, width: 1200, color });
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${name}.png"`, "Cache-Control": "private, no-store" } });
  }
  const svg = await QRCode.toString(destination, { type: "svg", errorCorrectionLevel: "M", margin: 4, color });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Content-Disposition": `attachment; filename="${name}.svg"`, "Cache-Control": "private, no-store" } });
}
