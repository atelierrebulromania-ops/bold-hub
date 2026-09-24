import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { PartnersBoard, type CatalogProduct, type DeliveryGroup, type Partner } from "./partners-board";

export const dynamic = "force-dynamic";

export default async function PartnersPage() {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit"]);
  const product = "products(name,sku,variant_label)";
  const cartProduct = "products(name,sku,variant_label,warehouse_stock(quantity_bocp_global))";
  const [partnersResult, groupsResult, productsResult] = await Promise.all([supabase.from("partners")
    .select(`id,business_name,type,contact_phone,contact_email,is_important_client,
      partner_par_levels(id,product_id,par_level_quantity,${product}),
      partner_carts(id,status,countdown_started_at,prepared_at,partner_cart_items(id,product_id,quantity_needed,${cartProduct}))`)
    .eq("active", true)
    .in("partner_carts.status", ["open", "prepared", "pending_delivery"])
    .order("business_name").limit(1000),
    supabase.from("delivery_groups").select("id,name,partner_delivery_groups(partner_id)").order("name").limit(500),
    supabase.from("products").select("id,name,sku,variant_label").eq("active", true).order("name").limit(5000),
  ]);
  const error = partnersResult.error ?? groupsResult.error ?? productsResult.error;
  const partners: Partner[] = partnersResult.data ?? [];
  const groups: DeliveryGroup[] = groupsResult.data ?? [];
  const catalog: CatalogProduct[] = productsResult.data ?? [];

  return (
    <AppShell profile={profile} active="/partners" section="Operațiuni" title="Comenzi B2B"
      note={{ title: "Stoc pe raft", text: "Stocul estimat este stocul inițial minus ce e în coș sau pe drum." }}>
      {error ? <p className="notice error" role="alert">Partenerii nu pot fi încărcați acum. Reîncarcă pagina.</p>
        : <PartnersBoard partners={partners} groups={groups} catalog={catalog} />}
    </AppShell>
  );
}
