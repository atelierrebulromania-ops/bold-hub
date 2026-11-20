import { calendarImagesBucket, isImagePath, marketingAccess } from "@/lib/marketing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Campaign pictures for the calendar. Same access check as the module; the storage bucket itself also
// refuses anyone else. Not kept in the browser cache, so access is checked on every request.
export async function GET(request: Request) {
  const access = await marketingAccess();
  if (!access) return new Response(null, { status: 403 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!isImagePath(path)) return new Response(null, { status: 400 });
  const { data, error } = await access.supabase.storage.from(calendarImagesBucket).download(path);
  if (error || !data) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(await data.arrayBuffer()), {
    headers: { "Content-Type": path.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
