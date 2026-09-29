"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homeFor, staffRoles, viewAsCookie, viewAsPartnerValue, type UserRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dev-mode view switch. Only a real admin (checked in the database, not from the cookie) may use
// it. `target` is a staff role or "partner:<partner id>".
export async function switchView(target: string) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: profile } = await supabase.from("app_users").select("role,active").eq("id", userId).maybeSingle();
  if (!profile?.active || profile.role !== "admin") redirect("/access");

  const store = await cookies();
  const options = { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };
  if (target.startsWith("partner:")) {
    const partnerId = target.slice("partner:".length);
    if (!uuid.test(partnerId)) redirect("/access");
    store.set(viewAsCookie, viewAsPartnerValue(partnerId), options);
    redirect("/partner");
  }
  if (!staffRoles.includes(target as UserRole)) redirect("/access");
  if (target === "admin") store.delete(viewAsCookie);
  else store.set(viewAsCookie, target, options);
  redirect(homeFor(target as UserRole));
}
