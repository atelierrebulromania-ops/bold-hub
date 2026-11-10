"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { catalogRoles, requireRole } from "@/lib/auth";
import { catalogCurrencies, catalogLanguages, defaultCatalogTexts, type CatalogLanguage } from "@/lib/horeca/catalog";

// Catalog list actions. Every action checks the role again; the database's row security also refuses
// anyone who is not an admin or a catalog editor.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (value: FormDataEntryValue | null) => String(value ?? "").trim().replace(/\s+/g, " ");

export async function createCatalog(form: FormData) {
  const { supabase, userId } = await requireRole(catalogRoles);
  const title = clean(form.get("title"));
  const language = clean(form.get("language"));
  const currency = clean(form.get("currency")).toUpperCase();
  if (!title || title.length > 120) redirect("/catalogs?error=title");
  if (!(language in catalogLanguages) || !(catalogCurrencies as readonly string[]).includes(currency)) redirect("/catalogs?error=fields");
  const texts = defaultCatalogTexts[language as CatalogLanguage];
  const { data, error } = await supabase.from("horeca_catalogs").insert({
    title, language, currency, cover_title: "HO RE CA", cover_subtitle: texts.cover_subtitle, website: "www.atelierrebul.ro",
    terms_vat: texts.terms_vat, terms_payment: texts.terms_payment, created_by: userId, updated_by: userId,
  }).select("id").single();
  if (error || !data) redirect("/catalogs?error=save");
  revalidatePath("/catalogs");
  redirect(`/catalogs/${data.id}`);
}

// A full, independent copy: info, terms, collections and products (photos are shared until replaced).
export async function duplicateCatalog(form: FormData) {
  const { supabase } = await requireRole(catalogRoles);
  const id = String(form.get("id") ?? "");
  if (!uuid.test(id)) redirect("/catalogs?error=save");
  const { data: source } = await supabase.from("horeca_catalogs").select("title").eq("id", id).maybeSingle();
  if (!source) redirect("/catalogs?error=save");
  const title = `${source.title} (copie)`.slice(0, 120);
  const { data: copy, error } = await supabase.rpc("duplicate_horeca_catalog", { p_catalog_id: id, p_title: title });
  if (error || !copy) redirect("/catalogs?error=save");
  revalidatePath("/catalogs");
  redirect(`/catalogs/${copy}?notice=duplicated`);
}

// Archiving hides a catalog from the list; nothing is deleted and it can be restored.
export async function setCatalogArchived(form: FormData) {
  const { supabase, userId } = await requireRole(catalogRoles);
  const id = String(form.get("id") ?? "");
  const archive = form.get("archive") === "true";
  if (!uuid.test(id)) redirect("/catalogs?error=save");
  const now = new Date().toISOString();
  const { error } = await supabase.from("horeca_catalogs").update({ archived_at: archive ? now : null, updated_at: now, updated_by: userId }).eq("id", id);
  if (error) redirect("/catalogs?error=save");
  revalidatePath("/catalogs");
  redirect(archive ? "/catalogs?notice=archived" : "/catalogs?archived=1&notice=restored");
}
