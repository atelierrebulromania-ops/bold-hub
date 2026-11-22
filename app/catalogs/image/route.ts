import { catalogAccess, isImagePath, loadCatalogImage } from "@/lib/horeca/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Product photos for the editor's thumbnails. Same access check as the module; the storage bucket
// itself also refuses anyone else.
export async function GET(request: Request) {
  const access = await catalogAccess();
  if (!access) return new Response(null, { status: 403 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!isImagePath(path)) return new Response(null, { status: 400 });
  const image = await loadCatalogImage(access.supabase, path);
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.data), {
    // Not kept in the browser cache: access is checked on every request, also after a role change.
    headers: { "Content-Type": image.format === "png" ? "image/png" : "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
