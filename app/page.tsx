import { redirect } from "next/navigation";
import { homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: profile } = await supabase.from("app_users")
    .select("role,active").eq("id", userId).maybeSingle();
  if (profile?.active) redirect(homeFor(profile.role));
  const { data: partner } = await supabase.from("partners")
    .select("id").eq("auth_user_id", userId).eq("active", true).maybeSingle();
  redirect(partner ? "/partner" : "/access");
}
