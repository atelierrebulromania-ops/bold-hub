import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NavCountsListener } from "@/components/nav-counts-listener";
import { requireRole, staffRoles } from "@/lib/auth";
import { LeadsBoard, type Lead } from "./leads-board";

export const dynamic = "force-dynamic";

export default async function CrmPage() {
  const { supabase, profile } = await requireRole(staffRoles);
  if (!profile.crm) redirect("/access");
  // Claiming follows the role on screen: agents, or the admin as themself.
  const canWork = profile.role === "admin" || profile.role === "account";

  const [{ data: leads, error }, { data: people }] = await Promise.all([
    supabase.from("leads").select("id,source,campaign,ad_name,form_name,full_name,company,phone,email,city,message,answers,status,lost_reason,claimed_by,claimed_at,partner_id,received_at,follow_up_at")
      .order("received_at", { ascending: false }).limit(1000),
    supabase.rpc("crm_people"),
  ]);
  const names = Object.fromEntries((people ?? []).map((person) => [person.id, person.full_name]));

  return (
    <AppShell profile={profile} active="/crm" section="Vânzări" title="Lead"
      note={{ title: "Lead", text: "Lead-urile din reclame și formulare. Agenții le preiau și le duc până la client." }}>
      <NavCountsListener tables={["leads"]} />
      {error ? <p className="notice error" role="alert">Lead-urile nu pot fi încărcate acum.</p>
        : <LeadsBoard leads={(leads ?? []) as Lead[]} names={names} currentUserId={profile.id} canWork={canWork} canImport={profile.role === "admin"} />}
    </AppShell>
  );
}
