import { voucherAccess, voucherStats } from "@/lib/vouchers/server";
import { toVoucher, voucherColumns, voucherStatus } from "@/lib/vouchers/voucher";
import { count, metrics } from "../stat-tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = (value: string | number) => {
  const text = String(value);
  // Quote, and neutralise formulas when the file is opened in a spreadsheet.
  return `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`;
};

// Statistics per campaign as CSV (totals and unique sessions), for managers.
export async function GET() {
  const access = await voucherAccess();
  if (!access) return new Response(null, { status: 403 });
  const [{ data }, stats] = await Promise.all([
    access.supabase.from("digital_vouchers").select(voucherColumns).order("starts_at", { ascending: false }),
    voucherStats(access.supabase),
  ]);
  const header = ["Campaign", "Slug", "Code", "Status", ...metrics.flatMap(metric => [`${metric.label} (total)`, `${metric.label} (unique sessions)`])];
  const lines = (data ?? []).map(toVoucher).map(voucher => {
    const counts = stats.byVoucher.get(voucher.id);
    return [voucher.name, voucher.slug, voucher.discount_code, voucherStatus(voucher), ...metrics.flatMap(metric => [count(counts, metric.type).total, count(counts, metric.type).sessions])];
  });
  const csv = [header, ...lines].map(line => line.map(cell).join(",")).join("\r\n");
  return new Response(`﻿${csv}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="digital-vouchers-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
