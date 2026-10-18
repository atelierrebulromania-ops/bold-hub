import { AppShell } from "@/components/app-shell";
import { b2bSkuFilter } from "@/lib/b2b-products";
import { requireRole } from "@/lib/auth";
import { PartnersBoard, type Backorder, type CatalogProduct, type DeliveryGroup, type Partner } from "./partners-board";

export const dynamic = "force-dynamic";

type Point = { id: string; name: string; city: string | null; address: string | null; contact_phone: string | null; is_main: boolean; active: boolean };
type Row = Omit<Partner, "client_id" | "location_id" | "client_name" | "address" | "partner_par_levels" | "partner_carts"> & {
  stock_mode: string;
  partner_locations: Point[];
  partner_par_levels: (Partner["partner_par_levels"][number] & { location_id: string | null })[];
  partner_carts: (Partner["partner_carts"][number] & { location_id: string | null })[];
};

// The board's cards: one per client, or one per point of work when the client orders per point.
function toCards(rows: Row[]): Partner[] {
  return rows.flatMap((row): Partner[] => {
    const points = row.partner_locations.filter((location) => location.active);
    const main = row.partner_locations.find((location) => location.is_main) ?? null;
    const where = (location: Point | null) => location ? [location.address, location.city].filter(Boolean).join(", ") || null : null;
    const base = { ...row, client_id: row.id, client_name: row.business_name };
    if (row.stock_mode !== "per_location" || points.length <= 1) {
      return [{ ...base, location_id: null as string | null, address: where(main),
        partner_par_levels: row.partner_par_levels.filter((level) => row.stock_mode === "per_location" ? level.location_id === main?.id : level.location_id === null) }];
    }
    return points.map((point) => ({ ...base, id: `${row.id}:${point.id}`, location_id: point.id, business_name: `${row.business_name} — ${point.name}`,
      address: where(point), contact_phone: point.contact_phone || row.contact_phone,
      partner_carts: row.partner_carts.filter((cart) => cart.location_id === point.id),
      partner_par_levels: row.partner_par_levels.filter((level) => level.location_id === point.id) }));
  });
}

export default async function PartnersPage() {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit", "account"]);
  const product = "products(name,sku,variant_label)";
  const cartProduct = "products(name,sku,variant_label,warehouse_stock(quantity_bocp_global))";
  const [partnersResult, groupsResult, productsResult, backordersResult] = await Promise.all([supabase.from("partners")
    .select(`id,business_name,type,contact_phone,contact_email,is_important_client,stock_mode,
      partner_locations(id,name,city,address,contact_phone,is_main,active),
      partner_par_levels(id,product_id,location_id,par_level_quantity,${product}),
      partner_carts(id,status,location_id,countdown_started_at,prepared_at,reserved_in_bocp_at,bocp_order_id,bocp_order_error,partner_cart_items(id,product_id,quantity_needed,${cartProduct}))`)
    .eq("active", true)
    .in("partner_carts.status", ["open", "prepared"])
    .order("business_name").limit(1000),
    supabase.from("delivery_groups").select("id,name,partner_delivery_groups(partner_id)").order("name").limit(500),
    supabase.from("products").select("id,name,sku,variant_label").eq("active", true).or(b2bSkuFilter).order("name").limit(5000),
    supabase.from("partner_backorders").select(`id,partner_id,location_id,product_id,quantity,status,created_at,${cartProduct}`)
      .in("status", ["open", "shelved"]).order("created_at").limit(2000),
  ]);
  const error = partnersResult.error ?? groupsResult.error ?? productsResult.error ?? backordersResult.error;
  const backorders = (backordersResult.data ?? []) as Backorder[];
  const partners = toCards((partnersResult.data ?? []) as unknown as Row[]);
  const groups: DeliveryGroup[] = groupsResult.data ?? [];
  const catalog: CatalogProduct[] = productsResult.data ?? [];

  return (
    <AppShell profile={profile} active="/partners" section="Operațiuni" title="Comenzi B2B"
      note={profile.role === "account"
        ? { title: "Stoc pe raft", text: "Stocul estimat este stocul inițial minus ce e în coș sau pe drum." }
        : { title: "De pregătit", text: "„Pe raft” e ce mai are partenerul; „de pus” e cât trebuie pregătit pentru cererea nouă." }}>
      {error ? <p className="notice error" role="alert">Partenerii nu pot fi încărcați acum. Reîncarcă pagina.</p>
        : <PartnersBoard partners={partners} groups={groups} catalog={catalog} backorders={backorders}
          warehouse={profile.role !== "account"} canCancel={profile.role === "account" || profile.role === "admin"} />}
    </AppShell>
  );
}
