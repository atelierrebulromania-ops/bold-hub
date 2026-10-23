import { redirect } from "next/navigation";
import { documentFileUrl } from "@/lib/accounting/store";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opens (?mode=view) or downloads one document. Row security decides who sees it (admin, or the accountant of
// its company); the file is served through a two-minute signed link. A download marks it "Descărcat".
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mode = new URL(request.url).searchParams.get("mode") === "view" ? "view" : "download";
  if (!uuid.test(id)) return new Response("Documentul nu este valid.", { status: 400 });
  const supabase = await createClient();
  const { data: document } = await supabase.from("accounting_documents").select("id,original_name,storage_path,file_deleted_at").eq("id", id).maybeSingle();
  if (!document) return new Response("Documentul nu a fost găsit.", { status: 404 });
  if (document.file_deleted_at || !document.storage_path) return new Response("Fișierul a expirat: a fost șters după 30 de zile.", { status: 410 });
  const url = await documentFileUrl(document.storage_path, document.original_name, mode);
  if (!url) return new Response("Fișierul nu poate fi deschis acum.", { status: 503 });
  if (mode === "download") await supabase.rpc("record_accounting_downloads", { p_ids: [document.id], p_zip: false });
  redirect(url);
}
