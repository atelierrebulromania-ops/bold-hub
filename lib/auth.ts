import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];

export type Profile = { id: string; full_name: string; role: UserRole };

// Each role lands on the first screen it can actually use.
export function homeFor(role: UserRole): string {
  if (role === "owner") return "/dashboard";
  if (role === "operator_facturare") return "/returns";
  return "/orders";
}

export async function requireRole(roles: readonly UserRole[]) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: profile } = await supabase.from("app_users")
    .select("full_name,role,active").eq("id", userId).maybeSingle();
  if (!profile?.active || !roles.includes(profile.role)) redirect("/access");
  return { supabase, userId, profile: { id: userId, full_name: profile.full_name, role: profile.role } as Profile };
}

// Resellers log in with their own Supabase Auth account, linked by an admin; they have no staff profile.
export async function requireReseller() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: reseller } = await supabase.from("resellers")
    .select("id,business_name,location_name,is_important_client")
    .eq("auth_user_id", userId).eq("active", true).maybeSingle();
  if (!reseller) redirect("/access");
  return { supabase, userId, reseller };
}
