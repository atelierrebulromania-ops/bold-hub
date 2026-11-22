import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { catalogRoles, requireRole } from "@/lib/auth";
import { pdfFileName, planCatalog, type CatalogLanguage } from "@/lib/horeca/catalog";
import { loadCatalog } from "@/lib/horeca/server";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The preview shows the very PDF the export downloads (same route, same renderer), in the browser's
// PDF viewer, which has the page navigation and zoom.
export default async function CatalogPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile } = await requireRole(catalogRoles);
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  const catalog = await loadCatalog(supabase, id);
  if (!catalog) notFound();
  const pages = planCatalog(catalog).length;
  const shown = catalog.products.filter(product => product.active && catalog.collections.some(collection => collection.active && collection.id === product.collection_id)).length;

  return (
    <AppShell profile={profile} active="/catalogs" section="Cataloage HoReCa" title="Previzualizare"
      note={{ title: "Previzualizare", text: "Este exact fișierul care se descarcă la Export PDF." }}>
      <div className="hc-editor-head">
        <div>
          <Link href={`/catalogs/${id}`} className="hc-back">← Înapoi la editare</Link>
          <h1 className="hc-preview-title">{catalog.title}</h1>
          <p className="muted">{pages} pagini · {shown} produse în PDF · {pdfFileName(catalog.language as CatalogLanguage, new Date())}</p>
        </div>
        <div className="hc-editor-actions">
          <a className="button button-outline" href={`/catalogs/${id}/pdf`} target="_blank" rel="noopener">Deschide în fereastră nouă</a>
          <a className="button button-primary" href={`/catalogs/${id}/pdf?download=1`}>Export PDF</a>
        </div>
      </div>
      <iframe className="hc-preview" src={`/catalogs/${id}/pdf`} title={`Previzualizare ${catalog.title}`} />
    </AppShell>
  );
}
