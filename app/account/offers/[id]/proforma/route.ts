import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { proformaPdfUrl } from "@/lib/bocp/proformas";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opens the proforma's PDF as issued by BOCP. Its links expire, so a fresh one is read each time.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole(["admin", "account", "operator_facturare"]);
  if (!uuid.test(id)) return new Response("Documentul nu este valid.", { status: 400 });
  const { data: document } = await supabase.from("sales_documents").select("bocp_proforma_id").eq("id", id).maybeSingle();
  if (!document?.bocp_proforma_id) return new Response("Proforma nu este emisă în BOCP.", { status: 404 });
  let url: string | null = null;
  try { url = await proformaPdfUrl(document.bocp_proforma_id); }
  catch { return new Response("BOCP nu a răspuns. Încearcă din nou (funcționează doar de pe rețeaua permisă în BOCP).", { status: 502 }); }
  if (!url) return new Response("Proforma nu are un PDF disponibil în BOCP.", { status: 404 });
  redirect(url);
}
