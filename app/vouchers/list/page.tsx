import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { appleWalletStatus, googleWalletState, voucherRoles, voucherStats, walletResources } from "@/lib/vouchers/server";
import { benefitLabel, toVoucher, voucherColumns, voucherStatus, zonedDateTime } from "@/lib/vouchers/voucher";
import { count, StatusChip, WalletChip } from "../stat-tables";
import { RowActions } from "../voucher-actions";

export const dynamic = "force-dynamic";

export default async function VouchersListPage() {
  const { supabase, profile } = await requireRole(voucherRoles);
  const [{ data, error }, stats, resources] = await Promise.all([
    supabase.from("digital_vouchers").select(voucherColumns).order("archived_at", { ascending: true, nullsFirst: true }).order("starts_at", { ascending: false }),
    voucherStats(supabase),
    walletResources(supabase),
  ]);
  const vouchers = (data ?? []).map(toVoucher);
  const apple = appleWalletStatus();

  return (
    <AppShell profile={profile} active="/vouchers/list" section="Digital Vouchers" title="Vouchers"
      note={{ title: "Vouchers", text: "Statuses follow the dates in Europe/Bucharest. Archive takes a voucher off the public API." }}>
      <div className="page-heading">
        <div><h1>Vouchers</h1><p className="muted">Every campaign, its status and its wallet integrations.</p></div>
        <Link className="button button-primary" href="/vouchers/new">New voucher</Link>
      </div>
      {error && <p className="preview-alert warning admin-feedback" role="alert">The vouchers could not be loaded. Reload the page.</p>}
      <section className="board-panel admin-card" aria-label="Vouchers">
        <div className="handed-table-wrap"><table className="handed-table hc-list">
          <thead><tr><th>Campaign</th><th>Brand</th><th>Discount code</th><th>Benefit</th><th>Start</th><th>Expiration</th><th>Status</th><th>Google Wallet</th><th>Apple Wallet</th><th>Views</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {vouchers.length === 0 && <tr><td colSpan={11} className="muted-cell">No vouchers yet. Create the first one with New voucher.</td></tr>}
            {vouchers.map(voucher => {
              const views = count(stats.byVoucher.get(voucher.id), "landing_page_view");
              return <tr key={voucher.id}>
                <td className="strong"><Link href={`/vouchers/${voucher.id}`}>{voucher.name}</Link>{voucher.internal_name && <small>{voucher.internal_name}</small>}</td>
                <td className="nowrap">{voucher.brand}</td>
                <td className="nowrap"><code>{voucher.discount_code}</code></td>
                <td className="nowrap">{benefitLabel(voucher)}</td>
                <td className="nowrap">{zonedDateTime(voucher.starts_at, voucher.timezone)}</td>
                <td className="nowrap">{zonedDateTime(voucher.expires_at, voucher.timezone)}</td>
                <td><StatusChip status={voucherStatus(voucher)} /></td>
                <td><WalletChip state={googleWalletState(voucher, resources.get(voucher.id))} /></td>
                <td><WalletChip state={{ label: apple.ready ? (voucher.apple_wallet_enabled ? "Enabled" : "Disabled") : "Not configured", tone: "inactive", detail: apple.reason }} /></td>
                <td className="nowrap">{views.total}<small>{views.sessions} unique</small></td>
                <td><RowActions id={voucher.id} name={voucher.name} archived={Boolean(voucher.archived_at)} compact /></td>
              </tr>;
            })}
          </tbody>
        </table></div>
      </section>
    </AppShell>
  );
}
