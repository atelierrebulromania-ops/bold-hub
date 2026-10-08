import { AppShell } from "@/components/app-shell";
import { SubmitButton } from "@/components/submit-button";
import { requireRole } from "@/lib/auth";
import { BOCP_LAUNCH_DATE } from "@/lib/bocp/feeds";
import { formatDateTime } from "@/lib/orders";
import { setAutoImport } from "./actions";
import { PreviewPanel } from "./preview-panel";

export const dynamic = "force-dynamic";

type LastRun = { ok?: boolean; inserted?: number; alreadyPresent?: number; error?: string; status?: string } | null;

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase, profile } = await requireRole(["admin"]);
  const params = await searchParams;
  const { data: settings } = await supabase.from("app_settings").select("launched_on,auto_import,auto_import_changed_at,last_auto_import_at,last_auto_import").eq("id", 1).maybeSingle();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
  const launchedOn = settings?.launched_on ?? null;
  const autoImport = settings?.auto_import === true;
  const lastRun = (settings?.last_auto_import ?? null) as LastRun;

  return (
    <AppShell profile={profile} active="/admin/integrations" section="Administrare" title="Integrări"
      note={{ title: "Import BOCP", text: "Primul import se face manual; apoi îl poți lăsa automat." }}>
      <div className="page-heading"><div><p className="eyebrow">ADMINISTRARE</p><h1>Integrări</h1><p className="muted">Comenzile online vin din facturile BOCP.</p></div></div>
      <PreviewPanel importEnabled={today >= BOCP_LAUNCH_DATE} today={today} minDate={BOCP_LAUNCH_DATE} launchedOn={launchedOn} />

      <section className="admin-card auto-import-card" aria-label="Import automat">
        <div>
          <h2>Import automat <span className={`auto-import-state ${autoImport ? "on" : "off"}`}>{autoImport ? "Pornit" : "Oprit"}</span></h2>
          <p>{!launchedOn ? "Se poate porni după primul import manual."
            : autoImport ? "Comenzile noi din BOCP intră singure în aplicație, la câteva minute."
            : "Comenzile intră doar când apeși „Importă comenzile”."}</p>
          {settings?.last_auto_import_at && <p>Ultima rulare: {formatDateTime(settings.last_auto_import_at)} · {lastRun?.ok
            ? `${lastRun.inserted ?? 0} comenzi noi`
            : <span className="danger-text">{lastRun?.error ?? "eșuată"}</span>}</p>}
          {params.error === "not_launched" && <p className="danger-text" role="alert">Fă întâi primul import manual.</p>}
        </div>
        <form action={setAutoImport}><input type="hidden" name="on" value={autoImport ? "false" : "true"} />
          <SubmitButton className={autoImport ? "button button-outline" : "button button-primary"} disabled={!launchedOn && !autoImport}>
            {autoImport ? "Oprește importul automat" : "Pornește importul automat"}</SubmitButton></form>
      </section>
    </AppShell>
  );
}
