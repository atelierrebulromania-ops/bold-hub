import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];

// `role` is the role the screens act on; `realRole` is the one stored on the account.
// They differ only when an admin uses the dev-mode role switcher.
export type Profile = { id: string; full_name: string; role: UserRole; realRole: UserRole };

export const staffRoles: readonly UserRole[] = ["admin", "owner", "operator_depozit", "operator_facturare", "account"];
export const viewAsCookie = "boldhub-view-as";

const partnerPrefix = "partner:";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dev mode: an admin can look at the app as another role, or as one partner location.
// The cookie is ignored for everyone else, and the database keeps checking the real (admin)
// account, so nothing is unlocked. Values: a staff role, or "partner:<partner id>".
export async function viewAs(realRole: UserRole): Promise<{ role: UserRole } | { partnerId: string } | null> {
  if (realRole !== "admin") return null;
  const value = (await cookies()).get(viewAsCookie)?.value ?? "";
  if (value.startsWith(partnerPrefix) && uuidPattern.test(value.slice(partnerPrefix.length))) {
    return { partnerId: value.slice(partnerPrefix.length) };
  }
  return staffRoles.includes(value as UserRole) ? { role: value as UserRole } : null;
}

export function viewAsPartnerValue(partnerId: string) {
  return `${partnerPrefix}${partnerId}`;
}

export async function effectiveRole(realRole: UserRole): Promise<UserRole> {
  const view = await viewAs(realRole);
  return view && "role" in view ? view.role : realRole;
}

// Each role lands on the first screen it can actually use.
export function homeFor(role: UserRole): string {
  if (role === "owner") return "/dashboard";
  if (role === "account") return "/account";
  if (role === "operator_facturare") return "/returns";
  if (role === "operator_depozit") return "/warehouse";
  return "/orders";
}

export async function requireRole(roles: readonly UserRole[]) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: profile } = await supabase.from("app_users")
    .select("full_name,role,active").eq("id", userId).maybeSingle();
  if (!profile?.active) redirect("/access");
  const view = await viewAs(profile.role);
  if (view && "partnerId" in view) redirect("/partner");
  const role = view?.role ?? profile.role;
  if (!roles.includes(role)) redirect("/access");
  return { supabase, userId, profile: { id: userId, full_name: profile.full_name, role, realRole: profile.role } as Profile };
}

// Partners log in with their own Supabase Auth account, linked by an admin; they have no staff profile.
export async function requirePartner() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: partner } = await supabase.from("partners")
    .select("id,business_name,location_name,is_important_client")
    .eq("auth_user_id", userId).eq("active", true).maybeSingle();
  if (partner) return { supabase, userId, partner, preview: false };

  // Dev mode: an admin previewing one partner location. Reads work (admin sees every row, and
  // the partner page filters by partner id); partner actions still run as the admin and fail.
  const { data: staff } = await supabase.from("app_users").select("role,active").eq("id", userId).maybeSingle();
  const view = staff?.active ? await viewAs(staff.role) : null;
  if (!view || !("partnerId" in view)) redirect("/access");
  const { data: previewed } = await supabase.from("partners")
    .select("id,business_name,location_name,is_important_client").eq("id", view.partnerId).maybeSingle();
  if (!previewed) redirect("/access");
  return { supabase, userId, partner: previewed, preview: true };
}
