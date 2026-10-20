import { redirect } from "next/navigation";
import { contractDownloadUrl } from "@/lib/contracts";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Opens a contract PDF. Row security decides who sees the contract (its agent, the admin, the client's
// manager login); the file itself is served through a short-lived signed link.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; side: string }> }) {
  const { id, side } = await params;
  if (!uuid.test(id) || !["furnizor", "semnat"].includes(side)) return new Response("Contractul nu este valid.", { status: 400 });
  const supabase = await createClient();
  const { data: contract } = await supabase.from("partner_contracts").select("title,supplier_file,signed_file").eq("id", id).maybeSingle();
  const path = side === "semnat" ? contract?.signed_file : contract?.supplier_file;
  if (!contract || !path) return new Response("Contractul nu a fost găsit.", { status: 404 });
  const name = `${contract.title.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim() || "contract"}${side === "semnat" ? " - semnat" : ""}.pdf`;
  const url = await contractDownloadUrl(path, name);
  if (!url) return new Response("Fișierul nu poate fi deschis acum.", { status: 503 });
  redirect(url);
}
