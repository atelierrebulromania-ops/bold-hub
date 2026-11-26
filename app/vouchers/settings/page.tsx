import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { googleWalletConfig } from "@/lib/vouchers/google-wallet";
import { appleWalletStatus, rateLimits, voucherRoles } from "@/lib/vouchers/server";
import { ConnectionTest } from "../voucher-actions";

export const dynamic = "force-dynamic";

// Integration status. Only facts about the configuration are shown (set / not set, issuer id); the service
// account JSON and its private key are never displayed, logged or sent to the browser.
export default async function VoucherSettingsPage() {
  const { profile } = await requireRole(voucherRoles);
  const google = googleWalletConfig();
  const apple = appleWalletStatus();
  const credentials = google.ready ? "present" : google.credentials;
  const row = (label: string, value: React.ReactNode) => <div><dt>{label}</dt><dd>{value}</dd></div>;
  const chip = (ok: boolean, yes: string, no: string) => <span className={`outcome-chip ${ok ? "ok" : "inactive"}`}>{ok ? yes : no}</span>;

  return (
    <AppShell profile={profile} active="/vouchers/settings" section="Digital Vouchers" title="Settings"
      note={{ title: "Wallet settings", text: "The credentials live in the server's environment variables (Vercel). This page only shows whether they are set and lets you test them." }}>
      <div className="page-heading"><div><h1>Settings</h1><p className="muted">Wallet integrations and the public API.</p></div></div>
      <div className="dv-settings">
        <section className="admin-card" aria-label="Google Wallet">
          <div className="admin-card-heading"><h2>Google Wallet {chip(google.ready, "Configured", "Not configured")}</h2>
            <p>Offers API, signed with a service account on the server. Set in the environment variables of the deployment.</p></div>
          <div className="dv-card-body">
            <dl className="dv-details">
              {row("GOOGLE_WALLET_ENABLED", chip(google.ready || ("enabled" in google && google.enabled), "true", "not true"))}
              {row("Issuer ID (GOOGLE_WALLET_ISSUER_ID)", google.issuerId ? <code>{google.issuerId}</code> : <span className="dv-muted">not set</span>)}
              {row("Project (GOOGLE_WALLET_PROJECT_ID)", google.projectId ? <code>{google.projectId}</code> : <span className="dv-muted">not set</span>)}
              {row("Service account (GOOGLE_WALLET_CREDENTIALS_JSON)", credentials === "present" ? chip(true, "Set (hidden)", "") : <span className="hc-field-error">{credentials === "missing" ? "Not set" : "Not a valid service account key"}</span>)}
            </dl>
            {!google.ready && <p className="dv-note">{google.reason}</p>}
            <ConnectionTest />
          </div>
        </section>

        <section className="admin-card" aria-label="Apple Wallet">
          <div className="admin-card-heading"><h2>Apple Wallet {chip(false, "", "Not configured")}</h2>
            <p>{apple.reason} The Apple button is never shown to customers until it works.</p></div>
          <div className="dv-card-body">
            <dl className="dv-details">
              {row("APPLE_WALLET_ENABLED", <code>{apple.flag ? "true" : "false"}</code>)}
              {row("Pass Type ID, Team ID, certificates", <span className="dv-muted">Pending Apple Developer approval</span>)}
            </dl>
          </div>
        </section>

        <section className="admin-card" aria-label="Email delivery">
          <div className="admin-card-heading"><h2>Email delivery {chip(false, "", "Not configured")}</h2>
            <p>Will use MailerLite or the transactional email service. No email is sent and nobody is subscribed to the newsletter by this module; that will need a separate consent.</p></div>
        </section>

        <section className="admin-card" aria-label="Public API">
          <div className="admin-card-heading"><h2>Public API</h2>
            <p>Used by the Shopify landing page, without a BoldHub account. It never lists vouchers and returns only published, non-archived ones.</p></div>
          <div className="dv-card-body">
            <dl className="dv-details">
              {row("Addresses", <code>/api/public/vouchers/&lt;slug&gt;</code>)}
              {row("CORS", "Only the voucher's website, landing page and discount link (with and without www.), plus the extra sites set on the voucher.")}
              {row("Rate limits (per visitor, per minute)", `data ${rateLimits.read} · wallet ${rateLimits.wallet} · events ${rateLimits.events} · image ${rateLimits.image}`)}
              {row("Privacy", "No IP addresses stored: visitors are counted by a salted hash that is dropped after a day. Events keep a random session id, UTM tags, device type and the referring site only.")}
            </dl>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
