"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { catalogRoles, requireRole } from "@/lib/auth";
import { catalogCurrencies, catalogLanguages, defaultCatalogTexts, type CatalogLanguage } from "@/lib/horeca/catalog";
import { catalogImagesBucket, isImagePath } from "@/lib/horeca/server";

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

// Renames a catalog from the list. Same limit as the title field in the editor (1–120 characters).
export async function renameCatalog(form: FormData) {
  const { supabase, userId } = await requireRole(catalogRoles);
  const id = String(form.get("id") ?? "");
  const title = clean(form.get("title"));
  if (!uuid.test(id)) redirect("/catalogs?error=save");
  if (!title || title.length > 120) redirect("/catalogs?error=title");
  const { error } = await supabase.from("horeca_catalogs").update({ title, updated_at: new Date().toISOString(), updated_by: userId }).eq("id", id);
  if (error) redirect("/catalogs?error=save");
  revalidatePath("/catalogs");
  revalidatePath(`/catalogs/${id}`);
  redirect("/catalogs?notice=renamed");
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

// Deletes a catalog for good: its collections and products go with it (the database cascades), then the
// photos it uploaded, except those another catalog still uses (a duplicate shares its original's photos).
export async function deleteCatalog(form: FormData) {
  const { supabase } = await requireRole(catalogRoles);
  const id = String(form.get("id") ?? "");
  if (!uuid.test(id)) redirect("/catalogs?error=delete");
  const { data: products, error: readError } = await supabase.from("horeca_catalog_products").select("image_path").eq("catalog_id", id);
  if (readError) redirect("/catalogs?error=delete");
  const { error } = await supabase.from("horeca_catalogs").delete().eq("id", id);
  if (error) redirect("/catalogs?error=delete");

  const stored = [...new Set((products ?? []).map(product => product.image_path).filter((path): path is string => !!path && isImagePath(path) && !path.startsWith("seed/")))];
  if (stored.length > 0) {
    const { data: stillUsed } = await supabase.from("horeca_catalog_products").select("image_path").in("image_path", stored);
    const keep = new Set((stillUsed ?? []).map(product => product.image_path));
    const unused = stored.filter(path => !keep.has(path));
    if (unused.length > 0) await supabase.storage.from(catalogImagesBucket).remove(unused);
  }
  revalidatePath("/catalogs");
  redirect("/catalogs?notice=deleted");
}
