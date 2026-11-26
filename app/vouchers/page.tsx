import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { voucherRoles, voucherStats } from "@/lib/vouchers/server";
import { toVoucher, voucherColumns, voucherStatus, type VoucherEventType } from "@/lib/vouchers/voucher";
import { CampaignStatsTable, count } from "./stat-tables";

export const dynamic = "force-dynamic";

// Digital Vouchers · Overview: campaign counts and the anonymous statistics, in total and per campaign.
export default async function VouchersOverviewPage() {
  const { supabase, profile } = await requireRole(voucherRoles);
  const [{ data, error }, stats] = await Promise.all([
    supabase.from("digital_vouchers").select(voucherColumns).order("starts_at", { ascending: false }),
    voucherStats(supabase),
  ]);
  const vouchers = (data ?? []).map(toVoucher);
  const now = new Date();
  const withStatus = vouchers.map(voucher => ({ voucher, status: voucherStatus(voucher, now) }));
  const sum = (type: VoucherEventType) => vouchers.reduce((total, voucher) => total + count(stats.byVoucher.get(voucher.id), type).total, 0);
  const cards = [
    { label: "Vouchers configured", value: vouchers.filter(voucher => !voucher.archived_at).length, note: `${vouchers.filter(voucher => voucher.archived_at).length} archived`, tone: "blue" },
    { label: "Active campaigns", value: withStatus.filter(item => item.status === "active").length, note: "Running now (Europe/Bucharest)", tone: "green" },
    { label: "Scheduled campaigns", value: withStatus.filter(item => item.status === "scheduled").length, note: "Published, not started yet", tone: "orange" },
    { label: "Voucher views", value: sum("landing_page_view"), note: "Landing page views", tone: "purple" },
    { label: "Shop clicks", value: sum("shop_now_click"), note: "Clicks to the shop, not orders", tone: "blue" },
    { label: "Google Wallet requests", value: sum("google_wallet_request"), note: "Save requests, not confirmed saves", tone: "green" },
    { label: "Apple Wallet requests", value: sum("apple_wallet_request"), note: "Apple Wallet is not configured yet", tone: "orange" },
    { label: "Email requests", value: sum("email_voucher_requested"), note: "Email delivery comes later", tone: "purple" },
  ];

  return (
    <AppShell profile={profile} active="/vouchers" section="Digital Vouchers" title="Overview"
      note={{ title: "Digital Vouchers", text: "Campaign vouchers for the landing page and Google Wallet. Statistics are anonymous: no IP addresses, no personal data." }}>
      <div className="page-heading">
        <div><h1>Digital Vouchers</h1><p className="muted">Voucher campaigns, their distribution and what customers did with them.</p></div>
        <div className="hc-row-actions"><a className="button button-outline" href="/vouchers/stats.csv">Export statistics (CSV)</a><Link className="button button-primary" href="/vouchers/new">New voucher</Link></div>
      </div>
      {(error || stats.error) && <p className="preview-alert warning admin-feedback" role="alert">Some data could not be loaded. Reload the page.</p>}
      <div className="stat-grid">
        {cards.map(card => <div className="stat-card" key={card.label}>
          <span className={`stat-icon ${card.tone}`} aria-hidden="true">{card.label.charAt(0)}</span>
          <div><p>{card.label}</p><strong>{card.value}</strong><small>{card.note}</small></div>
        </div>)}
      </div>
      <section className="board-panel admin-card" aria-label="Statistics per campaign">
        <div className="admin-card-heading"><h2>Per campaign</h2><p>Each figure: total events, and below it the unique anonymous sessions. Wallet figures are requests, not confirmed saves. Shop clicks are not Shopify orders.</p></div>
        <CampaignStatsTable rows={withStatus.map(({ voucher, status }) => ({ id: voucher.id, name: voucher.name, status, counts: stats.byVoucher.get(voucher.id) }))} />
      </section>
    </AppShell>
  );
}
