import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { DocumentEditor, type EditorClient, type EditorDocument, type EditorCollection, type EditorProduct, type RelatedDocument } from "./document-editor";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string; collection?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "account"]);
  const { id } = await params;
  const query = await searchParams;
  const kind = query.kind === "proforma" ? "proforma" : "offer";
  if (id !== "new" && !uuid.test(id)) notFound();

  const [documentResult, clientsResult, catalogResult, collectionsResult] = await Promise.all([
    id === "new" ? Promise.resolve(null) : supabase.from("sales_documents")
      .select("id,kind,number,status,partner_id,client_name,client_vat_id,client_registration,client_street,client_city,client_county,client_zip,contact_name,contact_email,contact_phone,save_as_partner,discount_percent,validity_days,notes,bocp_error,bocp_order_id,bocp_proforma_total,cart_id,invoice_requested_at,invoiced_at,invoice_number,invoice_date,bocp_invoice_id,cancel_requested_at,cancel_reason,cancelled_at,issued_at,source_document_id,partner_carts!sales_documents_cart_id_fkey(id,status,prepared_at,delivered_at,invoiced_at,invoice_number,bocp_invoice_id),sales_document_items(product_id,sku,name,quantity,unit_price,vat_percent,discount_percent,position)")
      .eq("id", id).maybeSingle(),
    supabase.from("partners").select("id,business_name,billing_name,vat_id,registration_number,billing_street,billing_city,billing_county,billing_zip,contact_phone,contact_email,partner_discounts(category,percent)")
      .eq("account_id", profile.id).eq("active", true).order("business_name").limit(500),
    supabase.from("products").select("id,name,sku,category,list_price,vat_percent").eq("active", true).not("list_price", "is", null).gt("list_price", 0).order("name").limit(5000),
    supabase.from("product_collections").select("id,name,product_collection_items(product_id,position)").order("name").limit(500),
  ]);
  const collections: EditorCollection[] = (collectionsResult.data ?? []).map((collection) => ({
    id: collection.id, name: collection.name,
    productIds: [...collection.product_collection_items].sort((a, b) => a.position - b.position).map((item) => item.product_id),
  }));
  // "Ofertă nouă din colecție" (from the catalog) opens a new document already filled.
  const startCollection = id === "new" && query.collection ? collections.find((collection) => collection.id === query.collection) ?? null : null;
  if (documentResult && !documentResult.data) notFound();
  const document: EditorDocument | null = documentResult?.data ?? null;
  // The offer a proforma was made from, and the proformas made from an offer.
  const related: RelatedDocument[] = document ? (await supabase.from("sales_documents").select("id,kind,number,status")
    .or(`id.eq.${document.source_document_id ?? document.id},source_document_id.eq.${document.id}`).neq("id", document.id).limit(20)).data ?? [] : [];
  const clients: EditorClient[] = clientsResult.data ?? [];
  const catalog: EditorProduct[] = catalogResult.data ?? [];
  const title = document?.number ?? (document ? "Ciornă" : (kind === "offer" ? "Ofertă nouă" : "Proformă nouă"));

  return (
    <AppShell profile={profile} active="/account/offers" section="Oferte și proforme" title={title}
      note={{ title: "Documente", text: "Oferta rămâne în aplicație. Proforma se emite în BOCP și rezervă stocul; de pe ea rezervi comanda la depozit sau ceri factura." }}>
      <DocumentEditor document={document} related={related} initialKind={document?.kind === "proforma" ? "proforma" : document ? "offer" : kind} clients={clients} catalog={catalog} collections={collections} startCollection={startCollection} />
    </AppShell>
  );
}
