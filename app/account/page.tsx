import { AppShell } from "@/components/app-shell";
import { b2bSkuFilter } from "@/lib/b2b-products";
import { requireRole } from "@/lib/auth";
import { ClientsBoard, type AgentClient, type CatalogItem, type ClientsView, type OtherClient } from "./clients-board";

export const dynamic = "force-dynamic";

export default async function AccountClientsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "account"]);
  const view: ClientsView = (await searchParams).tab === "all" ? "all" : "mine";
  const [clientsResult, directoryResult, catalogResult] = await Promise.all([
    supabase.from("partners")
      .select(`id,business_name,location_name,type,contact_phone,contact_email,is_important_client,active,auth_user_id,account_username,
        billing_name,vat_id,registration_number,billing_street,billing_city,billing_county,billing_zip,
        partner_discounts(category,percent),
        partner_par_levels(product_id,par_level_quantity,products(name,sku)),
        partner_carts(id,status,created_at,prepared_at,delivered_at,invoiced_at,invoice_number,bocp_invoice_id,invoice_due_date,invoice_rest,partner_cart_items(quantity_needed))`)
      .eq("account_id", profile.id).order("business_name").limit(500),
    supabase.rpc("partner_directory"),
    supabase.from("products").select("id,name,sku,category,list_price").eq("active", true).or(b2bSkuFilter).order("name").limit(5000),
  ]);
  const clients: AgentClient[] = clientsResult.data ?? [];
  // Every active client of the company, the agent's own included.
  const directory: OtherClient[] = (directoryResult.data ?? []).filter((row) => row.active);
  const catalog: CatalogItem[] = catalogResult.data ?? [];
  const error = clientsResult.error ?? catalogResult.error;

  return (
    <AppShell profile={profile} active="/account" section="Account" title="Clienți"
      note={{ title: "Clienți", text: "Clienții tăi îi gestionezi complet; ceilalți clienți apar doar ca listă, cu agentul lor." }}>
      {error ? <p className="notice error" role="alert">Clienții nu pot fi încărcați acum. Reîncarcă pagina.</p>
        : <ClientsBoard view={view} clients={clients} directory={directory} catalog={catalog} userId={profile.id} />}
    </AppShell>
  );
}
