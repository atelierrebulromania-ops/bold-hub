import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { IntegrationsBoard, type IntegrationRow } from "./integrations-board";

export const dynamic = "force-dynamic";

// Contabilitate → Integrări (admin): where each supplier's documents come from, the Capture extension, companies
// and who in accounting sees which company.
export default async function AccountingIntegrationsPage() {
  const { supabase, profile } = await requireRole(["admin"]);
  const [integrations, suppliers, documents, companies, accountants, access, tokens] = await Promise.all([
    supabase.from("accounting_integrations").select("id,supplier_id,method,status,supports_sync,last_sync_at,last_document_at,last_error,last_error_at,note"),
    supabase.from("accounting_suppliers").select("id,slug,name,domains,active,sort").order("sort").order("name"),
    supabase.from("accounting_documents").select("supplier_id,file_deleted_at").limit(20000),
    supabase.from("accounting_companies").select("id,name,vat_id,active").order("name"),
    supabase.from("app_users").select("id,full_name,username,active").eq("role", "contabilitate").order("full_name"),
    supabase.from("accounting_company_access").select("user_id,company_id"),
    supabase.from("accounting_capture_tokens").select("id,label,created_at,expires_at,revoked_at,last_used_at").eq("user_id", profile.id)
      .is("revoked_at", null).order("created_at", { ascending: false }),
  ]);
  const loadError = integrations.error ?? suppliers.error ?? documents.error ?? companies.error ?? accountants.error ?? access.error ?? tokens.error;

  const counts = new Map<string, { held: number; total: number }>();
  for (const document of documents.data ?? []) {
    const slot = counts.get(document.supplier_id) ?? { held: 0, total: 0 };
    slot.total += 1;
    if (!document.file_deleted_at) slot.held += 1;
    counts.set(document.supplier_id, slot);
  }
  const bySupplier = new Map((integrations.data ?? []).map((row) => [row.supplier_id, row]));
  const rows: IntegrationRow[] = (suppliers.data ?? []).map((supplier) => ({
    supplier, integration: bySupplier.get(supplier.id) ?? null, held: counts.get(supplier.id)?.held ?? 0, total: counts.get(supplier.id)?.total ?? 0,
  }));
  const now = Date.now();
  const liveTokens = (tokens.data ?? []).filter((token) => Date.parse(token.expires_at) > now);

  return (
    <AppShell profile={profile} active="/accounting/integrations" section="Contabilitate" title="Integrări"
      note={{ title: "Integrări", text: "De unde vin documentele fiecărui furnizor. Nicio sursă nu apare „conectată” fără o conexiune reală." }}>
      {loadError ? <p className="notice error" role="alert">Integrările nu pot fi încărcate acum. Reîncarcă pagina.</p>
        : <IntegrationsBoard rows={rows} companies={companies.data ?? []} accountants={accountants.data ?? []} access={access.data ?? []}
          tokens={liveTokens} canConnect={profile.realRole === "admin"} />}
    </AppShell>
  );
}
