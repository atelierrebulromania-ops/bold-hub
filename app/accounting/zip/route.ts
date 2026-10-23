import { Zip, ZipDeflate } from "fflate";
import { readDocumentFile } from "@/lib/accounting/store";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxZipBytes = 150 * 1024 * 1024;

// Several documents in one ZIP, built in memory and streamed back (never stored). Only documents the caller may
// see (row security) and whose files are still held; they are marked "Descărcat".
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const ids = [...new Set((form?.getAll("id") ?? []).filter((value): value is string => typeof value === "string" && uuid.test(value)))].slice(0, 200);
  if (!ids.length) return new Response("Alege cel puțin un document.", { status: 400 });
  const supabase = await createClient();
  const { data: documents } = await supabase.from("accounting_documents")
    .select("id,original_name,period,storage_path,size_bytes,accounting_suppliers(name),accounting_companies(name)")
    .in("id", ids).is("file_deleted_at", null);
  const held = (documents ?? []).filter((document) => document.storage_path);
  if (!held.length) return new Response("Documentele alese nu mai sunt disponibile.", { status: 404 });
  if (held.reduce((sum, document) => sum + document.size_bytes, 0) > maxZipBytes) return new Response("Selecția are peste 150 MB. Descarcă în mai multe arhive.", { status: 413 });

  // company/period/supplier - name, unique inside the archive.
  const used = new Set<string>();
  const entries = held.map((document) => {
    const folder = `${document.accounting_companies?.name ?? "Companie"}/${document.period}`;
    let name = `${folder}/${document.accounting_suppliers?.name ?? "Furnizor"} - ${document.original_name}`.replace(/[\\:*?"<>|]+/g, "");
    for (let copy = 2; used.has(name); copy++) name = name.replace(/(\.[^.]+)?$/, ` (${copy})$1`);
    used.add(name);
    return { name, path: document.storage_path! };
  });
  await supabase.rpc("record_accounting_downloads", { p_ids: held.map((document) => document.id), p_zip: true });

  // Streamed as it is built: one file at a time is read from storage and compressed.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) { controller.error(error); return; }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      for (const entry of entries) {
        const bytes = await readDocumentFile(entry.path);
        if (!bytes) continue;
        const file = new ZipDeflate(entry.name, { level: 6 });
        zip.add(file);
        file.push(bytes, true);
      }
      zip.end();
    },
  });
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(new Date());
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="boldhub-documente-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
