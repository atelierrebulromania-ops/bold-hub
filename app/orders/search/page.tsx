import { AppShell } from "@/components/app-shell";
import { OrderResultCard, SearchForm } from "@/components/order-result";
import { requireRole } from "@/lib/auth";
import type { OrderSearchResult } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function OrderSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "operator_depozit", "operator_facturare"]);
  const query = ((await searchParams).q ?? "").trim().slice(0, 120);
  const searched = query.length >= 3;
  const result = searched ? await supabase.rpc("search_online_orders", { p_query: query }) : null;
  const orders = (result?.data ?? []) as OrderSearchResult[];

  return (
    <AppShell profile={profile} active="/orders/search" section="Operațiuni" title="Căutare comenzi"
      note={{ title: "Investigare la cerere", text: "Nu se face urmărire automată a erorilor." }}>
      <div className="page-heading"><div><p className="eyebrow">COMENZI GREȘITE</p><h1>Căutare comenzi</h1><p className="muted">Când un client sesizează o problemă, găsește comanda și vezi cine a pregătit-o și ce conținea.</p></div></div>
      <section className="admin-card">
        <SearchForm action="/orders/search" query={query} placeholder="Ex. AR1234, Popescu, 0722…"/>
        {query && !searched && <p className="admin-empty-note">Introdu cel puțin 3 caractere.</p>}
        {result?.error && <p className="notice error search-notice" role="alert">Căutarea nu a putut fi făcută. Încearcă din nou.</p>}
        {searched && !result?.error && <div className="result-list">
          <p className="result-count">{orders.length === 50 ? "Primele 50 de rezultate — restrânge căutarea." : `${orders.length} ${orders.length === 1 ? "rezultat" : "rezultate"}`}</p>
          {orders.map(order => <OrderResultCard key={order.id} order={order}/>)}
        </div>}
      </section>
    </AppShell>
  );
}
