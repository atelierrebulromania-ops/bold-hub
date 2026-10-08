import { AppShell } from "@/components/app-shell";
import { ActionCard, Stat, WeekChart, minutes, todayLabel, waitingFor } from "@/components/dashboard-cards";
import { requireRole } from "@/lib/auth";
import { addDays, bucharestDay, bucharestMidnight } from "@/lib/dashboard-range";
import { formatDateTime, statusLabels } from "@/lib/orders";

export const dynamic = "force-dynamic";

const DAYS = 7;
const B2B_OVERDUE_HOURS = 48;
const number = new Intl.NumberFormat("ro-RO");

type Handed = { completed_at: string | null; claimed_at: string | null; claimed_by: string | null };
type Cart = { id: string; created_at: string; partners: { business_name: string; location_name: string } | null; partner_cart_items: { quantity_needed: number }[] };

export default async function WarehouseDashboard() {
  const { supabase, profile } = await requireRole(["operator_depozit"]);
  const now = Date.now();
  const today = bucharestDay(new Date(now));
  const todayStart = bucharestMidnight(today).toISOString();
  const days = Array.from({ length: DAYS }, (_, index) => addDays(today, index - (DAYS - 1)));
  const count = { count: "exact", head: true } as const;

  const [pending, oldestPending, mine, carts, returnsPending, oldestReturn, handed, returnsToday, myReturnsToday, b2bToday] = await Promise.all([
    supabase.from("online_orders").select("id", count).eq("status", "pending"),
    supabase.from("online_orders").select("created_at").eq("status", "pending").order("created_at").limit(1).maybeSingle(),
    supabase.from("online_orders").select("id,invoice_number,customer_name,status,claimed_at")
      .eq("claimed_by", profile.id).in("status", ["claimed", "preparing", "ready"]).order("claimed_at").limit(50),
    supabase.from("partner_carts").select("id,created_at,partners(business_name,location_name),partner_cart_items(quantity_needed)")
      .eq("status", "open").order("created_at").limit(100),
    supabase.from("order_returns").select("id", count).eq("status", "pending_restock"),
    supabase.from("order_returns").select("registered_at").eq("status", "pending_restock").order("registered_at").limit(1).maybeSingle(),
    supabase.from("online_orders").select("completed_at,claimed_at,claimed_by").in("status", ["handed_to_courier", "returned"])
      .gte("completed_at", bucharestMidnight(days[0]).toISOString()).limit(5000),
    supabase.from("order_returns").select("id", count).gte("restocked_at", todayStart),
    supabase.from("order_returns").select("id", count).gte("restocked_at", todayStart).eq("restocked_by", profile.id),
    supabase.from("partner_carts").select("id", count).gte("prepared_at", todayStart),
  ]);
  const loadError = pending.error ?? mine.error ?? carts.error ?? returnsPending.error ?? handed.error;

  const openCarts = (carts.data ?? []) as Cart[];
  const overdueCarts = openCarts.filter(cart => now - new Date(cart.created_at).getTime() > B2B_OVERDUE_HOURS * 3600000).length;
  const myOrders = mine.data ?? [];

  // Handed per day (team and mine), plus today's figures.
  const perDay = new Map(days.map(day => [day, { team: 0, mine: 0 }]));
  const myPrepMinutes: number[] = [];
  for (const order of (handed.data ?? []) as Handed[]) {
    if (!order.completed_at) continue;
    const slot = perDay.get(bucharestDay(new Date(order.completed_at)));
    if (!slot) continue;
    slot.team += 1;
    if (order.claimed_by === profile.id) {
      slot.mine += 1;
      if (order.completed_at >= todayStart && order.claimed_at)
        myPrepMinutes.push((new Date(order.completed_at).getTime() - new Date(order.claimed_at).getTime()) / 60000);
    }
  }
  const handedToday = perDay.get(today) ?? { team: 0, mine: 0 };
  const myAvgPrep = myPrepMinutes.length ? Math.round(myPrepMinutes.reduce((a, b) => a + b, 0) / myPrepMinutes.length) : null;
  const firstName = profile.full_name?.split(" ")[0];

  return (
    <AppShell profile={profile} active="/warehouse" section="Depozit" title="Dashboard"
      note={{ title: "Pe scurt", text: "Ce e de făcut acum în depozit și cum a mers ziua." }}>
      <div className="page-heading"><div><p className="eyebrow">DEPOZIT</p><h1>{firstName ? `Salut, ${firstName}` : "Dashboard"}</h1><p className="muted today-label">{todayLabel()}</p></div></div>

      {loadError ? <p className="notice error" role="alert">Datele nu pot fi încărcate acum.</p> : <>
        <h2 className="dashboard-section-title">De făcut acum</h2>
        <div className="stat-grid">
          <ActionCard href="/orders" label="Comenzi online de preluat" value={pending.count ?? 0}
            hint={oldestPending.data ? `cea mai veche așteaptă ${waitingFor(oldestPending.data.created_at, now)}` : "nimic în așteptare"} />
          <ActionCard href="/orders" label="Comenzile mele în lucru" value={myOrders.length}
            hint={myOrders.length ? `${myOrders.filter(order => order.status === "ready").length} gata de predare` : "nicio comandă preluată"} />
          <ActionCard href="/partners" label="Comenzi B2B de pregătit" value={openCarts.length} alert={overdueCarts > 0}
            hint={overdueCarts ? `${overdueCarts} peste ${B2B_OVERDUE_HOURS}h` : openCarts.length ? "toate în termen" : "nicio cerere deschisă"} />
          <ActionCard href="/returns" label="Retururi de verificat" value={returnsPending.count ?? 0}
            hint={oldestReturn.data ? `cel mai vechi ${waitingFor(oldestReturn.data.registered_at, now)}` : "nimic de verificat"} />
        </div>

        <h2 className="dashboard-section-title">Azi</h2>
        <div className="stat-grid">
          <Stat label="Predate curierului" value={number.format(handedToday.team)} hint={`${number.format(handedToday.mine)} de tine`} />
          <Stat label="Timpul tău mediu de pregătire" value={minutes(myAvgPrep)} hint="de la preluare la predare, azi" />
          <Stat label="Retururi verificate" value={number.format(returnsToday.count ?? 0)} hint={`${number.format(myReturnsToday.count ?? 0)} de tine`} />
          <Stat label="Comenzi B2B pregătite" value={number.format(b2bToday.count ?? 0)} hint="puse pe raft azi" />
        </div>

        <div className="dashboard-grid">
          <section className="admin-card">
            <div className="admin-card-heading"><h2>Predate în ultimele {DAYS} zile</h2><p>Toată echipa; partea închisă e a ta.</p></div>
            <WeekChart days={days.map(day => ({ day, ...perDay.get(day)! }))} />
          </section>
          <section className="admin-card">
            <div className="admin-card-heading"><h2>În lucru la tine</h2></div>
            {myOrders.length === 0 ? <p className="admin-empty-note">Nu ai comenzi preluate acum.</p>
              : <ul className="admin-simple-list dashboard-list">{myOrders.map(order => <li key={order.id}>
                <span>{order.invoice_number}<small>{order.customer_name ?? "—"} · preluată {waitingFor(order.claimed_at, now)}</small></span>
                <span className={`payment-chip ${order.status === "ready" ? "paid" : "open"}`}>{statusLabels[order.status]}</span>
              </li>)}</ul>}
          </section>
        </div>

        <section className="admin-card partner-list-section">
          <div className="admin-card-heading"><h2>Comenzi B2B de pregătit</h2><p>În ordinea cererii; peste {B2B_OVERDUE_HOURS}h sunt marcate.</p></div>
          {openCarts.length === 0 ? <p className="admin-empty-note">Nicio cerere B2B deschisă.</p>
            : <ul className="admin-simple-list dashboard-list">{openCarts.map(cart => {
              const late = now - new Date(cart.created_at).getTime() > B2B_OVERDUE_HOURS * 3600000;
              const units = cart.partner_cart_items.reduce((sum, line) => sum + line.quantity_needed, 0);
              return <li key={cart.id}>
                <span>{cart.partners?.business_name ?? "Client"}<small>{cart.partners?.location_name} · cerută {formatDateTime(cart.created_at)}</small></span>
                <span className="line-end">{late && <span className="payment-chip overdue">{waitingFor(cart.created_at, now)}</span>}<strong>{number.format(units)} buc.</strong></span>
              </li>;
            })}</ul>}
        </section>
      </>}
    </AppShell>
  );
}
