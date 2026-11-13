import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { catalogRoles, effectiveRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CatalogData, CatalogLanguage, SizeUnit } from "./catalog";
import type { ImageSource } from "./pdf";

// Server side of the HoReCa catalogs module: access check for route handlers, loading a catalog, and
// reading product photos (seed files shipped with the app, or the private storage bucket).

export const catalogImagesBucket = "horeca-catalog-images";
const seedPattern = /^seed\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,79})$/;
const storagePattern = /^catalogs\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png)$/;
const seedDir = join(process.cwd(), "lib", "horeca", "assets", "seed");

type Client = SupabaseClient<Database>;

// Route handlers cannot redirect like pages; they get null and answer 401/403. The same roles as
// requireRole(catalogRoles), including the admin's dev-mode preview of another role.
export async function catalogAccess(): Promise<{ supabase: Client; userId: string } | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from("app_users").select("role,active").eq("id", userId).maybeSingle();
  if (!profile?.active) return null;
  const role = await effectiveRole(profile.role);
  return catalogRoles.includes(role) ? { supabase, userId } : null;
}

export async function loadCatalog(supabase: Client, id: string): Promise<CatalogData | null> {
  const [catalog, collections, products] = await Promise.all([
    supabase.from("horeca_catalogs").select("id,title,language,currency,cover_title,cover_subtitle,website,terms_vat,terms_currency,terms_payment,terms_delivery,terms_other,discount_percent")
      .eq("id", id).maybeSingle(),
    supabase.from("horeca_catalog_collections").select("id,label,name,position,active").eq("catalog_id", id).order("position"),
    supabase.from("horeca_catalog_products").select("id,collection_id,name,price,currency,size_value,size_unit,sku,image_path,position,active")
      .eq("catalog_id", id).order("position"),
  ]);
  if (!catalog.data || collections.error || products.error) return null;
  return {
    ...catalog.data,
    language: catalog.data.language as CatalogLanguage,
    discount_percent: Number(catalog.data.discount_percent),
    collections: collections.data ?? [],
    products: (products.data ?? []).map(product => ({
      ...product,
      price: Number(product.price),
      size_value: product.size_value === null ? null : Number(product.size_value),
      size_unit: product.size_unit as SizeUnit | null,
    })),
  };
}

export function isImagePath(path: string) {
  return seedPattern.test(path) || storagePattern.test(path);
}

// A storage path belongs to the catalog it is stored under.
export function imagePathCatalog(path: string) {
  return storagePattern.exec(path)?.[1] ?? null;
}

export async function loadCatalogImage(supabase: Client, path: string): Promise<ImageSource | null> {
  const seed = seedPattern.exec(path);
  if (seed) {
    const data = await readFile(join(seedDir, seed[1])).catch(() => null);
    return data ? { data, format: seed[1].toLowerCase().endsWith(".png") ? "png" : "jpg" } : null;
  }
  const stored = storagePattern.exec(path);
  if (!stored) return null;
  // Read with the caller's session: the bucket's row security lets only catalog editors and admins in.
  const { data, error } = await supabase.storage.from(catalogImagesBucket).download(path);
  if (error || !data) return null;
  return { data: Buffer.from(await data.arrayBuffer()), format: stored[2] === "png" ? "png" : "jpg" };
}

// Removes a stored photo once no product of any catalog uses it any more (duplicates share photos).
export async function removeImageIfUnused(supabase: Client, path: string | null) {
  if (!path || !storagePattern.test(path)) return;
  const { count } = await supabase.from("horeca_catalog_products").select("id", { count: "exact", head: true }).eq("image_path", path);
  if (count === 0) await supabase.storage.from(catalogImagesBucket).remove([path]);
}
