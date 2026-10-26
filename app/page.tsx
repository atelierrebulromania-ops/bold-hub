import { redirect } from "next/navigation";
import { homeFor, mustChangePassword, viewAs } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (!userId) redirect("/login");
  if (mustChangePassword(authData?.claims)) redirect("/password");
  const { data: profile } = await supabase.from("app_users")
    .select("role,active").eq("id", userId).maybeSingle();
  if (profile?.active) {
    const view = await viewAs(profile.role);
    redirect(view && "partnerId" in view ? "/partner" : homeFor(view?.role ?? profile.role));
  }
  // A partner: the client's manager login or a point login (row security shows it its client).
  const { data: partner } = await supabase.from("partners").select("id").eq("active", true).limit(1).maybeSingle();
  redirect(partner ? "/partner" : "/access");
}
