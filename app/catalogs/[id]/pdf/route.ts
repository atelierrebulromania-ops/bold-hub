import { pdfFileName } from "@/lib/horeca/catalog";
import { renderCatalogPdf } from "@/lib/horeca/pdf";
import { catalogAccess, loadCatalog, loadCatalogImage } from "@/lib/horeca/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The catalog as PDF, rendered on every request from the saved data: ?download=1 for the export,
// otherwise inline for the preview. Same renderer for both, so the preview is the export.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await catalogAccess();
  if (!access) return new Response("Acces interzis.", { status: 403 });
  const { id } = await params;
  if (!uuid.test(id)) return new Response("Catalog inexistent.", { status: 404 });
  const catalog = await loadCatalog(access.supabase, id);
  if (!catalog) return new Response("Catalog inexistent.", { status: 404 });

  const pdf = await renderCatalogPdf(catalog, path => loadCatalogImage(access.supabase, path));
  const fileName = pdfFileName(catalog.language, new Date());
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
