import { calendarImagesBucket, isImagePath, sharedCalendarClient } from "@/lib/marketing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Campaign pictures for the shared calendar: only with a valid link, and only pictures the calendar uses.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const client = await sharedCalendarClient((await params).token);
  if (!client) return new Response(null, { status: 403 });
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!isImagePath(path)) return new Response(null, { status: 400 });
  const { count } = await client.from("marketing_events").select("id", { count: "exact", head: true }).eq("image_path", path);
  if (!count) return new Response(null, { status: 404 });
  const { data, error } = await client.storage.from(calendarImagesBucket).download(path);
  if (error || !data) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(await data.arrayBuffer()), {
    headers: { "Content-Type": path.endsWith(".png") ? "image/png" : "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
