import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import {
  assignDeliveryGroup, createCompany, createDeliveryGroup, createReseller,
  removeDeliveryGroup, setParLevel,
} from "./actions";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  company_created: "Firma a fost adăugată.",
  group_created: "Delivery Group a fost creat.",
  reseller_created: "Revânzătorul a fost adăugat.",
  group_assigned: "Revânzătorul a fost adăugat în grup.",
  group_removed: "Revânzătorul a fost scos din grup.",
  par_saved: "Stocul inițial pentru produs a fost salvat.",
};

const errors: Record<string, string> = {
  company_invalid: "Introdu un nume de firmă valid (maximum 160 caractere).",
  group_invalid: "Verifică numele și descrierea grupului.",
  reseller_invalid: "Verifică firma, numele, locația, telefonul și adresa de email.",
  phone_exists: "Există deja un revânzător cu acest număr de telefon.",
  selection_invalid: "Selecția nu este validă. Reîncarcă pagina.",
  par_invalid: "Introdu un SKU și o cantitate între 0 și 100.000.",
  product_missing: "SKU-ul nu există în catalogul activ. Sincronizează mai întâi produsul din BOCP.",
  save_failed: "Nu am putut salva. Reîncarcă pagina și încearcă din nou.",
};

export default async function ResellersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: profile } = await supabase.from("app_users")
    .select("full_name,role,active").eq("id", userId).maybeSingle();
  if (!profile?.active || profile.role !== "admin") redirect("/access");

  const [companiesResult, groupsResult, resellersResult, membershipsResult, parsResult, productsResult] = await Promise.all([
    supabase.from("reseller_companies").select("id,company_name").order("company_name").limit(500),
    supabase.from("delivery_groups").select("id,name,description").order("name").limit(500),
    supabase.from("resellers").select("id,company_id,business_name,location_name,contact_phone,contact_email,is_important_client,active")
      .order("business_name").limit(500),
    supabase.from("reseller_delivery_groups").select("reseller_id,delivery_group_id").limit(2000),
    supabase.from("reseller_par_levels").select("reseller_id,product_id,par_level_quantity,products(name,sku)").limit(2000),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const loadError = [companiesResult, groupsResult, resellersResult, membershipsResult, parsResult, productsResult]
    .some(result => result.error);
  const companies = companiesResult.data ?? [];
  const groups = groupsResult.data ?? [];
  const resellers = resellersResult.data ?? [];
  const memberships = membershipsResult.data ?? [];
  const parLevels = parsResult.data ?? [];
  const productCount = productsResult.count ?? 0;
  const params = await searchParams;
  const companyNames = new Map(companies.map(company => [company.id, company.company_name]));
  const groupsById = new Map(groups.map(group => [group.id, group]));
  const membershipsByReseller = new Map<string, typeof groups>();
  for (const membership of memberships) {
    const group = groupsById.get(membership.delivery_group_id);
    if (group) membershipsByReseller.set(membership.reseller_id,
      [...(membershipsByReseller.get(membership.reseller_id) ?? []), group]);
  }
  const levelsByReseller = new Map<string, typeof parLevels>();
  for (const level of parLevels) {
    levelsByReseller.set(level.reseller_id, [...(levelsByReseller.get(level.reseller_id) ?? []), level]);
  }

  return (
    <main className="app-shell">
      <aside className="app-sidebar" aria-label="Navigație principală">
        <div className="brand"><div className="brand-icon">B<span>·</span></div><div><strong>BoldHub</strong><small>ATELIER REBUL</small></div></div>
        <div className="sidebar-workspace"><span className="workspace-avatar">AR</span><span><strong>Atelier Rebul</strong><small>Spațiu de lucru</small></span></div>
        <nav className="sidebar-nav">
          <p className="sidebar-label">DEPOZIT</p>
          <Link className="sidebar-link" href="/orders"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 14h4"/></svg>Comenzi online</Link>
          <p className="sidebar-label admin-sidebar-label">ADMINISTRARE</p>
          <span className="sidebar-link active" aria-current="page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20v-8l8-4 8 4v8M4 14h16M9 20v-4h6v4M12 8V4"/></svg>Revânzători</span>
          <Link className="sidebar-link" href="/admin/integrations"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h8M4 17h8M16 4v6M16 14v6"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="12" r="2"/></svg>Integrări</Link>
        </nav>
        <div className="sidebar-bottom"><span className="sidebar-bottom-icon" aria-hidden="true">i</span><div><strong>Configurare refill</strong><p>Setează mai întâi firmele și grupurile.</p></div></div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb"><span>Administrare</span><span aria-hidden="true">/</span><strong>Revânzători</strong></div>
          <div className="topbar-right"><div className="user-menu"><span className="user-avatar" aria-hidden="true">{profile.full_name?.trim().charAt(0).toUpperCase() || "A"}</span><span className="user-name">{profile.full_name}</span><form action={signOut}><button type="submit" className="text-button">Ieșire</button></form></div></div>
        </header>
        <div className="page-content">
          <div className="page-heading"><div><p className="eyebrow">CONFIGURARE REFILL</p><h1>Revânzători</h1><p className="muted">Firme, locații, Delivery Groups și stocuri inițiale per produs.</p></div><span className="page-heading-chip preview-chip">Administrare</span></div>
          {params.notice && notices[params.notice] && <p className="preview-alert success admin-feedback" role="status">{notices[params.notice]}</p>}
          {params.error && errors[params.error] && <p className="notice error admin-feedback" role="alert">{errors[params.error]}</p>}
          {loadError ? <p className="notice error" role="alert">Datele de configurare nu pot fi încărcate acum.</p> : <>
            <div className="reseller-summary" aria-label="Rezumat configurare">
              <div><strong>{companies.length}</strong><span>firme</span></div>
              <div><strong>{resellers.length}</strong><span>locații</span></div>
              <div><strong>{groups.length}</strong><span>Delivery Groups</span></div>
              <div><strong>{productCount}</strong><span>produse active</span></div>
            </div>

            <div className="reseller-setup-grid">
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

            <section className="admin-card reseller-create" aria-labelledby="new-reseller-title">
              <div className="admin-card-heading"><h2 id="new-reseller-title">Adaugă locație / revânzător</h2><p>Contactul de aici nu creează automat un cont de autentificare.</p></div>
              {companies.length === 0 ? <p className="admin-empty-note">Adaugă mai întâi firma de mai sus.</p> : <form action={createReseller} className="admin-form reseller-create-form">
                <div><label htmlFor="reseller-company">Firmă</label><select id="reseller-company" name="company_id" required defaultValue=""><option value="" disabled>Alege firma</option>{companies.map(company => <option key={company.id} value={company.id}>{company.company_name}</option>)}</select></div>
                <div><label htmlFor="reseller-business">Nume afișat</label><input id="reseller-business" name="business_name" maxLength={160} required placeholder="Ex. Hotel / magazin"/></div>
                <div><label htmlFor="reseller-location">Locație</label><input id="reseller-location" name="location_name" maxLength={160} required placeholder="Ex. București, Piața Romană"/></div>
                <div><label htmlFor="reseller-phone">Telefon responsabil comenzi</label><input id="reseller-phone" name="contact_phone" type="tel" maxLength={30} required placeholder="+40…"/></div>
                <div><label htmlFor="reseller-email">Email (opțional)</label><input id="reseller-email" name="contact_email" type="email" maxLength={254} placeholder="contact@partener.ro"/></div>
                <label className="admin-checkbox"><input type="checkbox" name="is_important_client"/> Client important (livrare prioritară)</label>
                <button className="button button-primary" type="submit">Salvează revânzătorul</button>
              </form>}
            </section>

            <section className="admin-card reseller-list-section" aria-labelledby="reseller-list-title">
              <div className="admin-card-heading"><h2 id="reseller-list-title">Locații configurate</h2><p>Asociază grupuri și setează stocul inițial diferit pentru fiecare produs.</p></div>
              {resellers.length === 0 ? <p className="admin-empty-note">Nu există încă revânzători. Creează prima locație mai sus.</p> : <div className="reseller-list">
                {resellers.map(reseller => {
                  const assigned = membershipsByReseller.get(reseller.id) ?? [];
                  const levels = levelsByReseller.get(reseller.id) ?? [];
                  return <article className="reseller-card" key={reseller.id}>
                    <div className="reseller-card-heading"><div><h3>{reseller.business_name}</h3><p>{companyNames.get(reseller.company_id ?? "") ?? "Firmă neasociată"} · {reseller.location_name}</p><small>{reseller.contact_phone}{reseller.contact_email ? ` · ${reseller.contact_email}` : ""}</small></div><div className="reseller-tags">{reseller.is_important_client && <span className="reseller-tag important">Important</span>}{!reseller.active && <span className="reseller-tag">Inactiv</span>}</div></div>
                    <div className="reseller-card-grid">
                      <div><h4>Delivery Groups</h4><div className="group-chip-list">{assigned.length ? assigned.map(group => <form action={removeDeliveryGroup} key={group.id}><input type="hidden" name="reseller_id" value={reseller.id}/><input type="hidden" name="delivery_group_id" value={group.id}/><button type="submit" className="group-chip" aria-label={`Scoate ${reseller.business_name} din grupul ${group.name}`} title={`Scoate din ${group.name}`}>{group.name}<span aria-hidden="true">×</span></button></form>) : <span className="admin-empty-inline">Niciun grup</span>}</div>
                        {groups.length > 0 && <form action={assignDeliveryGroup} className="admin-inline admin-mini-form"><input type="hidden" name="reseller_id" value={reseller.id}/><select name="delivery_group_id" aria-label={`Adaugă ${reseller.business_name} în Delivery Group`} required defaultValue=""><option value="" disabled>Alege un grup</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button className="button button-outline" type="submit">Adaugă</button></form>}
                      </div>
                      <div><h4>Stoc inițial (par level)</h4>{levels.length ? <ul className="par-list">{levels.map(level => <li key={level.product_id}><span>{level.products?.name ?? "Produs"}<small>SKU {level.products?.sku ?? "—"}</small></span><strong>{level.par_level_quantity} buc.</strong></li>)}</ul> : <p className="admin-empty-inline">Niciun produs configurat</p>}
                        {productCount > 0 ? <form action={setParLevel} className="admin-inline admin-mini-form"><input type="hidden" name="reseller_id" value={reseller.id}/><input name="sku" maxLength={100} required placeholder="SKU produs" aria-label={`SKU pentru ${reseller.business_name}`}/><input name="par_level_quantity" type="number" min={0} max={100000} step={1} required placeholder="Buc." aria-label={`Stoc inițial pentru ${reseller.business_name}`}/><button className="button button-outline" type="submit">Salvează</button></form> : <p className="admin-empty-inline">Par levels devin disponibile după sincronizarea catalogului BOCP.</p>}
                      </div>
                    </div>
                  </article>;
                })}
              </div>}
            </section>
          </>}
        </div>
      </div>
    </main>
  );
}
