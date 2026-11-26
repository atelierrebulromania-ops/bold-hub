import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { publicAssetUrl } from "@/lib/vouchers/google-wallet";
import { appleWalletStatus, googleWalletState, loadVoucher, voucherRoles, voucherStats, walletResources } from "@/lib/vouchers/server";
import {
  allowedOrigins, benefitLabel, campaignUtm, discountTypes, qrDestination, shopUrl, validityLabel, voucherStatus, zonedDateTime,
} from "@/lib/vouchers/voucher";
import { CopyButton } from "../copy-button";
import { WalletPreview } from "../preview";
import { count, metrics, StatusChip, WalletChip } from "../stat-tables";
import { RowActions, WalletActions } from "../voucher-actions";

export const dynamic = "force-dynamic";

const auditFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Bucharest" });

export default async function VoucherPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; warning?: string }> }) {
  const { supabase, profile } = await requireRole(voucherRoles);
  const { id } = await params;
  const query = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const voucher = await loadVoucher(supabase, id);
  if (!voucher) notFound();
  const [stats, resources, audit] = await Promise.all([
    voucherStats(supabase, id),
    walletResources(supabase, id),
    supabase.from("digital_voucher_audit").select("action,changed_fields,created_at,actor_id").eq("voucher_id", id).order("created_at", { ascending: false }).limit(15),
  ]);
  const actorIds = [...new Set((audit.data ?? []).map(row => row.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from("app_users").select("id,full_name").in("id", actorIds) : { data: [] };
  const actorName = new Map((actors ?? []).map(actor => [actor.id, actor.full_name]));

  const status = voucherStatus(voucher);
  const counts = stats.byVoucher.get(id);
  const rows = resources.get(id) ?? [];
  const googleState = googleWalletState(voucher, rows);
  const apple = appleWalletStatus();
  const host = (await headers()).get("host") ?? "www.boldhub.ro";
  const base = `${host.startsWith("localhost") ? "http" : "https"}://${host}/api/public/vouchers/${voucher.slug}`;
  const shop = shopUrl(voucher, campaignUtm(voucher));
  const qr = qrDestination(voucher);
  const logoUrl = voucher.logo_path ? publicAssetUrl(voucher.logo_path) : null;
  const heroUrl = voucher.hero_path ? publicAssetUrl(voucher.hero_path) : null;

  const detail = (label: string, value: React.ReactNode) => <div><dt>{label}</dt><dd>{value || <span className="dv-muted">—</span>}</dd></div>;
  const copyRow = (label: string, value: string | null) => (
    <div><small>{label}</small><code>{value ?? "—"}</code>{value && <CopyButton value={value} />}</div>
  );

  return (
    <AppShell profile={profile} active="/vouchers/list" section="Digital Vouchers" title={voucher.name}
      note={{ title: voucher.name, text: "Details, Google Wallet, the public API addresses for the landing page and the statistics of this voucher." }}>
      <div className="page-heading">
        <div>
          <h1>{voucher.name}</h1>
          <p className="muted"><StatusChip status={status} /> {voucher.internal_name && <>· {voucher.internal_name} </>}· {validityLabel(voucher)} ({voucher.timezone})</p>
        </div>
        <RowActions id={voucher.id} name={voucher.name} archived={Boolean(voucher.archived_at)} />
      </div>
      {query.notice === "saved" && <p className="preview-alert success admin-feedback" role="status">Saved.</p>}
      {query.warning && <p className="preview-alert warning admin-feedback" role="alert">{query.warning.slice(0, 400)}</p>}
      {status === "draft" && <p className="preview-alert warning admin-feedback" role="status">Draft: the public API answers “not found” for this voucher until it is published (Edit → Published).</p>}

      <div className="dv-view">
        <div className="dv-view-main">
          <section className="admin-card" aria-label="Details">
            <div className="admin-card-heading"><h2>Voucher</h2></div>
            <dl className="dv-details">
              {detail("Brand", voucher.brand)}
              {detail("Slug", <code>{voucher.slug}</code>)}
              {detail("Discount code", <><code>{voucher.discount_code}</code> <CopyButton value={voucher.discount_code} /></>)}
              {detail("Benefit", `${benefitLabel(voucher)} · ${discountTypes[voucher.discount_type]}`)}
              {detail("Start", zonedDateTime(voucher.starts_at, voucher.timezone))}
              {detail("Expiration", zonedDateTime(voucher.expires_at, voucher.timezone))}
              {detail("Title", voucher.title)}
              {detail("Subtitle", voucher.subtitle)}
              {detail("Description", voucher.short_description || voucher.long_description)}
              {detail("Terms", <span className="dv-pre">{voucher.terms}</span>)}
              {detail("Internal notes", <span className="dv-pre">{voucher.internal_notes}</span>)}
            </dl>
          </section>

          <section className="admin-card" aria-label="Google Wallet">
            <div className="admin-card-heading"><h2>Google Wallet <WalletChip state={googleState} /></h2>
              <p>One class and one shared object for the whole campaign (everyone saves the same pass, with the common code). Save requests are counted; Google does not confirm actual saves to BoldHub.</p></div>
            <div className="dv-card-body">
              {googleState.detail && <p className="dv-note">{googleState.detail}</p>}
              <dl className="dv-details">
                {(["class", "object"] as const).map(type => {
                  const row = rows.find(item => item.resource_type === type);
                  return <div key={type}><dt>{type === "class" ? "OfferClass" : "OfferObject"}</dt><dd>{row ? <><code>{row.external_id}</code><small>{row.sync_status}{row.last_synced_at ? ` · ${auditFormat.format(new Date(row.last_synced_at))}` : ""}</small>{row.last_error && <small className="hc-field-error">{row.last_error}</small>}</> : <span className="dv-muted">Not created yet</span>}</dd></div>;
                })}
              </dl>
              <WalletActions id={voucher.id} enabled={voucher.google_wallet_enabled && !voucher.archived_at} />
            </div>
          </section>

          <section className="admin-card" aria-label="Distribution">
            <div className="admin-card-heading"><h2>Distribution</h2><p>Links with the campaign UTM tags, the QR export and the public API addresses for the Shopify landing page.</p></div>
            <div className="dv-card-body dv-links">
              {copyRow("Shop link (applies the code)", shop)}
              {copyRow("Landing page", voucher.landing_url)}
              {copyRow("QR destination", qr)}
              <div><small>QR export</small><span className="hc-row-actions dv-left">
                <a className="button button-outline" href={`/vouchers/${voucher.id}/qr?format=svg`}>SVG</a>
                <a className="button button-outline" href={`/vouchers/${voucher.id}/qr?format=png`}>PNG</a>
                <a className="button button-outline" href={`/vouchers/${voucher.id}/qr?format=png&brand=1`}>PNG in voucher colours</a>
              </span></div>
              {copyRow("API · voucher data (GET)", base)}
              {copyRow("API · Add to Google Wallet (GET, ?redirect=1)", `${base}/google-wallet`)}
              {copyRow("API · voucher image (GET, ?download=1)", `${base}/image`)}
              {copyRow("API · tracking (POST)", `${base}/events`)}
              <div><small>Sites allowed to call the API (CORS)</small><code>{allowedOrigins(voucher).join(", ") || "—"}</code></div>
              <div><small>Apple Wallet</small><span className="dv-muted">{apple.reason}</span></div>
              <div><small>Email delivery</small><span className="dv-muted">Not configured yet (later, MailerLite or transactional email). No email is sent.</span></div>
            </div>
          </section>

          <section className="admin-card" aria-label="Statistics">
            <div className="admin-card-heading"><h2>Statistics</h2><p>Anonymous: total events and unique sessions. No IP addresses or personal data are stored.</p></div>
            <div className="dv-card-body dv-metrics">
              {metrics.map(metric => { const value = count(counts, metric.type); return <div key={metric.type}><small>{metric.label}</small><strong>{value.total}</strong><span>{value.sessions} unique · {metric.hint}</span></div>; })}
            </div>
          </section>

          <section className="admin-card" aria-label="Changes">
            <div className="admin-card-heading"><h2>Changes</h2></div>
            <div className="handed-table-wrap"><table className="handed-table">
              <tbody>
                {(audit.data ?? []).length === 0 && <tr><td className="muted-cell">No changes recorded.</td></tr>}
                {(audit.data ?? []).map((row, index) => <tr key={index}>
                  <td className="nowrap">{auditFormat.format(new Date(row.created_at))}</td>
                  <td className="nowrap strong">{row.action}</td>
                  <td>{row.actor_id ? actorName.get(row.actor_id) ?? "—" : "—"}</td>
                  <td><small>{row.changed_fields.join(", ")}</small></td>
                </tr>)}
              </tbody>
            </table></div>
          </section>
        </div>

        <aside className="dv-editor-preview">
          <h2>Google Wallet preview</h2>
          <WalletPreview voucher={voucher} logoUrl={logoUrl} heroUrl={heroUrl} />
          {voucher.image_download_enabled && status !== "draft" && status !== "archived" && status !== "expired" && <>
            <h2>Downloadable image</h2>
            <img className="dv-image-preview" src={`/api/public/vouchers/${voucher.slug}/image`} alt="Voucher image" />
          </>}
          {!voucher.archived_at && <Link className="button button-primary" href={`/vouchers/${voucher.id}/edit`}>Edit voucher</Link>}
        </aside>
      </div>
    </AppShell>
  );
}
