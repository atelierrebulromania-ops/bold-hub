import { AppShell } from "@/components/app-shell";
import type { AgentClient, CatalogItem } from "@/app/account/clients-board";
import { b2bSkuFilter } from "@/lib/b2b-products";
import { requireRole } from "@/lib/auth";
import { AdminClientsBoard, type Agent } from "./admin-clients";

export const dynamic = "force-dynamic";

// Admin → Clienți: every client, with the agents' client file and the admin-only settings.
export default async function AdminClientsPage() {
  const { supabase, profile } = await requireRole(["admin"]);
  const [clientsResult, agentsResult, catalogResult] = await Promise.all([
    supabase.from("partners")
      .select(`id,business_name,location_name,type,contact_phone,contact_email,is_important_client,active,auth_user_id,account_username,account_id,bocp_contact_id,
        billing_name,vat_id,registration_number,billing_street,billing_city,billing_county,billing_zip,
        own_consumption_discounts,partner_discounts(category,percent,channel),
        stock_mode,partner_locations(id,name,city,address,contact_name,contact_phone,is_main,active,account_username),
        partner_par_levels(product_id,location_id,channel,par_level_quantity,products(name,sku)),
        partner_contracts(id,title,status,supplier_uploaded_at,signed_uploaded_at),
        partner_custody_items(id,location_id,kind,product_id,name,quantity,unit_value,handed_on,trial_ends_on,status,closed_on,note),
        partner_carts(id,status,created_at,prepared_at,delivered_at,invoiced_at,invoice_number,bocp_invoice_id,invoice_due_date,invoice_rest,partner_cart_items(quantity_needed))`)
      .order("business_name").limit(1000),
    // Every user: a client may belong to an agent or (in tests) to the admin; only active agents can be picked.
    supabase.from("app_users").select("id,full_name,role,active").order("full_name"),
    supabase.from("products").select("id,name,sku,category,list_price").eq("active", true).or(b2bSkuFilter).order("name").limit(5000),
  ]);
  const clients = (clientsResult.data ?? []) as AgentClient[];
  const users = agentsResult.data ?? [];
  const agents: Agent[] = users.filter((user) => user.role === "account" && user.active);
  const owners = Object.fromEntries(users.map((user) => [user.id, user.full_name]));
  const catalog: CatalogItem[] = catalogResult.data ?? [];
  const error = clientsResult.error ?? agentsResult.error ?? catalogResult.error;

  return (
    <AppShell profile={profile} active="/admin/partners" section="Administrare" title="Clienți"
      note={{ title: "Clienți", text: "Toți clienții, cu fișa completă. Agentul, clientul din BOCP și contul se setează doar de aici." }}>
      {error ? <p className="notice error" role="alert">Clienții nu pot fi încărcați acum. Reîncarcă pagina.</p>
        : <AdminClientsBoard clients={clients} agents={agents} owners={owners} catalog={catalog} />}
    </AppShell>
  );
}
