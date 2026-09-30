import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { cookies } from "next/headers";
import { catalogScopeCookie, isB2bSku } from "@/lib/b2b-products";
import { enableAll, saveEan, setCatalogScope, setMode, syncCatalog } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

const errors: Record<string, string> = {
  invalid: "EAN-ul trebuie să aibă 8–14 cifre.",
  duplicate: "Acest EAN aparține deja altui produs.",
  needs_ean: "Completează mai întâi EAN-ul produsului.",
  not_found: "Produsul nu mai există. Reîncarcă pagina.",
  denied: "Doar administratorul poate modifica catalogul.",
  save_failed: "Nu am putut salva. Încearcă din nou.",
  bocp_unreachable: "BOCP nu a răspuns sau a refuzat accesul (IP-ul serverului trebuie să fie în whitelist). Nu s-a modificat nimic.",
  catalog_too_large: "Catalogul BOCP are mai multe pagini decât limita de siguranță. Nu s-a modificat nimic.",
};

type SyncParams = { total?: string; withEan?: string; created?: string; eanSet?: string; stockSet?: string; check?: string };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ filter?: string; notice?: string; error?: string } & SyncParams> }) {
  const { supabase, profile } = await requireRole(["admin"]);
  const params = await searchParams;
  const filter = params.filter === "missing" || params.filter === "sku" ? params.filter : "all";
  const { data, error } = await supabase.from("products").select("id,sku,ean,name,variant_label,scan_mode,active")
    .eq("active", true).order("name").limit(2000);
  const everything = data ?? [];
  const scope = (await cookies()).get(catalogScopeCookie)?.value === "all" ? "all" : "ar";
  const products = scope === "all" ? everything : everything.filter(product => isB2bSku(product.sku));
  const withEan = products.filter(product => product.ean).length;
  const eanMode = products.filter(product => product.scan_mode === "ean").length;
  // "Activează EAN pentru toate" applies to the whole catalog, whatever is shown.
  const ready = everything.filter(product => product.ean && product.scan_mode === "sku").length;
  const visible = products.filter(product => filter === "missing" ? !product.ean : filter === "sku" ? product.scan_mode === "sku" : true);
  const enabled = params.notice?.startsWith("enabled_") ? Number(params.notice.slice(8)) : null;

  return (
    <AppShell profile={profile} active="/admin/catalog" section="Administrare" title="Catalog & EAN"
      note={{ title: "Trecere la EAN", text: "Activează EAN doar după test pe scannerele Zebra." }}>
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRARE</p><h1>Catalog & EAN</h1><p className="muted">Completează EAN-urile lipsă și trece produsele de la confirmarea temporară după SKU la scanarea fizică a EAN-ului.</p></div></div>
      {params.notice === "synced" && <div className="preview-alert success admin-feedback" role="status">
        <strong>Catalog sincronizat din BOCP.</strong>
        <span>{params.total} produse active în BOCP, dintre care {params.withEan} cu EAN valid în „Cod bare”. {params.created} produse noi, {params.eanSet} EAN-uri completate, stoc BOCP actualizat pentru {params.stockSet} produse.</span>
        {params.check && <span>De verificat în BOCP (EAN duplicat, invalid sau deja folosit): {params.check.split(",").join(", ")}.</span>}
      </div>}
      {params.notice === "saved" && <p className="preview-alert success admin-feedback" role="status">Salvat. Comenzile nepreluate au fost actualizate la noul mod de scanare.</p>}
      {enabled !== null && <p className="preview-alert success admin-feedback" role="status">{enabled} {enabled === 1 ? "produs a trecut" : "produse au trecut"} pe scanare EAN.</p>}
      {params.error && errors[params.error] && <p className="notice error admin-feedback" role="alert">{errors[params.error]}</p>}
      {error ? <p className="notice error" role="alert">Catalogul nu poate fi încărcat acum.</p> : <>
        <div className="partner-summary" aria-label="Rezumat catalog">
          <div><strong>{products.length}</strong><span>produse active</span></div>
          <div><strong>{products.length - withEan}</strong><span>fără EAN</span></div>
          <div><strong>{ready}</strong><span>cu EAN, încă pe SKU</span></div>
          <div><strong>{eanMode}</strong><span>scanare EAN activă</span></div>
        </div>
        <section className="admin-card">
          <div className="admin-card-heading catalog-heading">
            <div><h2>Produse</h2><p>EAN-ul de scanare vine din câmpul BOCP „Cod bare” (câmpul „Cod EAN” din BOCP nu este folosit). Schimbarea modului afectează doar comenzile încă nepreluate.</p></div>
            <div className="heading-actions">
              <form action={syncCatalog}><input type="hidden" name="filter" value={filter}/><SubmitButton className="button button-outline">Sincronizează din BOCP</SubmitButton></form>
              {ready > 0 && <form action={enableAll}><input type="hidden" name="filter" value={filter}/><SubmitButton className="button button-primary">Activează EAN pentru toate cele {ready}{scope === "ar" ? " (tot catalogul)" : ""}</SubmitButton></form>}
            </div>
          </div>
          <form action={setCatalogScope} className="catalog-scope" aria-label="Produse afișate">
            <input type="hidden" name="filter" value={filter}/>
            <span>Produse afișate</span>
            <div className="dashboard-presets">
              <SubmitButton name="scope" value="ar" className={scope === "ar" ? "preset active" : "preset"} aria-pressed={scope === "ar"}>Atelier Rebul (AT, PA)</SubmitButton>
              <SubmitButton name="scope" value="all" className={scope === "all" ? "preset active" : "preset"} aria-pressed={scope === "all"}>Toate din BOCP</SubmitButton>
            </div>
          </form>
          <div className="dashboard-presets catalog-filters">
            <Link className={filter === "all" ? "preset active" : "preset"} href="/admin/catalog">Toate</Link>
            <Link className={filter === "missing" ? "preset active" : "preset"} href="/admin/catalog?filter=missing">Fără EAN</Link>
            <Link className={filter === "sku" ? "preset active" : "preset"} href="/admin/catalog?filter=sku">Încă pe SKU</Link>
          </div>
          {products.length === 0 ? <p className="admin-empty-note">Catalogul este gol. Apasă „Sincronizează din BOCP” ca să aduci produsele, EAN-urile și stocul.</p>
            : visible.length === 0 ? <p className="admin-empty-note">Niciun produs în acest filtru.</p>
            : <div className="preview-table-wrap catalog-table"><table>
              <thead><tr><th>Produs</th><th>SKU</th><th>EAN</th><th>Scanare</th></tr></thead>
              <tbody>{visible.map(product => <tr key={product.id}>
                <td>{product.name}{product.variant_label ? ` · ${product.variant_label}` : ""}</td>
                <td>{product.sku}</td>
                <td><form action={saveEan} className="admin-inline catalog-ean-form">
                  <input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="filter" value={filter}/>
                  <input name="ean" defaultValue={product.ean ?? ""} inputMode="numeric" maxLength={32} placeholder="EAN (8–14 cifre)" aria-label={`EAN pentru ${product.name}`}/>
                  <SubmitButton className="button button-outline">Salvează</SubmitButton>
                </form></td>
                <td><form action={setMode}>
                  <input type="hidden" name="product_id" value={product.id}/><input type="hidden" name="filter" value={filter}/>
                  <input type="hidden" name="mode" value={product.scan_mode === "ean" ? "sku" : "ean"}/>
                  <span className={product.scan_mode === "ean" ? "partner-tag linked" : "partner-tag"}>{product.scan_mode === "ean" ? "EAN" : "SKU"}</span>
                  <SubmitButton className="text-button catalog-toggle" disabled={product.scan_mode === "sku" && !product.ean}>{product.scan_mode === "ean" ? "Revino la SKU" : "Treci pe EAN"}</SubmitButton>
                </form></td>
              </tr>)}</tbody>
            </table></div>}
        </section>
      </>}
    </AppShell>
  );
}
