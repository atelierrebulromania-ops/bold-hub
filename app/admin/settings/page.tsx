import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import { roleLabels } from "@/lib/accounts";
import { requireRole } from "@/lib/auth";
import { rotateLeadsKey, setCrmAccess, setLeadOfferDays } from "./actions";

export const dynamic = "force-dynamic";

const sources = [
  { value: "meta", label: "Meta Lead Ads (prin Make / Zapier)" },
  { value: "website", label: "Formularul de pe site (MailerLite)" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { supabase, profile } = await requireRole(["admin"]);
  const params = await searchParams;
  const [{ data: users }, { data: settings }] = await Promise.all([
    supabase.from("app_users").select("id,full_name,role,active,crm_access").eq("active", true).order("full_name"),
    supabase.from("app_settings").select("leads_webhook_key,lead_offer_days").eq("id", 1).maybeSingle(),
  ]);
  const host = (await headers()).get("host") ?? "www.boldhub.ro";
  const origin = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const key = settings?.leads_webhook_key ?? "";

  return (
    <AppShell profile={profile} active="/admin/settings" section="Administrare" title="Setări"
      note={{ title: "Setări", text: "Cine are acces la Lead și de unde vin lead-urile." }}>
      {params.notice === "days" && <p className="preview-alert success admin-feedback" role="status">Termenul a fost salvat. Se aplică ofertelor marcate de acum înainte.</p>}
      {params.notice === "rotated" && <p className="preview-alert success admin-feedback" role="status">Cheia a fost schimbată. Actualizează linkurile în Make, Zapier și MailerLite.</p>}

      <section className="board-panel" aria-label="Acces Lead">
        <div className="board-panel-heading"><div><h2>Acces la Lead</h2><p>Cei bifați văd toate lead-urile. Doar agenții (Account) le pot prelua; administratorul are acces mereu.</p></div></div>
        <div className="handed-table-wrap"><table className="handed-table settings-users">
          <thead><tr><th>Utilizator</th><th>Rol</th><th>Acces Lead</th></tr></thead>
          <tbody>{(users ?? []).map((user) => <tr key={user.id}>
            <td className="strong">{user.full_name}</td>
            <td className="nowrap">{roleLabels[user.role]}{user.role === "account" ? " · poate prelua" : ""}</td>
            <td className="nowrap">{user.role === "admin" ? <span className="outcome-chip ok">Mereu</span>
              : <form action={setCrmAccess}><input type="hidden" name="user_id" value={user.id} /><input type="hidden" name="on" value={user.crm_access ? "false" : "true"} />
                <SubmitButton className={user.crm_access ? "button button-outline" : "button button-primary"}>{user.crm_access ? "Scoate accesul" : "Dă acces"}</SubmitButton></form>}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="admin-card auto-import-card" aria-label="Termen ofertă">
        <div><h2>Termen de răspuns la ofertă</h2>
          <p>Când un lead trece în „Ofertă trimisă”, agentul primește o notificare după atâtea zile, ca să revină la client și să-l marcheze câștigat sau pierdut.</p></div>
        <form action={setLeadOfferDays} className="settings-days"><input type="number" name="days" min={1} max={60} defaultValue={settings?.lead_offer_days ?? 7} aria-label="Zile" /><span>zile</span>
          <SubmitButton className="button button-primary">Salvează</SubmitButton></form>
      </section>

      <section className="admin-card auto-import-card" aria-label="Primire lead-uri">
        <div>
          <h2>Primire lead-uri</h2>
          <p>Lipește linkul potrivit în Make / Zapier (acțiune „HTTP – Make a request”, metoda POST, conținut JSON) sau ca webhook în MailerLite. Linkul conține cheia secretă: nu-l publica.</p>
          <div className="webhook-urls">{sources.map((source) => <div key={source.value}><span>{source.label}</span>
            <code>{`${origin}/api/leads/inbound?source=${source.value}&key=${key}`}</code></div>)}</div>
        </div>
        <form action={rotateLeadsKey}><SubmitButton className="button button-outline">Schimbă cheia</SubmitButton></form>
      </section>
    </AppShell>
  );
}
