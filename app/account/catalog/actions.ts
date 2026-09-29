"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";

type Result = { ok: boolean; message: string; id?: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Creates (id null) or replaces a collection with the given products, in order.
export async function saveCollection(id: string | null, name: string, productIds: string[]): Promise<Result> {
  const { supabase } = await requireRole(["admin", "account"]);
  if (id !== null && !uuid.test(id)) return { ok: false, message: "Colecția nu este validă." };
  if (!name.trim() || name.trim().length > 120) return { ok: false, message: "Dă un nume colecției (max. 120 de caractere)." };
  if (productIds.length > 500 || productIds.some((productId) => !uuid.test(productId))) return { ok: false, message: "Lista de produse nu este validă." };
  const { data, error } = await supabase.rpc("save_product_collection", { p_id: id, p_name: name.trim(), p_product_ids: productIds });
  if (error) return { ok: false, message: "Nu am putut salva colecția." };
  if (!data) return { ok: false, message: "Doar cine a creat colecția (sau adminul) o poate modifica." };
  revalidatePath("/account/catalog");
  return { ok: true, message: id ? "Colecția a fost salvată." : `Colecția „${name.trim()}” a fost creată.`, id: data };
}

export async function deleteCollection(id: string): Promise<Result> {
  const { supabase } = await requireRole(["admin", "account"]);
  if (!uuid.test(id)) return { ok: false, message: "Colecția nu este validă." };
  const { data } = await supabase.rpc("delete_product_collection", { p_id: id });
  if (!data) return { ok: false, message: "Doar cine a creat colecția (sau adminul) o poate șterge." };
  revalidatePath("/account/catalog");
  return { ok: true, message: "Colecția a fost ștearsă." };
}
