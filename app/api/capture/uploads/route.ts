import { captureCaller, captureHeaders } from "@/lib/accounting/capture-auth";
import { startUpload } from "@/lib/accounting/store";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: captureHeaders(request) });
}

// BoldHub Capture, step 1: a one-time signed URL to upload the file straight to the private bucket.
export async function POST(request: Request) {
  const headers = captureHeaders(request);
  const caller = await captureCaller(request);
  if (!caller) return Response.json({ error: "Extensia nu este conectată sau accesul a fost revocat." }, { status: 401, headers });
  const body = await request.json().catch(() => null) as { fileName?: unknown; size?: unknown } | null;
  if (typeof body?.fileName !== "string" || typeof body.size !== "number") return Response.json({ error: "Cerere invalidă." }, { status: 400, headers });
  const ticket = await startUpload(caller.userId, body.fileName, body.size);
  if (!ticket.ok) return Response.json({ error: ticket.error }, { status: 400, headers });
  return Response.json({ path: ticket.path, token: ticket.token, signedUrl: ticket.signedUrl }, { headers });
}
