import { dispatchPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Called by the database right after a notification is created (and by a cron as a fallback).
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }
  const result = await dispatchPush();
  return Response.json({ status: "ok", ...result }, { headers: noStore });
}

export const GET = handle;
export const POST = handle;
