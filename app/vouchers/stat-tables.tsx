import Link from "next/link";
import type { EventCounts, WalletState } from "@/lib/vouchers/server";
import { statusLabels, type VoucherEventType, type VoucherStatus } from "@/lib/vouchers/voucher";

// Pieces shared by the voucher pages: status chips and the per-campaign statistics.

const statusTone: Record<VoucherStatus, string> = { draft: "inactive", scheduled: "remarks", active: "ok", expired: "inactive", archived: "inactive" };

export function StatusChip({ status }: { status: VoucherStatus }) {
  return <span className={`outcome-chip ${statusTone[status]}`}>{statusLabels[status]}</span>;
}

export function WalletChip({ state }: { state: WalletState }) {
  return <span className={`outcome-chip ${state.tone === "error" ? "dv-error" : state.tone}`} title={state.detail}>{state.label}</span>;
}

// The metrics, in the order of the Overview. "Requests" are clicks on the save buttons: Google does not tell
// BoldHub whether the customer then saved the pass, so they are never shown as saves.
export const metrics: { type: VoucherEventType; label: string; hint: string }[] = [
  { type: "landing_page_view", label: "Voucher views", hint: "Landing page views" },
  { type: "discount_code_copy", label: "Code copies", hint: "Copy button on the landing page" },
  { type: "shop_now_click", label: "Shop clicks", hint: "Clicks to the online shop (not orders)" },
  { type: "google_wallet_request", label: "Google Wallet requests", hint: "Save requests, not confirmed saves" },
  { type: "google_wallet_link_generated", label: "Google Wallet links", hint: "Save links handed out" },
  { type: "apple_wallet_request", label: "Apple Wallet requests", hint: "Save requests, not confirmed saves" },
  { type: "voucher_image_download", label: "Image downloads", hint: "Voucher saved as image" },
  { type: "email_voucher_requested", label: "Email requests", hint: "Requests, not sent emails" },
  { type: "email_voucher_sent", label: "Emails sent", hint: "Confirmed by the email service" },
];

export const count = (counts: EventCounts | undefined, type: VoucherEventType) => counts?.[type] ?? { total: 0, sessions: 0 };

export function MetricCell({ counts, type }: { counts: EventCounts | undefined; type: VoucherEventType }) {
  const value = count(counts, type);
  return <td className="nowrap">{value.total}<small>{value.sessions} unique</small></td>;
}

export function CampaignStatsTable({ rows }: { rows: { id: string; name: string; status: VoucherStatus; counts: EventCounts | undefined }[] }) {
  return (
    <div className="handed-table-wrap"><table className="handed-table hc-list">
      <thead><tr><th>Campaign</th><th>Status</th>{metrics.map(metric => <th key={metric.type} title={metric.hint}>{metric.label}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={metrics.length + 2} className="muted-cell">No vouchers yet.</td></tr>}
        {rows.map(row => <tr key={row.id}>
          <td className="strong"><Link href={`/vouchers/${row.id}`}>{row.name}</Link></td>
          <td><StatusChip status={row.status} /></td>
          {metrics.map(metric => <MetricCell key={metric.type} counts={row.counts} type={metric.type} />)}
        </tr>)}
      </tbody>
    </table></div>
  );
}
