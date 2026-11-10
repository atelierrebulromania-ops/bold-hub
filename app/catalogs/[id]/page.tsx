import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { catalogRoles, requireRole } from "@/lib/auth";
import { loadCatalog } from "@/lib/horeca/server";
import { CatalogEditor } from "./editor";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CatalogEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { supabase, profile } = await requireRole(catalogRoles);
  const { id } = await params;
  const { notice } = await searchParams;
  if (!uuid.test(id)) notFound();
  const catalog = await loadCatalog(supabase, id);
  if (!catalog) notFound();

  return (
    <AppShell profile={profile} active="/catalogs" section="Cataloage HoReCa" title={catalog.title}
      note={{ title: "Cum lucrezi", text: "Fiecare modificare se salvează imediat. Produsele și colecțiile inactive rămân aici, dar nu apar în PDF." }}>
      {notice === "duplicated" && <p className="preview-alert success admin-feedback" role="status">Copia a fost creată. Acum editezi copia, nu originalul.</p>}
      <CatalogEditor initial={catalog} />
    </AppShell>
  );
}
