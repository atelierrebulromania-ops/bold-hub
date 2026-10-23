"use server";

import { revalidatePath } from "next/cache";
import { createCaptureToken } from "@/lib/accounting/capture-auth";
import { cleanDomains } from "@/lib/accounting/files";
import { finishUpload, startUpload, type FinishResult, type UploadTicket } from "@/lib/accounting/store";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: boolean; message: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Manual upload (web), step 1: a one-time signed URL for the browser to upload the file to the private bucket.
export async function startManualUpload(fileName: string, size: number): Promise<UploadTicket> {
  const { profile } = await requireRole(["admin"]);
  return startUpload(profile.id, fileName, size);
}

export type ManualDocument = { path: string; fileName: string; companyId: string; supplierId: string; docType: string; period: string; invoiceNumber: string; issuedOn: string };

// Step 2: the server checks the bytes, drops duplicates and files the document.
export async function finishManualUpload(input: ManualDocument): Promise<FinishResult> {
  const { profile } = await requireRole(["admin"]);
  const result = await finishUpload(profile.id, {
    path: input.path, fileName: input.fileName, companyId: input.companyId, supplierId: input.supplierId, docType: input.docType,
    period: input.period || null, invoiceNumber: input.invoiceNumber || null, issuedOn: input.issuedOn || null, method: "manual",
  });
  if (result.status === "created") revalidatePath("/accounting", "layout");
  return result;
}

function service() {
  const admin = createAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY lipsește pe server.");
  return admin;
}

// Suppliers: name and the domains BoldHub Capture recognises them by.
export async function saveSupplier(supplierId: string | null, name: string, domains: string, active: boolean): Promise<Result> {
  await requireRole(["admin"]);
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (cleanName.length < 2 || cleanName.length > 120) return { ok: false, message: "Numele furnizorului are între 2 și 120 de caractere." };
  if (supplierId !== null && !uuid.test(supplierId)) return { ok: false, message: "Furnizorul nu este valid." };
  const list = cleanDomains(domains.split(/[\s,;]+/));
  const admin = service();
  if (supplierId) {
    const { error } = await admin.from("accounting_suppliers").update({ name: cleanName, domains: list, active }).eq("id", supplierId);
    if (error) return { ok: false, message: "Nu am putut salva furnizorul." };
  } else {
    const slug = `${cleanName.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "furnizor"}_${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await admin.from("accounting_suppliers").insert({ slug, name: cleanName, domains: list, active }).select("id").single();
    if (error || !data) return { ok: false, message: error?.code === "23505" ? "Există deja un furnizor cu acest nume." : "Nu am putut adăuga furnizorul." };
    await admin.from("accounting_integrations").insert({ supplier_id: data.id, method: "extension", status: "available" });
  }
  revalidatePath("/accounting", "layout");
  return { ok: true, message: supplierId ? "Furnizorul a fost salvat." : "Furnizorul a fost adăugat." };
}

export async function saveCompany(companyId: string | null, name: string, vatId: string, active: boolean): Promise<Result> {
  await requireRole(["admin"]);
  const cleanName = name.trim().replace(/\s+/g, " ");
  if (cleanName.length < 2 || cleanName.length > 160) return { ok: false, message: "Numele companiei are între 2 și 160 de caractere." };
  if (companyId !== null && !uuid.test(companyId)) return { ok: false, message: "Compania nu este validă." };
  const vat = vatId.trim().toUpperCase().replace(/\s+/g, "").slice(0, 20) || null;
  const admin = service();
  const { error } = companyId
    ? await admin.from("accounting_companies").update({ name: cleanName, vat_id: vat, active }).eq("id", companyId)
    : await admin.from("accounting_companies").insert({ name: cleanName, vat_id: vat, active });
  if (error) return { ok: false, message: error.code === "23505" ? "Există deja o companie cu acest nume." : "Nu am putut salva compania." };
  revalidatePath("/accounting", "layout");
  return { ok: true, message: companyId ? "Compania a fost salvată." : "Compania a fost adăugată." };
}

// Which companies an accounting user may see.
export async function setAccountantAccess(userId: string, companyIds: string[]): Promise<Result> {
  await requireRole(["admin"]);
  if (!uuid.test(userId) || companyIds.length > 50 || !companyIds.every((id) => uuid.test(id))) return { ok: false, message: "Selecția nu este validă." };
  const admin = service();
  const { data: user } = await admin.from("app_users").select("role").eq("id", userId).maybeSingle();
  if (user?.role !== "contabilitate") return { ok: false, message: "Accesul pe companii se dă doar conturilor de contabilitate." };
  const { error: deleteError } = await admin.from("accounting_company_access").delete().eq("user_id", userId);
  if (deleteError) return { ok: false, message: "Nu am putut salva accesul." };
  if (companyIds.length) {
    const { error } = await admin.from("accounting_company_access").insert(companyIds.map((companyId) => ({ user_id: userId, company_id: companyId })));
    if (error) return { ok: false, message: "Nu am putut salva accesul." };
  }
  revalidatePath("/accounting", "layout");
  return { ok: true, message: "Accesul a fost salvat." };
}

// BoldHub Capture: a new token for this browser (shown once, sent to the extension by the connect page).
export async function connectCapture(label: string): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; message: string }> {
  const { profile } = await requireRole(["admin"]);
  if (profile.realRole !== "admin") return { ok: false, message: "Conectarea extensiei se face din contul de administrator." };
  const created = await createCaptureToken(profile.id, label);
  if (!created) return { ok: false, message: "Nu am putut conecta extensia. Încearcă din nou." };
  revalidatePath("/accounting/integrations");
  return { ok: true, token: created.token, expiresAt: created.expiresAt.toISOString() };
}

export async function revokeCapture(tokenId: string): Promise<Result> {
  const { profile } = await requireRole(["admin"]);
  if (!uuid.test(tokenId)) return { ok: false, message: "Conexiunea nu este validă." };
  const { error } = await service().from("accounting_capture_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId).eq("user_id", profile.id).is("revoked_at", null);
  if (error) return { ok: false, message: "Nu am putut revoca accesul." };
  revalidatePath("/accounting/integrations");
  return { ok: true, message: "Extensia a fost deconectată. Tokenul nu mai funcționează." };
}
