import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { PreviewPanel } from "./preview-panel";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { profile } = await requireRole(["admin"]);

  return (
    <AppShell profile={profile} active="/admin/integrations" section="Administrare" title="Integrări"
      note={{ title: "Mod de test", text: "Previzualizarea nu importă date." }}>
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRARE</p><h1>Integrări</h1><p className="muted">Verifică datele BOCP înainte de activarea fluxului operațional.</p></div><span className="page-heading-chip preview-chip">Doar citire</span></div>
      <PreviewPanel importEnabled={new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" }) >= "2026-10-01"} />
    </AppShell>
  );
}
