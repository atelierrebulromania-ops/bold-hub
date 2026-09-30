import Link from "next/link";
import { b2bSkuFilter } from "@/lib/b2b-products";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { CatalogTable, type CatalogClient, type CatalogProduct, type Collection } from "./catalog-table";
import { CollectionsBoard } from "./collections-board";
import { LinkPending } from "@/components/link-pending";

export const dynamic = "force-dynamic";

const tabs = [
  { view: "products", label: "Produse", title: "Catalog" },
  { view: "collections", label: "Colecții", title: "Colecțiile mele" },
] as const;

export default async function AgentCatalogPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "account"]);
  const view = (await searchParams).tab === "collections" ? "collections" : "products";
  const [productsResult, clientsResult, collectionsResult] = await Promise.all([
    supabase.from("products").select("id,name,sku,category,image_url,delisted,list_price,list_price_with_vat,vat_percent,warehouse_stock(quantity_bocp_global)")
      .eq("active", true).or(b2bSkuFilter).not("list_price", "is", null).gt("list_price", 0).order("name").limit(5000),
    supabase.from("partners").select("id,business_name,partner_discounts(category,percent)").eq("account_id", profile.id).order("business_name").limit(500),
    // Each agent's own collections (row security returns only theirs).
    supabase.from("product_collections").select("id,name,updated_at,product_collection_items(product_id,position)").order("name").limit(500),
  ]);
  const products: CatalogProduct[] = productsResult.data ?? [];
  const clients: CatalogClient[] = clientsResult.data ?? [];
  const collections: Collection[] = (collectionsResult.data ?? []).map((collection) => ({
    id: collection.id, name: collection.name, updatedAt: collection.updated_at,
    productIds: [...collection.product_collection_items].sort((a, b) => a.position - b.position).map((item) => item.product_id),
  }));

  return (
    <AppShell profile={profile} active="/account/catalog" section="Account" title="Catalog produse"
      note={{ title: "Prețuri și colecții", text: "Prețurile de listă vin din BOCP. Colecțiile tale sunt liste de produse pe care le adaugi dintr-un click în oferte și proforme; doar tu le vezi." }}>
      {productsResult.error ? <p className="notice error" role="alert">Catalogul nu poate fi încărcat acum. Reîncarcă pagina.</p>
        : <section className="board-panel" aria-label="Catalog produse">
          <div className="panel-tabs-row">
            <h2 className="panel-tabs-title">{tabs.find((tab) => tab.view === view)?.title}</h2>
            <nav className="board-tabs panel-tabs" aria-label="Vedere">
              {tabs.map((tab) => <Link key={tab.view} href={tab.view === "products" ? "/account/catalog" : "/account/catalog?tab=collections"}
                className={view === tab.view ? "active" : ""} aria-current={view === tab.view ? "page" : undefined}>
                {tab.label}{tab.view === "collections" && collections.length > 0 && <span>{collections.length}</span>}<LinkPending /></Link>)}
            </nav>
            <span aria-hidden="true" />
          </div>
          {view === "products"
            ? <CatalogTable products={products} clients={clients} collections={collections} />
            : <CollectionsBoard products={products} collections={collections} />}
        </section>}
    </AppShell>
  );
}
