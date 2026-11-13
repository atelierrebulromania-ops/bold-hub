"use server";

import { revalidatePath } from "next/cache";
import { catalogRoles, requireRole } from "@/lib/auth";
import type { CatalogCollection, CatalogProduct, SizeUnit } from "@/lib/horeca/catalog";
import { imagePathCatalog, isImagePath, removeImageIfUnused } from "@/lib/horeca/server";
import { parseCatalogInfo, parseCollection, parseProduct, type FieldErrors } from "@/lib/horeca/validate";

// Editor actions. Each one checks the role (requireRole redirects anyone else), validates the input
// with the shared rules, and writes with the user's own session, so row security applies as well.

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; error: string; errors?: FieldErrors };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failed = (error = "Nu s-a putut salva. Verifică legătura la internet și încearcă din nou.") => ({ ok: false as const, error });
const invalid = (errors: FieldErrors) => ({ ok: false as const, error: "Verifică câmpurile marcate.", errors });

async function editor(catalogId: string, ...ids: (string | null)[]) {
  const access = await requireRole(catalogRoles);
  if (!uuid.test(catalogId) || ids.some(id => id !== null && !uuid.test(id))) return null;
  return access;
}

function touched(catalogId: string) {
  revalidatePath("/catalogs");
  revalidatePath(`/catalogs/${catalogId}`);
}

const productColumns = "id,collection_id,name,price,currency,size_value,size_unit,sku,image_path,position,active";
type ProductRow = { id: string; collection_id: string; name: string; price: number; currency: string | null; size_value: number | null;
  size_unit: string | null; sku: string | null; image_path: string | null; position: number; active: boolean };
const toProduct = (row: ProductRow): CatalogProduct => ({
  ...row, price: Number(row.price), size_value: row.size_value === null ? null : Number(row.size_value), size_unit: row.size_unit as SizeUnit | null,
});

// ---- Catalog info and commercial terms --------------------------------------------------------------

export async function saveCatalogInfo(catalogId: string, input: Record<string, unknown>): Promise<ActionResult> {
  const access = await editor(catalogId);
  if (!access) return failed();
  const parsed = parseCatalogInfo(input);
  if (!parsed.ok) return invalid(parsed.errors);
  const value = parsed.value;
  const { error } = await access.supabase.from("horeca_catalogs").update({
    title: value.title, language: value.language, currency: value.currency, cover_title: value.coverTitle, cover_subtitle: value.coverSubtitle,
    website: value.website, terms_vat: value.termsVat, terms_currency: value.termsCurrency, terms_payment: value.termsPayment,
    terms_delivery: value.termsDelivery, terms_other: value.termsOther, discount_percent: value.discountPercent,
    updated_at: new Date().toISOString(), updated_by: access.userId,
  }).eq("id", catalogId);
  if (error) return failed();
  touched(catalogId);
  return { ok: true, value: null };
}

// ---- Collections ----------------------------------------------------------------------------------

export async function addCollection(catalogId: string, input: Record<string, unknown>): Promise<ActionResult<CatalogCollection>> {
  const access = await editor(catalogId);
  if (!access) return failed();
  const parsed = parseCollection(input);
  if (!parsed.ok) return invalid(parsed.errors);
  const { data: last } = await access.supabase.from("horeca_catalog_collections").select("position").eq("catalog_id", catalogId)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await access.supabase.from("horeca_catalog_collections")
    .insert({ catalog_id: catalogId, name: parsed.value.name, label: parsed.value.label, position: (last?.position ?? 0) + 1 })
    .select("id,label,name,position,active").single();
  if (error || !data) return failed();
  touched(catalogId);
  return { ok: true, value: data };
}

export async function updateCollection(catalogId: string, collectionId: string, input: Record<string, unknown>): Promise<ActionResult> {
  const access = await editor(catalogId, collectionId);
  if (!access) return failed();
  const parsed = parseCollection(input);
  if (!parsed.ok) return invalid(parsed.errors);
  const { error } = await access.supabase.from("horeca_catalog_collections").update({ name: parsed.value.name, label: parsed.value.label })
    .eq("id", collectionId).eq("catalog_id", catalogId);
  if (error) return failed();
  touched(catalogId);
  return { ok: true, value: null };
}

export async function setCollectionActive(catalogId: string, collectionId: string, active: boolean): Promise<ActionResult> {
  const access = await editor(catalogId, collectionId);
  if (!access) return failed();
  const { error } = await access.supabase.from("horeca_catalog_collections").update({ active: active === true })
    .eq("id", collectionId).eq("catalog_id", catalogId);
  if (error) return failed();
  touched(catalogId);
  return { ok: true, value: null };
}

// Deletes the collection and its products (the database cascades), then photos nobody uses any more.
export async function deleteCollection(catalogId: string, collectionId: string): Promise<ActionResult> {
  const access = await editor(catalogId, collectionId);
  if (!access) return failed();
  const { data: products } = await access.supabase.from("horeca_catalog_products").select("image_path")
    .eq("collection_id", collectionId).eq("catalog_id", catalogId);
  const { error } = await access.supabase.from("horeca_catalog_collections").delete().eq("id", collectionId).eq("catalog_id", catalogId);
  if (error) return failed("Colecția nu a putut fi ștearsă. Încearcă din nou.");
  await Promise.all([...new Set((products ?? []).map(product => product.image_path))].map(path => removeImageIfUnused(access.supabase, path)));
  touched(catalogId);
  return { ok: true, value: null };
}

export async function reorderCollections(catalogId: string, collectionIds: string[]): Promise<ActionResult> {
  const access = await editor(catalogId, ...(Array.isArray(collectionIds) ? collectionIds : []));
  if (!access || !Array.isArray(collectionIds)) return failed();
  const { data, error } = await access.supabase.rpc("reorder_horeca_collections", { p_catalog_id: catalogId, p_collection_ids: collectionIds });
  if (error || !data) return failed("Ordinea nu a putut fi salvată. Reîncarcă pagina și încearcă din nou.");
  touched(catalogId);
  return { ok: true, value: null };
}

// ---- Products -------------------------------------------------------------------------------------

async function nextPosition(supabase: Awaited<ReturnType<typeof requireRole>>["supabase"], collectionId: string) {
  const { data } = await supabase.from("horeca_catalog_products").select("position").eq("collection_id", collectionId)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  return (data?.position ?? 0) + 1;
}

// Creates (productId null) or updates a product. A new photo must have been uploaded under this catalog;
// a photo it replaces is removed from storage once no other product uses it.
export async function saveProduct(catalogId: string, productId: string | null, input: Record<string, unknown>): Promise<ActionResult<CatalogProduct>> {
  const access = await editor(catalogId, productId);
  if (!access) return failed();
  const parsed = parseProduct(input);
  if (!parsed.ok) return invalid(parsed.errors);
  const value = parsed.value;
  const { supabase } = access;

  const { data: collection } = await supabase.from("horeca_catalog_collections").select("id").eq("id", value.collectionId).eq("catalog_id", catalogId).maybeSingle();
  if (!collection) return invalid({ collectionId: "Alege colecția." });
  const current = productId
    ? (await supabase.from("horeca_catalog_products").select("collection_id,image_path,position").eq("id", productId).eq("catalog_id", catalogId).maybeSingle()).data
    : null;
  if (productId && !current) return failed("Produsul nu mai există. Reîncarcă pagina.");
  const keepsPhoto = value.imagePath !== null && value.imagePath === current?.image_path;
  if (value.imagePath && !keepsPhoto && !(isImagePath(value.imagePath) && imagePathCatalog(value.imagePath) === catalogId)) {
    return invalid({ imagePath: "Fotografia nu a putut fi folosită. Încarc-o din nou." });
  }

  const fields = {
    collection_id: value.collectionId, name: value.name, price: value.price, currency: value.currency,
    size_value: value.sizeValue, size_unit: value.sizeUnit, sku: value.sku, image_path: value.imagePath, active: value.active,
  };
  const position = current && current.collection_id === value.collectionId ? current.position : await nextPosition(supabase, value.collectionId);
  const { data, error } = productId
    ? await supabase.from("horeca_catalog_products").update({ ...fields, position }).eq("id", productId).eq("catalog_id", catalogId).select(productColumns).single()
    : await supabase.from("horeca_catalog_products").insert({ ...fields, catalog_id: catalogId, position }).select(productColumns).single();
  if (error || !data) return failed();
  if (current?.image_path && current.image_path !== value.imagePath) await removeImageIfUnused(supabase, current.image_path);
  touched(catalogId);
  return { ok: true, value: toProduct(data) };
}

export async function duplicateProduct(catalogId: string, productId: string): Promise<ActionResult<CatalogProduct>> {
  const access = await editor(catalogId, productId);
  if (!access) return failed();
  const { supabase } = access;
  const { data: source } = await supabase.from("horeca_catalog_products").select(productColumns).eq("id", productId).eq("catalog_id", catalogId).maybeSingle();
  if (!source) return failed("Produsul nu mai există. Reîncarcă pagina.");
  const { id: _id, position: _position, ...fields } = source;
  void _id; void _position;
  const name = `${source.name} (copie)`.slice(0, 80);
  const { data, error } = await supabase.from("horeca_catalog_products")
    .insert({ ...fields, name, catalog_id: catalogId, position: await nextPosition(supabase, source.collection_id) }).select(productColumns).single();
  if (error || !data) return failed();
  touched(catalogId);
  return { ok: true, value: toProduct(data) };
}

export async function setProductActive(catalogId: string, productId: string, active: boolean): Promise<ActionResult> {
  const access = await editor(catalogId, productId);
  if (!access) return failed();
  const { error } = await access.supabase.from("horeca_catalog_products").update({ active: active === true }).eq("id", productId).eq("catalog_id", catalogId);
  if (error) return failed();
  touched(catalogId);
  return { ok: true, value: null };
}

export async function deleteProduct(catalogId: string, productId: string): Promise<ActionResult> {
  const access = await editor(catalogId, productId);
  if (!access) return failed();
  const { data: product } = await access.supabase.from("horeca_catalog_products").select("image_path").eq("id", productId).eq("catalog_id", catalogId).maybeSingle();
  const { error } = await access.supabase.from("horeca_catalog_products").delete().eq("id", productId).eq("catalog_id", catalogId);
  if (error) return failed("Produsul nu a putut fi șters. Încearcă din nou.");
  await removeImageIfUnused(access.supabase, product?.image_path ?? null);
  touched(catalogId);
  return { ok: true, value: null };
}

export async function reorderProducts(catalogId: string, collectionId: string, productIds: string[]): Promise<ActionResult> {
  const access = await editor(catalogId, collectionId, ...(Array.isArray(productIds) ? productIds : []));
  if (!access || !Array.isArray(productIds)) return failed();
  const { data: collection } = await access.supabase.from("horeca_catalog_collections").select("id").eq("id", collectionId).eq("catalog_id", catalogId).maybeSingle();
  if (!collection) return failed();
  const { data, error } = await access.supabase.rpc("reorder_horeca_products", { p_collection_id: collectionId, p_product_ids: productIds });
  if (error || !data) return failed("Ordinea nu a putut fi salvată. Reîncarcă pagina și încearcă din nou.");
  touched(catalogId);
  return { ok: true, value: null };
}

// A photo uploaded in the product window that was then cancelled: removed if no product uses it.
export async function discardUpload(catalogId: string, path: string): Promise<ActionResult> {
  const access = await editor(catalogId);
  if (!access || imagePathCatalog(String(path)) !== catalogId) return failed();
  await removeImageIfUnused(access.supabase, path);
  return { ok: true, value: null };
}
