import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ActionCard, Stat, todayLabel } from "@/components/dashboard-cards";
import { docTypeLabel } from "@/lib/accounting/files";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

// An integration needs a look when it reports an error, or when nothing came from it for this long.
const STALE_DAYS = 35;

const day = (value: string) => new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "short", timeZone: "Europe/Bucharest" }).format(new Date(value));

export default async function AccountingOverviewPage() {
  const { supabase, profile } = await requireRole(["admin", "contabilitate"]);
  const isAdmin = profile.role === "admin";
  const [documentsResult, companiesResult, integrationsResult] = await Promise.all([
    supabase.from("accounting_documents")
      .select("id,company_id,doc_type,original_name,invoice_number,collected_at,expires_at,last_downloaded_at,accounting_suppliers(name),accounting_companies(name)")
      .is("file_deleted_at", null).order("collected_at", { ascending: false }).limit(2000),
    supabase.from("accounting_companies").select("id,name").eq("active", true).order("name"),
    isAdmin
      ? supabase.from("accounting_integrations").select("id,method,status,last_document_at,last_error,last_error_at,accounting_suppliers!inner(name,active)").eq("accounting_suppliers.active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const loadError = documentsResult.error ?? companiesResult.error ?? integrationsResult.error;
  const documents = documentsResult.data ?? [];
  const now = Date.now();
  const fresh = documents.filter((document) => !document.last_downloaded_at);
  const expiringSoon = documents.filter((document) => Date.parse(document.expires_at) - now < 7 * 86400000);
  const attention = (integrationsResult.data ?? []).flatMap((integration) => {
    const name = integration.accounting_suppliers?.name ?? "—";
    if (integration.status === "error") return [{ id: integration.id, name, reason: integration.last_error ?? "Eroare la ultima sincronizare", tone: "overdue" }];
    if (integration.method === "manual" || integration.status === "not_configured") return [];
    const last = integration.last_document_at ? Date.parse(integration.last_document_at) : null;
    if (last && now - last < STALE_DAYS * 86400000) return [];
    return [{ id: integration.id, name, reason: last ? `ultimul document pe ${day(integration.last_document_at!)}` : "niciun document colectat încă", tone: "open" }];
  });
  const perCompany = (companiesResult.data ?? []).map((company) => {
    const own = documents.filter((document) => document.company_id === company.id);
    return { ...company, total: own.length, fresh: own.filter((document) => !document.last_downloaded_at).length };
  });
  const firstName = profile.full_name?.split(" ")[0];

  return (
    <AppShell profile={profile} active="/accounting/overview" section="Contabilitate" title="Prezentare generală"
      note={{ title: "Pe scurt", text: "Ce documente așteaptă contabilitatea și ce se șterge în curând." }}>
      <div className="page-heading"><div><p className="eyebrow">CONTABILITATE</p><h1>{firstName ? `Salut, ${firstName}` : "Prezentare generală"}</h1><p className="muted today-label">{todayLabel()}</p></div></div>

      {loadError ? <p className="notice error" role="alert">Datele nu pot fi încărcate acum. Reîncarcă pagina.</p> : <>
        <div className="stat-grid">
          <ActionCard href="/accounting" label="Documente disponibile" value={documents.length} hint="fișiere care pot fi descărcate acum" />
          <ActionCard href="/accounting" label="Documente noi" value={fresh.length} alert={fresh.length > 0} hint={fresh.length ? "nedescărcate încă" : "totul a fost descărcat"} />
          <Stat label="Documente descărcate" value={String(documents.length - fresh.length)} hint="încă păstrate până la expirare" />
          <ActionCard href="/accounting" label="Expiră în 7 zile" value={expiringSoon.length} alert={expiringSoon.some((document) => !document.last_downloaded_at)}
            hint={expiringSoon.length ? `${expiringSoon.filter((document) => !document.last_downloaded_at).length} nedescărcate` : "nimic de recuperat urgent"} />
        </div>

        <div className="dashboard-grid">
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Ultimele documente</h2><p>Fișierele se șterg automat la 30 de zile de la colectare.</p></div>
            {documents.length === 0 ? <p className="admin-empty-note">Nu există încă documente.</p>
              : <ul className="admin-simple-list dashboard-list">{documents.slice(0, 10).map((document) => (
                <li key={document.id}>
                  <Link href={`/accounting?document=${document.id}`} className="dashboard-list-link"><span>{document.accounting_suppliers?.name ?? "—"}
                    <small>{[docTypeLabel(document.doc_type), document.invoice_number ? `nr. ${document.invoice_number}` : document.original_name, document.accounting_companies?.name].filter(Boolean).join(" · ")}</small></span></Link>
                  <span className={`payment-chip ${document.last_downloaded_at ? "paid" : "open"}`}>{document.last_downloaded_at ? "Descărcat" : "Nou"}</span>
                </li>))}</ul>}
          </section>
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Pe companii</h2><p>Documente disponibile și câte sunt noi.</p></div>
            {perCompany.length === 0 ? <p className="admin-empty-note">Nu ai acces la nicio companie.</p>
              : <ul className="admin-simple-list dashboard-list">{perCompany.map((company) => (
                <li key={company.id}><span>{company.name}<small>{company.total} disponibile</small></span>
                  <span className={`payment-chip ${company.fresh ? "open" : "paid"}`}>{company.fresh} noi</span></li>))}</ul>}
            {isAdmin && <>
              <div className="admin-card-heading accounting-subheading"><h2>Integrări de verificat</h2>
                <p>{attention.length ? `${attention.length} surse cu erori sau fără documente în ultimele ${STALE_DAYS} de zile.` : "Toate sursele au adus documente recent."}</p></div>
              {attention.length > 0 && <ul className="admin-simple-list dashboard-list">{attention.map((item) => (
                <li key={item.id}><span>{item.name}<small>{item.reason}</small></span>
                  <span className={`payment-chip ${item.tone}`}>{item.tone === "overdue" ? "Eroare" : "De verificat"}</span></li>))}</ul>}
              <p className="accounting-more"><Link href="/accounting/integrations" className="text-button">Vezi toate integrările</Link></p>
            </>}
          </section>
        </div>
      </>}
    </AppShell>
  );
}
