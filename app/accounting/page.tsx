import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { DocumentsBoard, type AccountingDocument } from "./documents-board";

export const dynamic = "force-dynamic";

// Contabilitate → Documente: what is held for the accountant (row security shows the companies the user may see).
export default async function AccountingDocumentsPage({ searchParams }: { searchParams: Promise<{ document?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "contabilitate"]);
  const { document } = await searchParams;
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  const [documentsResult, companiesResult, suppliersResult] = await Promise.all([
    // Held files, plus the last months of expired ones (metadata only) for the history view.
    supabase.from("accounting_documents")
      .select("id,company_id,supplier_id,doc_type,invoice_number,issued_on,period,original_name,mime_type,size_bytes,collection_method,collected_at,expires_at,last_downloaded_at,download_count,file_deleted_at,accounting_suppliers(name),accounting_companies(name)")
      .or(`file_deleted_at.is.null,collected_at.gte.${since}`).order("collected_at", { ascending: false }).limit(2000),
    supabase.from("accounting_companies").select("id,name").eq("active", true).order("name"),
    supabase.from("accounting_suppliers").select("id,name,default_doc_type").eq("active", true).order("sort").order("name"),
  ]);
  const documents = (documentsResult.data ?? []) as AccountingDocument[];
  const error = documentsResult.error ?? companiesResult.error ?? suppliersResult.error;

  return (
    <AppShell profile={profile} active="/accounting" section="Contabilitate" title="Documente"
      note={{ title: "Documente", text: "Spațiu temporar de predare către contabilitate: fiecare fișier se șterge automat la 30 de zile de la colectare." }}>
      {error ? <p className="notice error" role="alert">Documentele nu pot fi încărcate acum. Reîncarcă pagina.</p>
        : <DocumentsBoard documents={documents} companies={companiesResult.data ?? []} suppliers={suppliersResult.data ?? []}
          canUpload={profile.role === "admin"} highlight={document ?? null} />}
    </AppShell>
  );
}
