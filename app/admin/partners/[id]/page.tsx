import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClientFile, type AgentClient, type CatalogItem } from "@/app/account/clients-board";
import { clientFileSelect, clientTab, productCategories } from "@/app/account/client-select";
import { b2bSkuFilter } from "@/lib/b2b-products";
import { requireRole } from "@/lib/auth";
import { AdminSection, type Agent } from "../admin-clients";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Admin → Clienți → a client: the agents' client file plus the Administrare tab.
export default async function AdminClientFilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { supabase, profile } = await requireRole(["admin"]);
  const { id } = await params;
  const { tab } = await searchParams;
  if (!uuid.test(id)) notFound();
  const [clientResult, usersResult, catalogResult] = await Promise.all([
    supabase.from("partners").select(clientFileSelect).eq("id", id).maybeSingle(),
    supabase.from("app_users").select("id,full_name,role,active").order("full_name"),
    supabase.from("products").select("id,name,sku,category,list_price").eq("active", true).or(b2bSkuFilter).order("name").limit(5000),
  ]);
  const client = clientResult.data as AgentClient | null;
  if (!clientResult.error && !client) notFound();
  const users = usersResult.data ?? [];
  const agents: Agent[] = users.filter((user) => user.role === "account" && user.active);
  const owners = Object.fromEntries(users.map((user) => [user.id, user.full_name]));
  const catalog: CatalogItem[] = catalogResult.data ?? [];

  return (
    <AppShell profile={profile} active="/admin/partners" section="Administrare" title={client?.business_name ?? "Client"}
      note={{ title: "Fișa clientului", text: "Fișa completă a clientului. Agentul, clientul din BOCP și contul se setează la Administrare." }}>
      {clientResult.error || usersResult.error || catalogResult.error || !client ? <p className="notice error" role="alert">Fișa clientului nu poate fi încărcată acum. Reîncarcă pagina.</p>
        : <ClientFile key={`${client.id}-${client.bocp_contact_id ?? ""}`} client={client} catalog={catalog} categories={productCategories(catalog)} tab={clientTab(tab)}
          backHref="/admin/partners" backLabel="Toți clienții" admin={<AdminSection client={client} agents={agents} owners={owners} />} />}
    </AppShell>
  );
}
