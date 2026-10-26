import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { b2bSkuFilter } from "@/lib/b2b-products";
import { requireRole } from "@/lib/auth";
import { ClientFile, type AgentClient, type CatalogItem } from "../../clients-board";
import { clientFileSelect, clientTab, productCategories } from "../../client-select";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The agent's client file on its own page (only the agent's own clients).
export default async function ClientFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { supabase, profile } = await requireRole(["admin", "account"]);
  const { id } = await params;
  const { tab } = await searchParams;
  if (!uuid.test(id)) notFound();
  let query = supabase.from("partners").select(clientFileSelect).eq("id", id);
  if (profile.role === "account") query = query.eq("account_id", profile.id);
  const [clientResult, catalogResult] = await Promise.all([
    query.maybeSingle(),
    supabase.from("products").select("id,name,sku,category,list_price").eq("active", true).or(b2bSkuFilter).order("name").limit(5000),
  ]);
  const client = clientResult.data as AgentClient | null;
  if (!clientResult.error && !client) notFound();
  const catalog: CatalogItem[] = catalogResult.data ?? [];

  return (
    <AppShell profile={profile} active="/account" section="Clienți" title={client?.business_name ?? "Client"}
      note={{ title: "Fișa clientului", text: "Toate datele clientului, pe tab-uri. Fiecare tab se salvează separat." }}>
      {clientResult.error || catalogResult.error || !client ? <p className="notice error" role="alert">Fișa clientului nu poate fi încărcată acum. Reîncarcă pagina.</p>
        : <ClientFile key={client.id} client={client} catalog={catalog} categories={productCategories(catalog)} tab={clientTab(tab) === "admin" ? "date" : clientTab(tab)}
          backHref="/account" backLabel="Clienții mei" />}
    </AppShell>
  );
}
