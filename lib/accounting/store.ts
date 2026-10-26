import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cleanFileName, detectKind, expiryFrom, isDocType, isIsoDate, isPeriod, kindFromName, maxDocumentBytes, periodFor, sha256Hex,
  type CollectionMethod, type DocType,
} from "./files";

// Collecting accounting documents, shared by the manual upload (web) and BoldHub Capture (extension).
// The browser uploads the bytes straight to the private bucket with a one-time signed URL (no size limit of
// server functions); the server then reads them back, checks what they really are, hashes them, drops
// duplicates and only then files the document. Every step runs with the service role after the caller
// was checked to be an active administrator.

export const accountingBucket = "accounting-documents";
const incomingPrefix = "incoming/";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = SupabaseClient<Database>;

function service(): Admin {
  const admin = createAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY lipsește pe server.");
  return admin;
}

// Only an active administrator may collect documents (manual upload or Capture).
export async function isAccountingCollector(userId: string) {
  const { data } = await service().from("app_users").select("role,active").eq("id", userId).maybeSingle();
  return !!data?.active && data.role === "admin";
}

export type UploadTicket = { ok: true; path: string; token: string; signedUrl: string } | { ok: false; error: string };

export async function startUpload(userId: string, fileName: string, size: number): Promise<UploadTicket> {
  if (!(await isAccountingCollector(userId))) return { ok: false, error: "Doar administratorul poate încărca documente." };
  const kind = kindFromName(fileName);
  if (!kind) return { ok: false, error: "Sunt acceptate doar fișiere PDF, CSV și XLSX." };
  if (!Number.isSafeInteger(size) || size <= 0 || size > maxDocumentBytes) return { ok: false, error: "Fișierul trebuie să aibă între 1 octet și 25 MB." };
  const path = `${incomingPrefix}${crypto.randomUUID()}.${kind}`;
  const { data, error } = await service().storage.from(accountingBucket).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Nu am putut pregăti încărcarea. Încearcă din nou." };
  return { ok: true, path: data.path, token: data.token, signedUrl: data.signedUrl };
}

export type FinishInput = {
  path: string; fileName: string; companyId: string; supplierId: string; docType?: string | null;
  invoiceNumber?: string | null; issuedOn?: string | null; period?: string | null; externalId?: string | null; notes?: string | null;
  method: CollectionMethod;
};

export type FinishResult =
  | { status: "created"; documentId: string; message: string }
  | { status: "duplicate"; documentId: string | null; message: string }
  | { status: "rejected"; message: string };

const clip = (value: string | null | undefined, max: number) => {
  const text = value?.trim().replace(/\s+/g, " ") ?? "";
  return text ? text.slice(0, max) : null;
};

async function removeIncoming(admin: Admin, path: string) {
  await admin.storage.from(accountingBucket).remove([path]);
}

async function logEvent(admin: Admin, event: Database["public"]["Tables"]["accounting_document_events"]["Insert"]) {
  await admin.from("accounting_document_events").insert(event);
}

export async function finishUpload(userId: string, input: FinishInput): Promise<FinishResult> {
  const admin = service();
  if (!(await isAccountingCollector(userId))) return { status: "rejected", message: "Doar administratorul poate încărca documente." };
  if (!input.path.startsWith(incomingPrefix) || !/^incoming\/[0-9a-f-]{36}\.(pdf|csv|xlsx)$/.test(input.path)) return { status: "rejected", message: "Încărcarea nu este validă." };
  const reject = async (message: string, supplierId: string | null = null) => {
    await removeIncoming(admin, input.path);
    await logEvent(admin, { action: "rejected", supplier_id: supplierId, method: input.method, user_id: userId, detail: `${cleanFileName(input.fileName)}: ${message}`.slice(0, 500) });
    return { status: "rejected" as const, message };
  };

  if (!uuid.test(input.companyId) || !uuid.test(input.supplierId)) return reject("Alege compania și furnizorul.");
  const [{ data: company }, { data: supplier }] = await Promise.all([
    admin.from("accounting_companies").select("id,active").eq("id", input.companyId).maybeSingle(),
    admin.from("accounting_suppliers").select("id,active,default_doc_type").eq("id", input.supplierId).maybeSingle(),
  ]);
  if (!company?.active) return reject("Compania nu există sau nu este activă.");
  if (!supplier?.active) return reject("Furnizorul nu există sau nu este activ.");
  const docType: DocType = isDocType(input.docType) ? input.docType : isDocType(supplier.default_doc_type) ? supplier.default_doc_type : "other";
  const issuedOn = input.issuedOn && isIsoDate(input.issuedOn) ? input.issuedOn : null;
  if (input.issuedOn && !issuedOn) return reject("Data emiterii nu este validă.", supplier.id);
  if (input.period && !isPeriod(input.period)) return reject("Perioada contabilă trebuie să fie de forma AAAA-LL.", supplier.id);

  // The bytes as they really landed in storage.
  const { data: blob, error: downloadError } = await admin.storage.from(accountingBucket).download(input.path);
  if (downloadError || !blob) return reject("Fișierul nu a ajuns în BoldHub. Încearcă din nou.", supplier.id);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const name = cleanFileName(input.fileName);
  const detected = detectKind(bytes, name);
  if (!detected.ok) return reject(detected.error, supplier.id);
  const sha256 = await sha256Hex(bytes);
  const invoiceNumber = clip(input.invoiceNumber, 80);
  const externalId = clip(input.externalId, 200);

  // De-duplication among the files still held: same bytes, same supplier document id, same invoice number.
  const duplicateOf = await findDuplicate(admin, { sha256, supplierId: supplier.id, externalId, invoiceNumber });
  if (duplicateOf) {
    await removeIncoming(admin, input.path);
    await logEvent(admin, { action: "duplicate", document_id: duplicateOf.id, supplier_id: supplier.id, method: input.method, user_id: userId, detail: `${name}: ${duplicateOf.reason}` });
    return { status: "duplicate", documentId: duplicateOf.id, message: `Documentul există deja în BoldHub (${duplicateOf.reason}).` };
  }

  const collectedAt = new Date();
  const documentId = crypto.randomUUID();
  const period = periodFor(input.period, issuedOn, collectedAt);
  const finalPath = `${company.id}/${period}/${documentId}.${detected.kind}`;
  const { error: moveError } = await admin.storage.from(accountingBucket).move(input.path, finalPath);
  if (moveError) return reject("Nu am putut salva fișierul. Încearcă din nou.", supplier.id);

  const { error: insertError } = await admin.from("accounting_documents").insert({
    id: documentId, company_id: company.id, supplier_id: supplier.id, doc_type: docType, invoice_number: invoiceNumber, issued_on: issuedOn, period,
    original_name: name, mime_type: detected.mime, size_bytes: bytes.length, sha256, storage_path: finalPath, collection_method: input.method,
    collected_at: collectedAt.toISOString(), collected_by: userId, expires_at: expiryFrom(collectedAt).toISOString(), external_id: externalId,
    notes: clip(input.notes, 500),
  });
  if (insertError) {
    await admin.storage.from(accountingBucket).remove([finalPath]);
    // A parallel upload of the same document won the race: report it as a duplicate.
    if (insertError.code === "23505") {
      const winner = await findDuplicate(admin, { sha256, supplierId: supplier.id, externalId, invoiceNumber });
      return { status: "duplicate", documentId: winner?.id ?? null, message: "Documentul există deja în BoldHub." };
    }
    return { status: "rejected", message: "Nu am putut salva documentul. Încearcă din nou." };
  }
  await Promise.all([
    logEvent(admin, { action: "collected", document_id: documentId, supplier_id: supplier.id, method: input.method, user_id: userId, detail: name }),
    admin.from("accounting_integrations").update({ last_document_at: collectedAt.toISOString() }).eq("supplier_id", supplier.id),
  ]);
  return { status: "created", documentId, message: "Documentul a fost salvat în Contabilitate." };
}

async function findDuplicate(admin: Admin, key: { sha256: string; supplierId: string; externalId: string | null; invoiceNumber: string | null }) {
  const active = () => admin.from("accounting_documents").select("id").is("file_deleted_at", null).limit(1);
  const [byHash, byExternal, byInvoice] = await Promise.all([
    active().eq("sha256", key.sha256).maybeSingle(),
    key.externalId ? active().eq("supplier_id", key.supplierId).eq("external_id", key.externalId).maybeSingle() : Promise.resolve({ data: null }),
    key.invoiceNumber ? active().eq("supplier_id", key.supplierId).ilike("invoice_number", key.invoiceNumber.replace(/[%_\\]/g, "\\$&")).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (byHash.data) return { id: byHash.data.id, reason: "același fișier" };
  if (byExternal.data) return { id: byExternal.data.id, reason: "același ID de document la furnizor" };
  if (byInvoice.data) return { id: byInvoice.data.id, reason: "același număr de factură la acest furnizor" };
  return null;
}

// Retention: deletes the files of documents past their 30 days and stale incoming uploads. Safe to run again:
// a file that could not be deleted stays marked as held and is retried on the next run.
export async function expireDocuments(now = new Date()) {
  const admin = service();
  const { data: due, error } = await admin.from("accounting_documents").select("id,supplier_id,storage_path")
    .is("file_deleted_at", null).lte("expires_at", now.toISOString()).order("expires_at").limit(500);
  if (error) throw new Error("Documentele expirate nu pot fi citite.");
  let expired = 0;
  let failed = 0;
  for (let index = 0; index < (due ?? []).length; index += 100) {
    const batch = due!.slice(index, index + 100);
    const paths = batch.map((row) => row.storage_path).filter((path): path is string => !!path);
    const { error: removeError } = paths.length ? await admin.storage.from(accountingBucket).remove(paths) : { error: null };
    if (removeError) {
      failed += batch.length;
      await admin.from("accounting_document_events").insert(batch.map((row) => ({ action: "expiry_failed", document_id: row.id, supplier_id: row.supplier_id, detail: removeError.message.slice(0, 500) })));
      continue;
    }
    const ids = batch.map((row) => row.id);
    await admin.from("accounting_documents").update({ file_deleted_at: now.toISOString(), storage_path: null }).in("id", ids);
    await admin.from("accounting_document_events").insert(batch.map((row) => ({ action: "expired", document_id: row.id, supplier_id: row.supplier_id })));
    expired += batch.length;
  }

  // Uploads that were started but never finished (older than a day) are removed too.
  let stale = 0;
  const { data: incoming } = await admin.storage.from(accountingBucket).list("incoming", { limit: 1000 });
  const old = (incoming ?? []).filter((file) => file.created_at && Date.parse(file.created_at) < now.getTime() - 86400000).map((file) => `${incomingPrefix}${file.name}`);
  if (old.length) {
    const { error: staleError } = await admin.storage.from(accountingBucket).remove(old);
    if (!staleError) stale = old.length;
  }
  return { expired, failed, stale };
}

// A short-lived link to a held file (inline view or download under its original name).
export async function documentFileUrl(path: string, fileName: string, mode: "view" | "download") {
  const { data } = await service().storage.from(accountingBucket).createSignedUrl(path, 120, mode === "download" ? { download: fileName } : undefined);
  return data?.signedUrl ?? null;
}

export async function readDocumentFile(path: string) {
  const { data } = await service().storage.from(accountingBucket).download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}
