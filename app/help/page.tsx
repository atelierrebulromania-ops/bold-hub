import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Ajutor: a one-page guide for the sales agents (Lead and clients). The alert hours come from Admin → Setări,
// so the text always matches what the app does.
export default async function HelpPage() {
  const { profile } = await requireRole(["admin", "account"]);
  const { data: settings } = await createAdminClient()?.from("app_settings")
    .select("lead_unclaimed_hours,lead_uncontacted_hours,lead_offer_days").eq("id", 1).maybeSingle() ?? { data: null };
  const unclaimed = settings?.lead_unclaimed_hours ?? 2;
  const uncontacted = settings?.lead_uncontacted_hours ?? 24;
  const offerDays = settings?.lead_offer_days ?? 7;

  return (
    <AppShell profile={profile} active="/help" section="Ajutor" title="Cum lucrezi cu lead-urile"
      note={{ title: "Ajutor", text: "Pașii unui lead, de la formular până la client nou." }}>
      <div className="help-page">
        <section className="board-panel help-card">
          <h2>Pe scurt</h2>
          <ol className="help-steps">
            <li><strong>Preia</strong> un lead din <Link href="/crm">Lead → Noi</Link>. Din acel moment e al tău și ceilalți văd cine l-a preluat.</li>
            <li><strong>Sună sau scrie</strong> clientului și mută lead-ul pe etapa la care ai ajuns.</li>
            <li><strong>Notează</strong> în Istoric ce ați discutat și ce urmează.</li>
            <li><strong>Închide-l</strong>: Câștigat (devine clientul tău) sau Pierdut (cu motiv).</li>
          </ol>
        </section>

        <section className="board-panel help-card">
          <h2>De unde vin lead-urile</h2>
          <p>Lead-urile intră singure din reclamele Meta (Facebook / Instagram) și din formularul de pe site. Fiecare apare imediat în
            <strong> Lead → Noi</strong>, cu notificare. Lead-urile găsite pe altă cale le adaugi tu cu <strong>+ Lead nou</strong>.</p>
          <p>Deschide un lead ca să vezi tot: telefon, email, oraș, campania și reclama din care a venit, plus răspunsurile din formular.</p>
        </section>

        <section className="board-panel help-card">
          <h2>Tab-urile din Lead</h2>
          <dl className="help-terms">
            <dt>Noi</dt><dd>Lead-uri pe care nu le-a preluat încă nimeni. Oricine le poate prelua.</dd>
            <dt>În lucru</dt><dd>Lead-uri preluate și încă deschise. Bifează <strong>Doar ale mele</strong> ca să le vezi doar pe ale tale.</dd>
            <dt>Câștigați / Pierduți</dt><dd>Lead-urile închise.</dd>
            <dt>Toate</dt><dd>Toată lista, cu căutare după nume, firmă, telefon, email sau campanie.</dd>
          </dl>
        </section>

        <section className="board-panel help-card">
          <h2>Etapele unui lead</h2>
          <dl className="help-terms">
            <dt><span className="payment-chip soon">De contactat</span></dt><dd>L-ai preluat, urmează să-l suni.</dd>
            <dt><span className="payment-chip open">Contactat</span></dt><dd>Ați vorbit; discuția continuă.</dd>
            <dt><span className="payment-chip offer">Ofertă trimisă</span></dt><dd>Ai trimis oferta. BoldHub îți amintește după {offerDays} zile dacă nu s-a închis;
              poți amâna cu +3, +7 sau +14 zile.</dd>
            <dt><span className="payment-chip paid">Câștigat</span></dt><dd>Completezi datele firmei (CUI-ul se caută la ANAF) și lead-ul devine <strong>clientul tău</strong>, în <Link href="/account">Clienți</Link>.</dd>
            <dt><span className="payment-chip overdue">Pierdut</span></dt><dd>Alegi motivul: preț, nu răspunde, nu e potrivit, a ales alt furnizor sau altul. Un lead pierdut se poate redeschide.</dd>
          </dl>
          <p className="muted">Doar agentul care a preluat lead-ul îl poate muta între etape. Dacă nu-l mai poți lucra, apasă <strong>Eliberează lead-ul</strong>{" "}
            și se întoarce în Noi, pentru alt coleg.</p>
        </section>

        <section className="board-panel help-card">
          <h2>Alerte</h2>
          <ul className="help-list">
            {unclaimed > 0 && <li>Un lead nou <strong>nepreluat în {unclaimed} {unclaimed === 1 ? "oră" : "ore"}</strong>: primiți toți o notificare.</li>}
            {uncontacted > 0 && <li>Un lead preluat, dar <strong>necontactat în {uncontacted} de ore</strong>: primești tu o notificare.</li>}
            <li>O ofertă fără răspuns după <strong>{offerDays} zile</strong>: primești tu o notificare.</li>
          </ul>
          <p className="muted">Alertele vin o singură dată pe lead, între 08:00 și 20:00. Pornește notificările în browser (clopoțelul din dreapta sus) ca să le primești și când BoldHub nu e deschis.</p>
        </section>

        <section className="board-panel help-card">
          <h2>Lead-urile de dinainte</h2>
          <p>Lead-urile primite înainte de BoldHub sunt deja în listă. Dacă ai lucrat deja cu unul, <strong>preia-l</strong> și mută-l pe etapa la care ai rămas,
            cu o notiță despre ce s-a discutat.</p>
        </section>
      </div>
    </AppShell>
  );
}
