import { captureCaller, captureHeaders } from "@/lib/accounting/capture-auth";
import { finishUpload } from "@/lib/accounting/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: captureHeaders(request) });
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

// BoldHub Capture, step 2: the uploaded file is checked, de-duplicated and filed in Contabilitate.
export async function POST(request: Request) {
  const headers = captureHeaders(request);
  const caller = await captureCaller(request);
  if (!caller) return Response.json({ error: "Extensia nu este conectată sau accesul a fost revocat." }, { status: 401, headers });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !text(body.path) || !text(body.fileName) || !text(body.companyId) || !text(body.supplierId)) {
    return Response.json({ error: "Cerere invalidă." }, { status: 400, headers });
  }
  const result = await finishUpload(caller.userId, {
    path: text(body.path)!, fileName: text(body.fileName)!, companyId: text(body.companyId)!, supplierId: text(body.supplierId)!,
    docType: text(body.docType), invoiceNumber: text(body.invoiceNumber), issuedOn: text(body.issuedOn), period: text(body.period),
    externalId: text(body.externalId), method: "extension",
  });
  const origin = new URL(request.url).origin;
  const documentUrl = "documentId" in result && result.documentId ? `${origin}/accounting?document=${result.documentId}` : null;
  return Response.json({ ...result, documentUrl }, { status: result.status === "rejected" ? 422 : 200, headers });
}
