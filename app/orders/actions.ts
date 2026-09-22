"use server";

import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; message: string };

async function warehouseClient() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const { data: profile } = await supabase.from("app_users")
    .select("role,active").eq("id", claims.sub).maybeSingle();
  if (!profile?.active || !["admin", "operator_depozit"].includes(profile.role)) return null;
  return supabase;
}

async function runOrderAction(
  name: "claim_online_order" | "release_online_order" | "mark_online_order_ready" | "hand_online_order_to_courier",
  orderId: string,
  success: string,
  failure: string,
): Promise<Result> {
  const supabase = await warehouseClient();
  if (!supabase) return { ok: false, message: "Sesiunea sau accesul nu mai este valid." };
  const { data, error } = await supabase.rpc(name, { p_order_id: orderId });
  if (error) return { ok: false, message: "Operațiunea nu a putut fi salvată. Încearcă din nou." };
  return { ok: data === true, message: data === true ? success : failure };
}

export async function claimOrder(orderId: string) {
  return runOrderAction("claim_online_order", orderId, "Comanda a fost preluată.", "Comanda a fost preluată între timp sau nu mai este disponibilă.");
}

export async function releaseOrder(orderId: string) {
  return runOrderAction("release_online_order", orderId, "Comanda a revenit pe board. Progresul scanării a fost resetat.", "Comanda nu poate fi eliberată în starea curentă.");
}

export async function markReady(orderId: string) {
  return runOrderAction("mark_online_order_ready", orderId, "Toate produsele sunt confirmate. Comanda este pregătită.", "Scanează toate produsele înainte de confirmare.");
}

export async function handToCourier(orderId: string) {
  return runOrderAction("hand_online_order_to_courier", orderId, "Predarea către curier sau șofer a fost înregistrată.", "Comanda trebuie să fie pregătită înainte de predare.");
}

export async function scanItem(orderId: string, enteredCode: string): Promise<Result> {
  const supabase = await warehouseClient();
  if (!supabase) return { ok: false, message: "Sesiunea sau accesul nu mai este valid." };
  const code = enteredCode.trim();
  if (!code) return { ok: false, message: "Introdu codul produsului." };
  const { data, error } = await supabase.rpc("scan_online_order_code", { p_order_id: orderId, p_code: code });
  if (error) return { ok: false, message: "Scanarea nu a putut fi salvată. Încearcă din nou." };
  return { ok: data === true, message: data === true ? "Produs confirmat." : "Codul nu corespunde unui produs rămas de confirmat în această comandă." };
}
