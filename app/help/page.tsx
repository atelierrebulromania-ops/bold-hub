import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const contents = [
  { id: "start", label: "Primii pași" },
  { id: "dashboard", label: "Dashboard" },
  { id: "lead", label: "Lead" },
  { id: "clienti", label: "Clienți" },
  { id: "fisa", label: "Fișa clientului" },
  { id: "comenzi", label: "Comenzi B2B" },
  { id: "flux", label: "Drumul unei comenzi" },
  { id: "oferte", label: "Oferte și proforme" },
  { id: "catalog", label: "Catalog produse" },
  { id: "consignatie", label: "Consignație și custodie" },
  { id: "intrebari", label: "Întrebări frecvente" },
] as const;

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <section id={id} className="board-panel help-card">
      <h2>{title}</h2>
      {intro && <p className="help-intro">{intro}</p>}
      {children}
    </section>
  );
}

// Ajutor: the agents' manual, one section per menu item and what each action does. The alert hours and the offer
// deadline come from Admin → Setări, so the text always matches what the app does.
export default async function HelpPage() {
  const { profile } = await requireRole(["admin", "account"]);
  const { data: settings } = await createAdminClient()?.from("app_settings")
    .select("lead_unclaimed_hours,lead_uncontacted_hours,lead_offer_days").eq("id", 1).maybeSingle() ?? { data: null };
  const unclaimed = settings?.lead_unclaimed_hours ?? 2;
  const uncontacted = settings?.lead_uncontacted_hours ?? 24;
  const offerDays = settings?.lead_offer_days ?? 7;

  return (
    <AppShell profile={profile} active="/help" section="Ajutor" title="Ghidul agentului"
      note={{ title: "Ajutor", text: "Ce face fiecare ecran și fiecare buton din BoldHub. Folosește cuprinsul ca să sari direct la o secțiune." }}>
      <div className="help-layout">
        <nav className="board-panel help-toc" aria-label="Cuprins">
          <p className="help-toc-title">Cuprins</p>
          <ol>{contents.map((item) => <li key={item.id}><a href={`#${item.id}`}>{item.label}</a></li>)}</ol>
        </nav>

        <div className="help-page">
          <Section id="start" title="Primii pași" intro="Contul, parola și notificările.">
            <dl className="help-terms">
              <dt>Logarea</dt><dd>Intri cu utilizatorul primit (ex. ion.popescu) și parola. <strong>Ține-mă minte</strong> e bifat implicit: rămâi logat și după ce închizi browserul. Debifează-l doar pe un calculator folosit și de alții.</dd>
              <dt>Prima logare</dt><dd>Parola primită e temporară. BoldHub îți cere să-ți alegi parola ta (minimum 6 caractere, nu 123456) înainte să intri în aplicație.</dd>
              <dt>Schimbă parola</dt><dd>Oricând, din iconița cu cheie de lângă numele tău, jos în meniul din stânga.</dd>
              <dt>Ieșire</dt><dd>Iconița de lângă cheie te scoate din cont.</dd>
              <dt>Notificări</dt><dd>Clopoțelul din dreapta sus arată lead-urile noi, alertele, cererile clienților și pașii comenzilor. Fiecare are <strong>Deschide</strong> (te duce unde trebuie) și <strong>Citită</strong>. Pornește notificările în browser ca să le primești și când BoldHub nu e deschis.</dd>
              <dt>Pe telefon</dt><dd>Meniul se deschide din butonul cu trei linii, dreapta sus. Toate ecranele merg și pe telefon.</dd>
            </dl>
          </Section>

          <Section id="dashboard" title="Dashboard" intro="Primul ecran după logare: ce ai de făcut azi și cum merge luna.">
            <dl className="help-terms">
              <dt>De făcut acum</dt><dd>Cereri de la clienți nepreluate, oferte care așteaptă răspuns (și cât mai sunt valabile), proforme fără pas următor și facturi depășite. Click pe card te duce la lista respectivă.</dd>
              <dt>Luna aceasta</dt><dd>Cât ai facturat (cu TVA), câte facturi, câte oferte ai emis și câți clienți noi ai adus.</dd>
              <dt>Scadențe</dt><dd>Facturile clienților tăi care se apropie de scadență sau au depășit-o. Sună clientul înainte să ajungă restante.</dd>
              <dt>Clienți inactivi</dt><dd>Clienții care n-au mai comandat de mult. Sunt primii de sunat.</dd>
            </dl>
          </Section>

          <Section id="lead" title="Lead" intro="Potențialii clienți din reclame (Meta), din formularul de pe site sau adăugați de tine.">
            <ol className="help-steps">
              <li><strong>Preia</strong> un lead din tab-ul <Link href="/crm">Noi</Link>. Din acel moment e al tău și colegii văd cine l-a preluat.</li>
              <li><strong>Sună sau scrie</strong> și mută lead-ul pe etapa la care ai ajuns.</li>
              <li><strong>Notează</strong> în Istoric ce ați discutat (+ Adaugă notiță).</li>
              <li><strong>Închide-l</strong>: Câștigat (devine clientul tău) sau Pierdut (cu motiv).</li>
            </ol>
            <h3>Tab-uri</h3>
            <dl className="help-terms">
              <dt>Noi</dt><dd>Lead-uri pe care nu le-a preluat nimeni. Oricine le poate prelua.</dd>
              <dt>În lucru</dt><dd>Lead-uri preluate și deschise. Bifează <strong>Doar ale mele</strong> ca să le vezi doar pe ale tale.</dd>
              <dt>Câștigați / Pierduți / Toate</dt><dd>Lead-urile închise și lista completă. Caută după nume, firmă, telefon, email sau campanie.</dd>
            </dl>
            <h3>Etape</h3>
            <dl className="help-terms">
              <dt><span className="payment-chip soon">De contactat</span></dt><dd>L-ai preluat, urmează să-l suni.</dd>
              <dt><span className="payment-chip open">Contactat</span></dt><dd>Ați vorbit; discuția continuă.</dd>
              <dt><span className="payment-chip offer">Ofertă trimisă</span></dt><dd>BoldHub îți amintește după {offerDays} zile dacă nu s-a închis; poți amâna cu +3, +7 sau +14 zile.</dd>
              <dt><span className="payment-chip paid">Câștigat</span></dt><dd>Completezi datele firmei (CUI-ul se caută la ANAF) și lead-ul devine clientul tău. Din lead ai apoi link direct la fișa clientului.</dd>
              <dt><span className="payment-chip overdue">Pierdut</span></dt><dd>Alegi motivul (preț, nu răspunde, nu e potrivit, alt furnizor, altul). Se poate redeschide.</dd>
            </dl>
            <h3>Butoane</h3>
            <dl className="help-terms">
              <dt>+ Lead nou</dt><dd>Adaugi un lead găsit pe altă cale (recomandare, telefon, târg).</dd>
              <dt>Eliberează lead-ul</dt><dd>Dacă nu-l mai poți lucra: se întoarce în Noi, pentru alt coleg.</dd>
            </dl>
            <h3>Alerte</h3>
            <ul className="help-list">
              {unclaimed > 0 && <li>Lead nou <strong>nepreluat în {unclaimed} {unclaimed === 1 ? "oră" : "ore"}</strong>: primiți toți o notificare.</li>}
              {uncontacted > 0 && <li>Lead preluat, dar <strong>necontactat în {uncontacted} de ore</strong>: primești tu o notificare.</li>}
              <li>Ofertă fără răspuns după <strong>{offerDays} zile</strong>: primești tu o notificare.</li>
            </ul>
            <p className="muted">Alertele vin o singură dată pe lead, între 08:00 și 20:00. Doar agentul care a preluat lead-ul îl poate muta între etape.</p>
          </Section>

          <Section id="clienti" title="Clienți" intro="Lista clienților tăi și a tuturor clienților firmei.">
            <dl className="help-terms">
              <dt>Clienții mei</dt><dd>Clienții de care te ocupi, cu tipul, discountul și unde e ultima lor comandă. Click pe un client deschide fișa lui.</dd>
              <dt>Toți clienții</dt><dd>Toți clienții firmei și agentul fiecăruia, ca să nu suni un client care e deja al unui coleg. Fișa o poți deschide doar la ai tăi.</dd>
              <dt>Caută</dt><dd>După nume sau CUI (la Toți clienții, și după agent).</dd>
              <dt>+ Client nou</dt><dd>Scrii CUI-ul și apeși <strong>Completează din ANAF</strong>: se completează denumirea, Nr. Reg. Com. și adresa. Adaugi numele afișat în aplicație, locația, telefonul și tipul (Revânzător, HoReCa, Altul). După <strong>Adaugă clientul</strong> se deschide fișa lui, ca să continui configurarea.</dd>
            </dl>
          </Section>

          <Section id="fisa" title="Fișa clientului" intro="Tot ce ține de un client, pe tab-uri. Fiecare tab se salvează separat.">
            <p>Sus vezi rezumatul: tipul, unde e comanda curentă, regimul pe revânzare, punctele de lucru, discountul, cât are de plată și contul. Butonul <strong>Cerere nouă</strong> te duce direct la comandă.</p>
            <dl className="help-terms">
              <dt>Date firmă</dt><dd>Datele de facturare (din ANAF) și contactul. Bifa <strong>Client prioritar</strong> face ca depozitul să-i livreze imediat. În dreapta: facturile clientului din BOCP, cu scadența și ce mai are de plată, plus PDF-ul facturii.</dd>
              <dt>Puncte de lucru</dt><dd>Pentru firmele cu mai multe locații. <strong>Centralizat</strong>: un stoc și o comandă pe firmă, livrată la punctul principal. <strong>Pe punct de lucru</strong>: fiecare punct are stocul, comenzile și (dacă vrei) contul lui; factura rămâne una pe CUI. Din <strong>Editează</strong> schimbi adresa, dezactivezi un punct sau îl ștergi (doar dacă n-a avut comenzi).</dd>
              <dt>Discounturi</dt><dd>Procent pe toate produsele și, separat, pe categorii (regula pe categorie are prioritate). Fără termen. Se aplică automat în oferte, proforme și la facturare. Pe Consum poți păstra aceleași discounturi sau pune altele.</dd>
              <dt>Stoc inițial</dt><dd>Ce trebuie să aibă clientul mereu: produsele și cantitățile. Clientul numără ce i-a rămas, iar aplicația comandă diferența. Are două tab-uri:
                <ul className="help-list">
                  <li><strong>Revânzare</strong>: produsele pe care le vinde. Aici alegi <strong>regimul</strong>: Cumpărare (fiecare livrare se facturează) sau Consignație (marfa rămâne a noastră până o vinde; se facturează periodic ce a vândut, cu comisionul lui).</li>
                  <li><strong>Consum</strong>: produsele pe care le folosește el (hotel, salon). Se cumpără mereu, și la clienții în consignație.</li>
                </ul>
                Adaugi produse căutând după nume sau SKU, <strong>+ Din colecție</strong> (toată colecția odată) sau <strong>Propune din facturi BOCP</strong> (ce a mai cumpărat clientul). Salvezi pe rând sau cu <strong>Salvează tot</strong>; 0 scoate produsul.</dd>
              <dt>Custodie</dt><dd>Ce rămâne al nostru la client și nu se facturează: testere, materiale POS (raft, geamuri, clopote) și produse date în probă (implicit 30 de zile, cu alertă cu 3 zile înainte de final). Treci și numărul bonului de custodie din BOCP. În dreapta, <strong>Contracte</strong>: încarci PDF-ul semnat de noi, clientul îl semnează și îl încarcă înapoi din contul lui (statusul devine „semnat de ambele părți”).</dd>
              <dt>Cerere nouă</dt><dd>Când clientul îți cere produse direct (telefon, mesaj, vizită). În dreapta ai stocul inițial: scrii câte bucăți mai are, iar BoldHub calculează <strong>necesarul</strong> (stoc inițial minus ce are minus ce e deja comandat). Cu <strong>Adaugă</strong> sau <strong>Adaugă tot necesarul</strong> trec în cerere; poți adăuga și alte produse. <strong>Trimite cererea la depozit</strong> o face comandă B2B, ca și cum ar fi plasat-o clientul.</dd>
              <dt>Cont în aplicație</dt><dd>Creezi contul clientului (utilizator + parolă temporară, pe care și-o schimbă la prima logare). Din contul lui își vede stocul, face numărătoarea, plasează comenzi, vede facturile, contractele și produsele în custodie. Îl poți <strong>dezactiva</strong> (nu se mai poate conecta, datele rămân) și reactiva oricând.</dd>
            </dl>
          </Section>

          <Section id="comenzi" title="Comenzi B2B" intro="Unde sunt comenzile clienților tăi, de la cerere până la livrare.">
            <dl className="help-terms">
              <dt>Parteneri</dt><dd>Clienții cu comenzi, filtrați după stare: <strong>Necesită produse</strong> (cerere nouă, de pregătit în depozit), <strong>Pregătite de livrare</strong> (pe raft) și <strong>Complete</strong>. Click pe un client: ce a cerut, stocul estimat, restanțele.</dd>
              <dt>Stoc estimat</dt><dd>Stocul inițial minus ce e în coș sau pe drum: cât ar trebui să aibă clientul după livrare.</dd>
              <dt>Adaugă cerere primită</dt><dd>Același lucru ca Cerere nouă din fișa clientului: produse cerute de client în afara aplicației.</dd>
              <dt>Restanțe</dt><dd>Ce depozitul n-a putut livra (lipsă stoc). Pleacă automat la următoarea livrare, când revine stocul. <strong>Anulează</strong> o restanță dacă clientul nu o mai vrea (îți cere motivul).</dd>
              <dt>Grupuri de livrare</dt><dd>Clienți livrați împreună (ex. un traseu), ca depozitul să-i pregătească odată.</dd>
              <dt>Produse</dt><dd>Totalul pe produse din toate cererile, cu stocul din BOCP: vezi dacă avem de unde.</dd>
            </dl>
          </Section>

          <Section id="flux" title="Drumul unei comenzi" intro="De la cerere la factură; clientul vede fiecare pas în contul lui.">
            <ol className="help-steps">
              <li><strong>Cererea</strong>: clientul face numărătoarea în contul lui sau tu adaugi cererea. Comanda apare în Necesită produse.</li>
              <li><strong>Depozitul pregătește</strong> produsele și le pune pe raft. Ce lipsește devine restanță.</li>
              <li><strong>Rezervarea în BOCP</strong>: comanda se trimite automat în BOCP și stocul se rezervă.</li>
              <li><strong>Predarea la facturare</strong>: depozitul o predă când pleacă la client.</li>
              <li><strong>Factura</strong>: facturarea emite factura în BOCP (sau bonul de transfer, la consignație). Clientul o vede în contul lui, iar tu în fișa lui.</li>
            </ol>
          </Section>

          <Section id="oferte" title="Oferte și proforme" intro="Oferte de preț pentru clienți și prospecți, proforme emise în BOCP.">
            <dl className="help-terms">
              <dt>Ofertă</dt><dd>Alegi clientul (sau un prospect nou, cu CUI din ANAF), adaugi produse (căutare sau <strong>Adaugă din colecție</strong>), discount general sau pe produse selectate, valabilitatea în zile și mențiuni. <strong>Salvează ciorna</strong> sau <strong>Emite oferta</strong>; apoi <strong>Descarcă PDF</strong> și o trimiți clientului. Oferta rămâne doar în BoldHub.</dd>
              <dt>Transformă în proformă</dt><dd>Din oferta emisă, cu un click: păstrează produsele și prețurile.</dd>
              <dt>Emite proforma în BOCP</dt><dd>Proforma se emite în BOCP și stocul se rezervă. Descarci PDF-ul proformei din BOCP.</dd>
              <dt>Următorul pas</dt><dd>Pe o proformă emisă alegi: <strong>Rezervă comanda</strong> (merge la depozit: raft, apoi facturare; clientul trebuie să fie client în BoldHub) sau <strong>Cere factura</strong> (facturarea emite factura direct, fără pregătire în depozit).</dd>
              <dt>Anulează proforma</dt><dd>Eliberează stocul; facturarea anulează proforma în BOCP. Poți scrie motivul.</dd>
              <dt>Facturi</dt><dd>Toate facturile clienților tăi, cu scadența și restul de plată.</dd>
            </dl>
          </Section>

          <Section id="catalog" title="Catalog produse" intro="Prețurile și stocul din BOCP, plus colecțiile tale.">
            <dl className="help-terms">
              <dt>Produse</dt><dd>Toate produsele B2B cu preț de listă (fără și cu TVA) și stocul BOCP, actualizat la fiecare 15 minute (ora ultimei actualizări e sus, în dreapta). Caută după nume sau SKU, filtrează pe categorie, ascunde produsele cu stoc 0. „Delistat” înseamnă că produsul nu mai vine de la furnizor.</dd>
              <dt>Prețuri pentru</dt><dd>Alegi un client și vezi prețurile cu discountul lui.</dd>
              <dt>Colecții</dt><dd>Liste de produse pe care le faci tu (ex. „Pachet hotel”, „Raft salon”). Selectezi produse din catalog și le adaugi într-o colecție nouă sau existentă. Le folosești dintr-un click în oferte, proforme și în stocul inițial al clienților. Doar tu le vezi.</dd>
            </dl>
          </Section>

          <Section id="consignatie" title="Consignație și custodie" intro="Două lucruri diferite, ambele rămân ale noastre la client.">
            <dl className="help-terms">
              <dt>Consignație</dt><dd>Doar pentru produsele de revânzare. Marfa pleacă prin bon de transfer în gestiunea CONSIGNAȚIE și rămâne a noastră până o vinde clientul. Facturarea calculează periodic ce s-a vândut (din livrări și numărătorile clientului) și emite factura; comisionul clientului se calculează automat. Consumul propriu se facturează la livrare, chiar dacă revânzarea e în consignație: comanda se împarte automat.</dd>
              <dt>Custodie</dt><dd>Testere, materiale POS și produse în probă: nu se vând și nu se facturează. Se returnează la final; ce lipsește se facturează la valoarea din fișă.</dd>
            </dl>
          </Section>

          <Section id="intrebari" title="Întrebări frecvente">
            <dl className="help-terms">
              <dt>Lead-urile de dinainte?</dt><dd>Sunt deja în listă. Dacă ai lucrat cu unul, preia-l și mută-l pe etapa la care ai rămas, cu o notiță.</dd>
              <dt>Un client nu se poate loga?</dt><dd>Verifică în fișa lui, la Cont în aplicație, dacă e activ. Parola o resetează administratorul.</dd>
              <dt>Stocul din catalog nu se potrivește?</dt><dd>Se actualizează din BOCP la 15 minute; uită-te la ora din dreapta sus a catalogului.</dd>
              <dt>Am greșit o cerere?</dt><dd>Cât e în Necesită produse, anunță depozitul. Restanțele le poți anula tu din Comenzi B2B.</dd>
              <dt>Cine vede ce?</dt><dd>Tu vezi complet doar clienții tăi; ceilalți apar doar în lista Toți clienții, cu agentul lor. Lead-urile le văd toți agenții.</dd>
            </dl>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
