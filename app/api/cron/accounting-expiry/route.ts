import { expireDocuments } from "@/lib/accounting/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" };

// Every morning (pg_cron): files of documents collected more than 30 days ago are deleted from storage; the
// metadata stays as history. Safe to run again; failed deletions are retried on the next run.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Neautorizat." }, { status: 401, headers: noStore });
  }
  try {
    return Response.json({ status: "ok", ...(await expireDocuments()) }, { headers: noStore });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Eroare." }, { status: 500, headers: noStore });
  }
}
