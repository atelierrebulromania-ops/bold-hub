import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import {
  assignDeliveryGroup, createCompany, createDeliveryGroup, createPartner, linkAccount,
  removeDeliveryGroup, setParLevel,
} from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  company_created: "Firma a fost adăugată.",
  group_created: "Delivery Group a fost creat.",
  partner_created: "Revânzătorul a fost adăugat.",
  group_assigned: "Revânzătorul a fost adăugat în grup.",
  group_removed: "Revânzătorul a fost scos din grup.",
  par_saved: "Stocul inițial pentru produs a fost salvat.",
  account_linked: "Contul de autentificare a fost asociat locației. Revânzătorul poate intra în aplicație.",
  account_unlinked: "Contul a fost dezasociat de la locație.",
};

const errors: Record<string, string> = {
  company_invalid: "Introdu un nume de firmă valid (maximum 160 caractere).",
  group_invalid: "Verifică numele și descrierea grupului.",
  partner_invalid: "Verifică firma, numele, locația, telefonul și adresa de email.",
  phone_exists: "Există deja un revânzător cu acest număr de telefon.",
  selection_invalid: "Selecția nu este validă. Reîncarcă pagina.",
  par_invalid: "Introdu un SKU și o cantitate între 0 și 100.000.",
  product_missing: "SKU-ul nu există în catalogul activ. Sincronizează mai întâi produsul din BOCP.",
  save_failed: "Nu am putut salva. Reîncarcă pagina și încearcă din nou.",
  account_invalid: "Introdu o adresă de email validă sau lasă câmpul gol pentru dezasociere.",
  account_no_user: "Nu există un cont cu acest email. Creează-l întâi în Supabase → Authentication → Users (Invite user).",
  account_staff: "Emailul aparține unui cont intern (staff). Folosește altă adresă pentru revânzător.",
  account_taken: "Contul este deja asociat altei locații.",
};

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { supabase, profile } = await requireRole(["admin"]);

  const [companiesResult, groupsResult, partnersResult, membershipsResult, parsResult, productsResult] = await Promise.all([
    supabase.from("partner_companies").select("id,company_name").order("company_name").limit(500),
    supabase.from("delivery_groups").select("id,name,description").order("name").limit(500),
    supabase.from("partners").select("id,company_id,business_name,location_name,contact_phone,contact_email,is_important_client,active,auth_user_id")
      .order("business_name").limit(500),
    supabase.from("partner_delivery_groups").select("partner_id,delivery_group_id").limit(2000),
    supabase.from("partner_par_levels").select("partner_id,product_id,par_level_quantity,products(name,sku)").limit(2000),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const loadError = [companiesResult, groupsResult, partnersResult, membershipsResult, parsResult, productsResult]
    .some(result => result.error);
  const companies = companiesResult.data ?? [];
  const groups = groupsResult.data ?? [];
  const partners = partnersResult.data ?? [];
  const memberships = membershipsResult.data ?? [];
  const parLevels = parsResult.data ?? [];
  const productCount = productsResult.count ?? 0;
  const params = await searchParams;
  const companyNames = new Map(companies.map(company => [company.id, company.company_name]));
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const membershipsByPartner = new Map<string, typeof groups>();
  for (const membership of memberships) {
    const group = groupsById.get(membership.delivery_group_id);
    if (group) membershipsByPartner.set(membership.partner_id,
      [...(membershipsByPartner.get(membership.partner_id) ?? []), group]);
  }
  const levelsByPartner = new Map<string, typeof parLevels>();
  for (const level of parLevels) {
    levelsByPartner.set(level.partner_id, [...(levelsByPartner.get(level.partner_id) ?? []), level]);
  }

  return (
    <AppShell profile={profile} active="/admin/partners" section="Administrare" title="Revânzători"
      note={{ title: "Configurare refill", text: "Setează mai întâi firmele și grupurile." }}>
          <div className="page-heading"><div><p className="eyebrow">CONFIGURARE REFILL</p><h1>Revânzători</h1><p className="muted">Firme, locații, Delivery Groups și stocuri inițiale per produs.</p></div><span className="page-heading-chip preview-chip">Administrare</span></div>
          {params.notice && notices[params.notice] && <p className="preview-alert success admin-feedback" role="status">{notices[params.notice]}</p>}
          {params.error && errors[params.error] && <p className="notice error admin-feedback" role="alert">{errors[params.error]}</p>}
          {loadError ? <p className="notice error" role="alert">Datele de configurare nu pot fi încărcate acum.</p> : <>
            <div className="partner-summary" aria-label="Rezumat configurare">
              <div><strong>{companies.length}</strong><span>firme</span></div>
              <div><strong>{partners.length}</strong><span>locații</span></div>
              <div><strong>{groups.length}</strong><span>Delivery Groups</span></div>
              <div><strong>{productCount}</strong><span>produse active</span></div>
            </div>

            <div className="partner-setup-grid">
              <section className="admin-card" aria-labelledby="companies-title">
                <div className="admin-card-heading"><h2 id="companies-title">Firme</h2><p>Firma este separată de locație, pentru extindere ulterioară.</p></div>
                <form action={createCompany} className="admin-form compact-form">
                  <label htmlFor="company-name">Nume firmă</label>
                  <div className="admin-inline"><input id="company-name" name="company_name" maxLength={160} required placeholder="Ex. Partener SRL"/><button className="button button-primary" type="submit">Adaugă</button></div>
                </form>
                {companies.length > 0 && <ul className="admin-simple-list">{companies.map(company => <li key={company.id}>{company.company_name}</li>)}</ul>}
              </section>

              <section className="admin-card" aria-labelledby="groups-title">
                <div className="admin-card-heading"><h2 id="groups-title">Delivery Groups</h2><p>O locație poate aparține mai multor trasee.</p></div>
                <form action={createDeliveryGroup} className="admin-form compact-form">
                  <label htmlFor="group-name">Nume grup</label><input id="group-name" name="name" maxLength={120} required placeholder="Ex. București Nord"/>
                  <label htmlFor="group-description">Descriere (opțional)</label><input id="group-description" name="description" maxLength={500} placeholder="Zona / traseul"/>
                  <button className="button button-primary" type="submit">Creează grup</button>
                </form>
                {groups.length > 0 && <ul className="admin-simple-list">{groups.map(group => <li key={group.id}><strong>{group.name}</strong>{group.description && <small>{group.description}</small>}</li>)}</ul>}
              </section>
            </div>

            <section className="admin-card partner-create" aria-labelledby="new-partner-title">
              <div className="admin-card-heading"><h2 id="new-partner-title">Adaugă locație / revânzător</h2><p>Contactul de aici nu creează automat un cont de autentificare.</p></div>
              {companies.length === 0 ? <p className="admin-empty-note">Adaugă mai întâi firma de mai sus.</p> : <form action={createPartner} className="admin-form partner-create-form">
                <div><label htmlFor="partner-company">Firmă</label><select id="partner-company" name="company_id" required defaultValue=""><option value="" disabled>Alege firma</option>{companies.map(company => <option key={company.id} value={company.id}>{company.company_name}</option>)}</select></div>
                <div><label htmlFor="partner-business">Nume afișat</label><input id="partner-business" name="business_name" maxLength={160} required placeholder="Ex. Hotel / magazin"/></div>
                <div><label htmlFor="partner-location">Locație</label><input id="partner-location" name="location_name" maxLength={160} required placeholder="Ex. București, Piața Romană"/></div>
                <div><label htmlFor="partner-phone">Telefon responsabil comenzi</label><input id="partner-phone" name="contact_phone" type="tel" maxLength={30} required placeholder="+40…"/></div>
                <div><label htmlFor="partner-email">Email (opțional)</label><input id="partner-email" name="contact_email" type="email" maxLength={254} placeholder="contact@partener.ro"/></div>
                <label className="admin-checkbox"><input type="checkbox" name="is_important_client"/> Client prioritar — livrare imediată</label>
                <button className="button button-primary" type="submit">Salvează revânzătorul</button>
              </form>}
            </section>

            <section className="admin-card partner-list-section" aria-labelledby="partner-list-title">
              <div className="admin-card-heading"><h2 id="partner-list-title">Locații configurate</h2><p>Asociază grupuri și setează stocul inițial diferit pentru fiecare produs.</p></div>
              {partners.length === 0 ? <p className="admin-empty-note">Nu există încă revânzători. Creează prima locație mai sus.</p> : <div className="partner-list">
                {partners.map(partner => {
                  const assigned = membershipsByPartner.get(partner.id) ?? [];
                  const levels = levelsByPartner.get(partner.id) ?? [];
                  return <article className="partner-card" key={partner.id}>
                    <div className="partner-card-heading"><div><h3>{partner.business_name}</h3><p>{companyNames.get(partner.company_id ?? "") ?? "Firmă neasociată"} · {partner.location_name}</p><small>{partner.contact_phone}{partner.contact_email ? ` · ${partner.contact_email}` : ""}</small></div><div className="partner-tags">{partner.is_important_client && <span className="partner-tag important">Important</span>}{!partner.active && <span className="partner-tag">Inactiv</span>}<span className={partner.auth_user_id ? "partner-tag linked" : "partner-tag"}>{partner.auth_user_id ? "Cont activ" : "Fără cont"}</span></div></div>
                    <form action={linkAccount} className="admin-inline admin-mini-form account-link-form">
                      <input type="hidden" name="partner_id" value={partner.id}/>
                      <input name="email" type="email" maxLength={254} placeholder={partner.auth_user_id ? "Email nou (gol = dezasociere)" : "Email cont revânzător"} aria-label={`Cont de autentificare pentru ${partner.business_name}`}/>
                      <button className="button button-outline" type="submit">{partner.auth_user_id ? "Schimbă contul" : "Asociază contul"}</button>
                    </form>
                    <div className="partner-card-grid">
                      <div><h4>Delivery Groups</h4><div className="group-chip-list">{assigned.length ? assigned.map(group => <form action={removeDeliveryGroup} key={group.id}><input type="hidden" name="partner_id" value={partner.id}/><input type="hidden" name="delivery_group_id" value={group.id}/><button type="submit" className="group-chip" aria-label={`Scoate ${partner.business_name} din grupul ${group.name}`} title={`Scoate din ${group.name}`}>{group.name}<span aria-hidden="true">×</span></button></form>) : <span className="admin-empty-inline">Niciun grup</span>}</div>
                        {groups.length > 0 && <form action={assignDeliveryGroup} className="admin-inline admin-mini-form"><input type="hidden" name="partner_id" value={partner.id}/><select name="delivery_group_id" aria-label={`Adaugă ${partner.business_name} în Delivery Group`} required defaultValue=""><option value="" disabled>Alege un grup</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button className="button button-outline" type="submit">Adaugă</button></form>}
                      </div>
                      <div><h4>Stoc inițial (par level)</h4>{levels.length ? <ul className="par-list">{levels.map(level => <li key={level.product_id}><span>{level.products?.name ?? "Produs"}<small>SKU {level.products?.sku ?? "—"}</small></span><strong>{level.par_level_quantity} buc.</strong></li>)}</ul> : <p className="admin-empty-inline">Niciun produs configurat</p>}
                        {productCount > 0 ? <form action={setParLevel} className="admin-inline admin-mini-form"><input type="hidden" name="partner_id" value={partner.id}/><input name="sku" maxLength={100} required placeholder="SKU produs" aria-label={`SKU pentru ${partner.business_name}`}/><input name="par_level_quantity" type="number" min={0} max={100000} step={1} required placeholder="Buc." aria-label={`Stoc inițial pentru ${partner.business_name}`}/><button className="button button-outline" type="submit">Salvează</button></form> : <p className="admin-empty-inline">Par levels devin disponibile după sincronizarea catalogului BOCP.</p>}
                      </div>
                    </div>
                  </article>;
                })}
              </div>}
            </section>
          </>}
    </AppShell>
  );
}
