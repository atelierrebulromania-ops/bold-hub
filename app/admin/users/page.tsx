import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { UsersBoard, type StaffUser } from "./users-board";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const { supabase, profile } = await requireRole(["admin"]);
  const { data, error } = await supabase.from("app_users")
    .select("id,full_name,username,notification_email,role,active,created_at")
    .order("active", { ascending: false }).order("full_name").limit(500);
  const users: StaffUser[] = data ?? [];

  return (
    <AppShell profile={profile} active="/admin/users" section="Administrare" title="Utilizatori"
      note={{ title: "Conturi cu username", text: "Utilizatorii intră cu username și parolă. Parolele se schimbă doar de aici." }}>
      {error ? <p className="notice error" role="alert">Utilizatorii nu pot fi încărcați acum. Reîncarcă pagina.</p>
        : <UsersBoard users={users} currentUserId={profile.id} serviceReady={!!process.env.SUPABASE_SERVICE_ROLE_KEY} />}
    </AppShell>
  );
}
