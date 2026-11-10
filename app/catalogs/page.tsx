import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import { catalogRoles, requireRole } from "@/lib/auth";
import { catalogCurrencies, catalogLanguages, type CatalogLanguage } from "@/lib/horeca/catalog";
import { createCatalog, deleteCatalog, duplicateCatalog } from "./actions";
import { ConfirmSubmit } from "./confirm-submit";

export const dynamic = "force-dynamic";

const notices: Record<string, string> = {
  deleted: "Catalogul a fost șters.",
};
const errors: Record<string, string> = {
  title: "Scrie titlul catalogului (cel mult 120 de caractere).",
  fields: "Alege limba și moneda catalogului.",
  save: "Nu s-a putut salva. Încearcă din nou.",
  delete: "Catalogul nu a putut fi șters. Încearcă din nou.",
};

const dateFormat = new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Bucharest" });

export default async function CatalogsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { supabase, profile } = await requireRole(catalogRoles);
  const params = await searchParams;
  const { data: catalogs, error } = await supabase.from("horeca_catalogs")
    .select("id,title,language,currency,updated_at,horeca_catalog_products(count)").order("updated_at", { ascending: false });

  return (
    <AppShell profile={profile} active="/catalogs" section="Cataloage" title="Cataloage HoReCa"
      note={{ title: "Cataloage HoReCa", text: "Creezi și actualizezi listele de prețuri HoReCa. Designul PDF-ului este fix: modifici doar conținutul." }}>
      <div className="page-heading">
        <div><h1>Cataloage HoReCa</h1><p className="muted">Fiecare catalog are propriile colecții, produse, prețuri și condiții comerciale.</p></div>
      </div>
      {params.notice && notices[params.notice] && <p className="preview-alert success admin-feedback" role="status">{notices[params.notice]}</p>}
      {params.error && errors[params.error] && <p className="preview-alert warning admin-feedback" role="alert">{errors[params.error]}</p>}
      {error && <p className="preview-alert warning admin-feedback" role="alert">Cataloagele nu au putut fi încărcate. Reîncarcă pagina.</p>}

      <section className="admin-card hc-create" aria-label="Catalog nou">
        <h2>Catalog nou</h2>
        <form action={createCatalog} className="hc-create-form">
          <label>Titlu<input name="title" required maxLength={120} placeholder="ex. HoReCa Italia – Ianuarie 2027" /></label>
          <label>Limba<select name="language" defaultValue="ro">{Object.entries(catalogLanguages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label>Moneda<select name="currency" defaultValue="EUR">{catalogCurrencies.map(code => <option key={code}>{code}</option>)}</select></label>
          <SubmitButton className="button button-primary">Creează catalogul</SubmitButton>
        </form>
      </section>

      <section className="board-panel" aria-label="Cataloage">
        <div className="handed-table-wrap"><table className="handed-table hc-list">
          <thead><tr><th>Catalog</th><th>Limba</th><th>Moneda</th><th>Ultima modificare</th><th>Produse</th><th aria-label="Acțiuni" /></tr></thead>
          <tbody>
            {(catalogs ?? []).length === 0 && <tr><td colSpan={6} className="muted-cell">Nu există încă niciun catalog. Creează primul catalog mai sus.</td></tr>}
            {(catalogs ?? []).map(catalog => {
              const count = catalog.horeca_catalog_products?.[0]?.count ?? 0;
              return <tr key={catalog.id}>
                <td className="strong"><Link href={`/catalogs/${catalog.id}`}>{catalog.title}</Link></td>
                <td className="nowrap">{catalogLanguages[catalog.language as CatalogLanguage] ?? catalog.language}</td>
                <td className="nowrap">{catalog.currency}</td>
                <td className="nowrap">{dateFormat.format(new Date(catalog.updated_at))}</td>
                <td className="nowrap">{count}</td>
                <td><div className="hc-row-actions">
                  <Link className="button button-primary" href={`/catalogs/${catalog.id}`}>Editare</Link>
                  <form action={duplicateCatalog}><input type="hidden" name="id" value={catalog.id} />
                    <ConfirmSubmit className="button button-outline" message={`Faci o copie completă a catalogului „${catalog.title}”? Copia este independentă: modificările ei nu schimbă originalul.`}>Duplicare</ConfirmSubmit></form>
                  <Link className="button button-outline" href={`/catalogs/${catalog.id}/preview`}>Previzualizare</Link>
                  <a className="button button-outline" href={`/catalogs/${catalog.id}/pdf?download=1`}>Export PDF</a>
                  <form action={deleteCatalog}><input type="hidden" name="id" value={catalog.id} />
                    <ConfirmSubmit className="button danger-outline" message={`Ștergi definitiv catalogul „${catalog.title}”, cu toate colecțiile, produsele (${count}) și fotografiile lui? Nu se poate anula.`}>Ștergere</ConfirmSubmit></form>
                </div></td>
              </tr>;
            })}
          </tbody>
        </table></div>
      </section>
    </AppShell>
  );
}
