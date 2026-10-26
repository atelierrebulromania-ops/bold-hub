import { captureCaller, captureHeaders } from "@/lib/accounting/capture-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: captureHeaders(request) });
}

// BoldHub Capture: who the extension is paired with, and the companies and suppliers it can file documents for.
export async function GET(request: Request) {
  const headers = captureHeaders(request);
  const caller = await captureCaller(request);
  if (!caller) return Response.json({ error: "Extensia nu este conectată sau accesul a fost revocat." }, { status: 401, headers });
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "Configurația serverului este incompletă." }, { status: 503, headers });
  const [{ data: companies }, { data: suppliers }] = await Promise.all([
    admin.from("accounting_companies").select("id,name").eq("active", true).order("name"),
    admin.from("accounting_suppliers").select("id,slug,name,domains,default_doc_type").eq("active", true).order("sort").order("name"),
  ]);
  return Response.json({ user: { name: caller.name }, companies: companies ?? [], suppliers: suppliers ?? [] }, { headers });
}
