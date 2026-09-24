# BoldHub — stadiul implementării

Ultima actualizare: **25 septembrie 2026**. Referința funcțională este documentul intern `proiect-aplicatie-depozit-atelier-rebul.md` (păstrat doar local).

## Pe scurt

Toate fluxurile din document sunt implementate cap-coadă pentru toate rolurile:
- comenzi online: board, preluare, scanare SKU/EAN, predare;
- parteneri B2B (revânzători, HoReCa, altul): coș, pregătire pe raftul rezervat, grupuri de livrare, clienți prioritari, predare la facturare;
- retururi;
- dashboard pentru owner;
- notificări in-app și în browser;
- căutarea comenzilor greșite;
- trecerea de la SKU la EAN.

Ce lipsește depinde de acces extern: IP fix pentru BOCP, contul WhatsApp Business, furnizorul de email, tokenul Shopify pentru verificarea AWB și testul pe dispozitivele Zebra. Detalii în [Ce rămâne](#ce-rămâne).

**Verificat:**
- `npm test` (14/14), `npm run typecheck` și `npm run build` trec;
- testul de flow per rol [`supabase/tests/role_flows.sql`](supabase/tests/role_flows.sql) trece complet: **73/73** (admin 11, depozit 33, facturare 13, partener 8, owner 8), rulat pe 24.09 după redenumirea în „partners”;
- fiecare migrație a fost rulată întâi cu date sintetice într-o tranzacție anulată, apoi aplicată pe baza live;
- ecranele au fost încărcate cu contul de admin.

**Starea bazei live:** 523 de produse sincronizate din BOCP, dintre care 231 au EAN. Nu există încă nicio comandă reală sau retur. Există date de test pentru parteneri (tot ce începe cu „TEST”), de șters înainte de producție. Importul comenzilor este blocat până la 1 octombrie 2026.

## Acoperire față de documentul de proiect

| Secțiune | Stare | Unde |
|---|---|---|
| §2 Roluri | ✅ admin, owner, operator_depozit, operator_facturare, revânzător (rolul `account` e nedecis) | [lib/auth.ts](lib/auth.ts), [components/app-shell.tsx](components/app-shell.tsx) |
| §3.1 Stoc inițial per revânzător/produs | ✅ | `/admin/partners` |
| §3.2 Cerere refill din aplicație, calcul automat al necesarului | ✅ | `/partner` |
| §3.3 Automatizare WhatsApp | ⏳ cererile se introduc manual cu „+ Adaugă cerere” în `/partners` (sursa WhatsApp/telefon este păstrată) | — |
| §3.4 Rezervare stoc | ✅ `quantity_reserved`, eliberat la predarea la facturare | `/partners` (tab Produse) |
| §3.5 Grupuri de livrare + clienți prioritari | ✅ decizie manuală pe grup; clientul prioritar = livrare imediată; timer 48h doar afișat (automatizările vechi oprite) | `/partners` |
| §3.6 Flux invers spre facturare | ✅ „Predare - Facturare” notifică facturarea per partener, cu produsele · ecranul de facturare pentru coșurile predate ⏳ (de discutat) | `/partners`, `/billing` |
| §3.7 Cont revânzător: istoric | ✅ · „comandă din nou” / „frecvent comandate” ⏳ | `/partner` |
| §4 Board comenzi online, preluare exclusivă, eliberare, predare | ✅ | `/orders` |
| §4.3 Comenzi greșite (căutare la cerere) | ✅ | `/orders/handed` (căutare integrată) |
| §5 Retururi (înregistrare, verificare fizică, notificare, raport lunar, marcare Shopify) | ✅ | `/returns` |
| §6 Scanare EAN (verde/roșu, progres, buton blocat) | ✅ per produs, după activare · test Zebra ⏳ · „Add to Home Screen” ⏳ | `/orders`, `/admin/catalog` |
| §7 Notificări in-app + browser | ✅ · email / WhatsApp ⏳ | `/notifications`, clopoțelul din bara de sus |
| §8 Dashboard owner | ✅ toți indicatorii sugerați | `/dashboard` |
| §9 Verificare zilnică AWB Ecolet/Shopify | ⏳ lipsesc tokenul și răspunsurile la întrebări | — |
| §10 BOCP: import facturi, catalog, EAN, stoc | ✅ manual · sincronizare automată ⏳ (IP fix) | `/admin/integrations`, `/admin/catalog` |

## Ecrane pe rol

| Rol | Ecran la login | Acces |
|---|---|---|
| admin | `/orders` | tot, plus Revânzători, Catalog & EAN, Integrări |
| operator_depozit (`contact@atelierrebul.ro`) | `/orders` | Comenzi online, Parteneri B2B, Căutare comenzi, Retururi (verificare fizică), Predate curierului, Notificări |
| operator_facturare (`marketing@chicchic.ro`) | `/returns` | Retururi (înregistrare), Facturare refill, Căutare comenzi, Notificări |
| owner (`admin@atelierrebul.ro`) | `/dashboard` | doar dashboard (cifre agregate, fără date de client) |
| revânzător | `/partner` | cererea proprie de refill, coșul, livrările, istoricul |

Contul de admin este `atelierrebulromania@gmail.com`. Conturile de revânzător se creează în Supabase → Authentication → Users (Invite user), apoi se asociază locației din `/admin/partners`.

## Migrații

Toate sunt aplicate pe proiectul BoldHub, cu excepția celei marcate.

| Migrație | Conținut |
|---|---|
| `20260922195906` … `20260922215359` | schema inițială, RLS, fluxul comenzilor online, confirmarea după SKU, importul BOCP (iterația 1) |
| `20260922220856_bocp_scheduled_import` | **neaplicată intenționat**: acces `service_role` pentru jobul automat de import |
| [`20260923120839_billing_returns_dashboard`](supabase/migrations/20260923120839_billing_returns_dashboard.sql) | retururi (un retur per comandă, scrierea directă închisă), căutare comenzi, facturare refill, agregat pentru dashboard |
| [`20260923122608_refill_flow_notifications`](supabase/migrations/20260923122608_refill_flow_notifications.sql) | coșuri, rezervare, cele 3 triggere, flux invers, conturi revânzător, notificări + Realtime, job pg_cron |
| [`20260923123114_ean_scan_mode`](supabase/migrations/20260923123114_ean_scan_mode.sql) | `products.scan_mode` per produs; trigger care preia EAN-ul din factură și aplică modul EAN |
| [`20260923124056_bocp_catalog_sync`](supabase/migrations/20260923124056_bocp_catalog_sync.sql) | sincronizare catalog BOCP: produse, EAN, stoc |
| `20260923202935_staff_names`, `20260923211131_order_ready_at` | numele operatorilor pe board; ora „pregătită” la comenzile online |
| `20260923213224_partner_type` … `20260923214059_rename_notification_partner_column` | **resellers → partners peste tot** (tabele, coloane, funcții, politici); `partners.type` = reseller / horeca / altul |
| `20260923215555_partner_cart_prepared` … `20260923222635_billing_notification_products` | coș „prepared”, „Predare - Facturare” cu notificare per partener, grupuri de livrare editabile din depozit |
| `20260923224254_stop_refill_automations` | oprește jobul pg_cron de 48h și propunerea automată pentru clientul important; notificare „Client prioritar — livrare imediată” |
| `20260924195608_realtime_order_returns`, `20260924200952_staff_names_for_billing` | Realtime pe retururi (contoarele din meniu); facturarea vede numele operatorilor |
| `20260924200509_notify_billing_on_shelf_reservation` | „Produsele rezervate pe raft” anunță facturarea să mute produsele în gestiunea „Rezervat” din BOCP |
| `20260924201726_return_restock_note` … `20260924202910_shopify_return_mark_admin_only` | retur procesat cu notă / „cu mențiuni” (notifică facturarea); marcarea în Shopify doar de admin |
| `20260924205049_username_accounts` | `app_users.username`, `notification_email`; `partners.account_username` |
| `20260924211227_online_import_fixes` | ora reală a facturii, produse „Cadou”, numele din catalog nu mai sunt suprascrise, bifă pentru produsele fără EAN |

Toate scrierile trec prin RPC-uri cu verificare de rol. Tabelele au RLS doar pentru citire, pe rol.

## Iterațiile 2–4 (23 septembrie 2026)

### Retururi, facturare, căutare, dashboard
- **`/returns`**: facturarea caută comanda (după factură, comandă, nume, email sau telefon) și înregistrează returul, doar pentru comenzile predate. La înregistrare se trimit notificări pentru admin și depozit. Depozitul confirmă verificarea fizică, iar adminul vede raportul lunar pe motive, cu rata de retur. Stocul real se actualizează în BOCP.
- **`/billing`**: livrările refill confirmate de depozit primesc numărul facturii emise în BOCP. Depozitul este apoi notificat că livrarea poate pleca.
- **Căutare în `/orders/handed`**: investigarea comenzilor greșite arată cine a pregătit comanda și ce conținea. Nu există urmărire automată a erorilor.
- **`/dashboard`**: intervalele sunt azi / 7 zile / 30 zile / luna curentă / personalizat, calculate în ora României ([lib/dashboard-range.ts](lib/dashboard-range.ts), cu teste). Indicatori:
  - comenzi noi și predate;
  - timp mediu de pregătire și timp de la import la predare;
  - volum per operator;
  - retururi și rata de retur;
  - coșuri și livrări refill;
  - stoc rezervat față de BOCP și discrepanțe;
  - grafic zilnic, cu vedere de tabel.
- **Navigație comună pe roluri**, iar la login fiecare rol ajunge direct pe ecranul lui.

### Flux refill complet
- **`/refill`** (depozit + admin):
  - livrări în lucru: confirmare pregătire, scoatere coș, anulare, predare posibilă doar după factură;
  - coșuri deschise grupate pe traseu, cu contor 48h;
  - introducere manuală a cererilor venite pe WhatsApp sau telefon;
  - stocul rezervat, actualizat în timp real.
- **`/partner`** (mobil): revânzătorul scrie câte bucăți mai are pe raft. Necesarul se calculează ca stocul inițial minus ce a rămas, minus ce e deja în coș sau pe drum, deci nu apar comenzi duble. Vede și coșul (poate scoate produse), livrările și istoricul.
- **Client important**: la cerere se propune automat livrarea, împreună cu coșurile din același Delivery Group, cu confirmarea operatorului.
- **Countdown 48h**: coșurile vechi de 48h devin automat propuneri de livrare, cu alertă. Rulează la 15 minute prin pg_cron, chiar dacă nimeni nu are aplicația deschisă.

### Notificări
- Clopoțel cu numărul de necitite, actualizat în timp real, și pagina `/notifications`. Notificările în browser se activează per dispozitiv. Notificările trimise unui rol sunt comune echipei: marcată ca citită de un operator, dispare pentru toți.
- Evenimente: refill nou, client important, countdown 48h, livrare de facturat, factură emisă, retur înregistrat, retur de verificat.

### EAN: „Cod bare” din BOCP (verificat pe date reale)
- În BOCP, EAN-ul de pe etichetă este în **„Cod bare”**. Câmpul „Cod EAN” e gol peste tot și nu se folosește.
- În API, „Cod bare” apare în două locuri:
  - `custom_barcode` în catalog (`/product/list/`), unde `barcode` conține codul intern, de ex. `1-ATEL`;
  - `barcode` pe liniile de factură.
- **Catalog BOCP (23.09):** 523 de produse active; 233 au EAN valid, 290 au „Cod bare” gol. Un singur EAN e duplicat: `8691226652214`, la AT03317 și AT03672.
- **Comparația cu Shopify:** dintre cele 290 fără EAN, 262 nu există în Shopify, iar 28 nu au barcode nici acolo, deci Shopify nu are nimic de completat. Tot în Shopify, **AT02308** are același barcode ca **AT02512**.
- **`/admin/catalog`:**
  - butonul „Sincronizează din BOCP” ([lib/bocp/catalog.ts](lib/bocp/catalog.ts)) creează produsele după SKU, completează EAN-ul și aduce stocul global. Nu șterge niciodată un EAN, iar dacă răspunsul BOCP e incomplet nu aplică nimic. Rulat pe 23.09.
  - EAN-ul se poate completa manual, cu filtrele „fără EAN” / „încă pe SKU”;
  - trecerea pe EAN se face per produs sau pentru toate produsele care au EAN. Schimbarea afectează doar comenzile nepreluate.

## Iterația 5 (24 septembrie 2026)

### Comenzi online
- **Board:** cele 4 carduri de status sunt filtrele board-ului; „În pregătire” e unit cu „Preluate” (progresul scanării apare pe card); coloana „Predate” s-a mutat în **`/orders/handed`** (meniu → Istoric → Predate curierului), cu filtre de perioadă, coloană AWB („—” până la Cargus) și detalii doar pentru citire, inclusiv ora „Pregătită”.
- **Operatori:** pe card apare numele celui care a preluat comanda; comenzile altui operator se văd, dar nu se pot deschide.
- **Scanare:** EAN-ul așteptat nu mai ajunge în browser (sub produs apare SKU-ul), ca să nu poată fi tastat în loc de scanat. Blocul se numește „Scanare etichetă”; butonul de factură (cu iconiță de download) e sub el.
- **Scanner:** Winson WNI-6380g funcționează pe Windows (tastează codul + Enter). Pe Mac nu scrie nimic; nu e o țintă.

### Parteneri B2B (`/partners`, înlocuiește „Refill revânzători”, care a fost șters)
- **Tab Parteneri:** board cu „Necesită produse” / „Pregătite de livrare” (sus) și „Complete” (pe toată lățimea); filtre de tip, căutare, timer live de la cerere, semnal de refill, clienți prioritari primii (chip „⚡ Prioritar”, margine roșie).
- **Detalii partener:** produse pe raft (estimat / inițial), coș, coș pregătit, contact; butoanele **„Produsele sunt pe raft · gata de livrare”** (coș → `prepared`, fără facturare) și **„Predare - Facturare”** (coș livrat, stoc eliberat, notificare la facturare cu produsele). Panoul se închide după succes.
- **„+ Adaugă cerere”:** partener, produse (din stocul inițial sau din catalog), cantități, sursă WhatsApp/telefon → coșul deschis, stoc rezervat.
- **Tab Grupuri de livrare:** creare/editare/ștergere de către admin și depozit (un partener poate fi în mai multe grupuri), carduri cu progres, grupurile cu client prioritar primele, **„Predare - Facturare” în bloc** pentru toți pregătiții din grup (câte o notificare per partener).
- **Tab Produse:** totaluri pe produs „De pregătit” (cu stocul BOCP, roșu dacă nu ajunge) și „Pe raft · pregătite de livrare”.

## Iterația 6 (24–25 septembrie 2026)

- **Shell:** bara de notificări din dreapta, deschisă/închisă din clopoțel („Toate notificările” duce la `/notifications`); meniul utilizatorului jos în stânga; cercuri cu numărul de lucru în timp real la „Comenzi online” (noi, nepreluate), „Comenzi B2B” (necesită produse) și „Retururi” (de procesat).
- **Comenzi B2B** (fost „Parteneri B2B”): butonul devine **„Produsele rezervate pe raft”** și anunță facturarea să mute produsele din stocul global în gestiunea „Rezervat” din BOCP. „Predare - Facturare” rămâne ca înainte (facturarea ia stocul din „Rezervat”).
- **Căutare comenzi:** scoasă din meniu, integrată în **Predate curierului** (caută în toate comenzile predate, inclusiv returnate). Facturarea are acces la ecran.
- **Retururi:** două tab-uri, ca la Comenzi B2B. **De procesat**: carduri, detalii în panou, notă, „Confirm procesarea” (nota e opțională) și „Procesat cu mențiuni” (notă obligatorie, notifică facturarea); adminul are și „De marcat în Shopify”. **Istoric**: tabel cu perioade, filtru rezultat, căutare, detalii cu mențiunea; raportul lunar (admin).
- **Conturi cu username și parolă:** ecran **Administrare → Utilizatori** (nume, username, parolă min. 6, email opțional pentru notificări, rol; editare, schimbare parolă, dezactivare). Conturile partenerilor se creează la fel din `/admin/partners`. Login: username; cine scrie un email (cu @) intră ca înainte. Necesită `SUPABASE_SERVICE_ROLE_KEY` pe server. **Conturile existente se mută pe username la predarea aplicației.**
- **Primul import real BOCP** (11 comenzi, apoi șterse): ora reală a facturii, 24h peste tot; numele produselor curățate; produsele gratuite din ofertă (produs + „Discount …” egal) primesc eticheta „Cadou”; produsele fără EAN se bifează în loc să fie scanate.
- **Adresa de livrare:** BOCP nu dă strada în câmpurile de adresă; adresa completă e în XML-ul e-Factura (adresa de facturare) sau în Shopify. De decis sursa pentru AWB Cargus (de verificat cum o ia eColet).

## Ce rămâne

**Depinde de acces sau decizii externe:**
1. **Sincronizarea automată BOCP** (comenzi + catalog/stoc): IP fix de ieșire pentru hosting (de ex. Vercel Static IP sau un gateway), apoi aplicarea migrației `20260922220856`, setarea `CRON_SECRET` / `SUPABASE_SECRET_KEY` pe server și programarea jobului. Test cap-coadă după 1 octombrie.
2. **Bot WhatsApp** (§3.3): cont Meta WhatsApp Business Cloud API și modelul AI pentru citirea etichetelor. La pornire se adaugă și coada de verificare `flagged_for_review` pentru operatori.
3. **Notificări pe email:** prin Resend (cont existent), la final; emailul de notificare se salvează deja pe utilizator.
4. **Verificarea AWB Ecolet/Shopify** (§9): token Shopify Admin API (custom app) și răspunsuri la cele 6 întrebări deschise.
5. **Scanare EAN în producție:** completarea „Cod bare” în BOCP pentru produsele care se scanează, corectarea duplicatelor, test pe Zebra TC26/DataWedge, apoi „Activează EAN”. Mai trebuie decis dacă un dispozitiv e al unei persoane sau comun.
6. **AWB în „Predate curierului”** (`/orders/handed`): așteptăm răspunsul Cargus despre un API REST, ca să aducem AWB-ul direct de la ei. Are legătură cu verificarea AWB de la punctul 4.
7. **Suport BOCP:** ce face ruta `delegatedresellerorderfeedback` (§10.5) și limitarea cheii API doar la `GET`.

**De discutat cu utilizatorul:**
- **Facturare pentru coșurile partenerilor:** ce face facturarea după notificarea „Predare spre facturare” (număr factură? marcare ca terminat?). `/billing` arată încă doar livrările din vechiul flux; funcțiile vechi de livrare rămân până atunci.
- Rolul **`account`**: să poată crea grupuri de livrare, ca depozitul.

**Se poate face fără input extern:**
- aplicație instalabilă pe telefon („Add to Home Screen”, pe tot ecranul) pentru Zebra și parteneri;
- „Comandă din nou” și „produse comandate frecvent” pentru parteneri (§3.7);
- câmpul „Tip partener” (reseller / horeca / altul) în formularul din `/admin/partners` (acum se setează doar din baza de date);
- notificarea „comandă nouă” pentru depozit la import;
- alegerea „șofer propriu” / „curier extern” la predare (coloana există, dar nu se completează).

## De reținut / riscuri

- Cheia API BOCP e restricționată pe IP, **nu și pe metodă**. Codul face doar `GET`, dar cheia permite mai mult; trebuie limitată prin suportul BOCP.
- Sincronizarea din `/admin/catalog` și importul merg doar de pe IP-ul din whitelist-ul BOCP (acum, local la birou).
- Documentele interne (`proiect-aplicatie-depozit-atelier-rebul.md`, `schema-baza-de-date-depozit.md`) rămân **doar locale** și nu intră în repository.
- `admin@atelierrebul.ro` are rolul **owner**, iar adminul este `atelierrebulromania@gmail.com`. Rolurile trebuie confirmate.

## Istoric: iterația 1 (sesiune Codex, 22 septembrie 2026)

- **Board comenzi online** cu confirmare temporară după **SKU** (`scan_code` / `scan_code_type` pe `online_order_items`), ca să existe un flux testabil înainte ca EAN-urile să fie complete. Interfața afișează explicit modul curent.
- **Import BOCP → Supabase:**
  - [lib/bocp/feeds.ts](lib/bocp/feeds.ts) + [lib/bocp/preview.ts](lib/bocp/preview.ts) citesc Orders + Invoices, corelează comanda cu factura și clasifică liniile;
  - RPC-ul atomic `import_bocp_online_orders` lucrează în loturi de maximum 25 și e idempotent pe numărul facturii;
  - butonul de import din `/admin/integrations` e blocat până la 1 octombrie 2026.
- **Job automat de import** ([app/api/cron/bocp-import/route.ts](app/api/cron/bocp-import/route.ts)): pregătit, dar dezactivat (`BOCP_AUTO_IMPORT_ENABLED=false`, fără programare).
- **`/admin/partners`:** firme, Delivery Groups, locații, stoc inițial per SKU.
- **Conturi Supabase Auth** legate de `app_users` pentru owner, facturare și depozit.
