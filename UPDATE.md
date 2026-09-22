# BoldHub — actualizare stadiu implementare

Rezumat al lucrului din această iterație (sesiune Codex), verificat înainte de deschiderea PR-ului: `npm test` (8/8), `npm run typecheck` și `npm run build` trec toate curat pe acest cod.

## Ce s-a făcut

### Board comenzi online — pivot temporar pe SKU
- Confirmarea la picking s-a mutat temporar de pe EAN pe **SKU**, ca să existe un flux cap-coadă testabil înainte ca EAN-urile din BOCP să fie complete. Coloana `ean` a devenit opțională; s-au adăugat `scan_code` / `scan_code_type` (`sku` | `ean`) pe `online_order_items`, iar RPC-ul `scan_online_order_item` a fost înlocuit cu `scan_online_order_code`.
- UI-ul de picking ([app/orders/order-board.tsx](app/orders/order-board.tsx)) afișează explicit modul curent ("Confirmare după SKU" vs. "Scanare EAN") ca operatorii să nu confunde confirmarea temporară cu scanarea fizică reală.
- Migrații: [`20260922214737_sku_scan_mode.sql`](supabase/migrations/20260922214737_sku_scan_mode.sql), hardening suplimentar de autorizare în [`20260922215359_harden_sku_rpc_auth.sql`](supabase/migrations/20260922215359_harden_sku_rpc_auth.sql) (RPC-urile interne nu mai sunt apelabile direct, doar prin wrapper-ele publice cu verificare de rol).

### Import BOCP → Supabase (manual, blocat până la 1 octombrie 2026)
- [lib/bocp/feeds.ts](lib/bocp/feeds.ts) + [lib/bocp/preview.ts](lib/bocp/preview.ts): citesc Orders + Invoices din BOCP (paginat, cu plafon de siguranță de 8 pagini/feed), corelează comanda cu factura și clasifică fiecare linie (eligibilă pe SKU / fără SKU / cantitate invalidă / serviciu / neclasificată). Lipsa EAN e acum doar diagnostic, nu blochează.
- RPC atomic [`import_bocp_online_orders`](supabase/migrations/20260922214800_bocp_import_rpc.sql): creează comenzi + produse (upsert pe SKU) în loturi de maximum 25 facturi, idempotent pe `invoice_number`, blocat explicit înainte de 1 octombrie 2026.
- Rută admin [app/api/admin/bocp/import/route.ts](app/api/admin/bocp/import/route.ts) + buton "Importă comenzile" în [/admin/integrations](app/admin/integrations/preview-panel.tsx) — doar administratorul autentificat poate declanșa, verificare same-origin, refuză înainte de data de lansare.
- **Testat cu date sintetice, într-o tranzacție anulată** (traseu complet import → preluare → confirmare → predare); nicio comandă de test nu a rămas în baza reală.

### Job automat de import (pregătit, dezactivat)
- [app/api/cron/bocp-import/route.ts](app/api/cron/bocp-import/route.ts): rută server-side separată, protejată prin `Authorization: Bearer CRON_SECRET`, activă doar dacă `BOCP_AUTO_IMPORT_ENABLED=true` și doar după 1 octombrie 2026. Reia ultimele 7 zile de facturi la fiecare rulare, ca să recupereze întreruperi scurte.
- Migrația [`20260922220856_bocp_scheduled_import.sql`](supabase/migrations/20260922220856_bocp_scheduled_import.sql) (acces `service_role` la RPC-ul de import) **este scrisă dar NU e aplicată pe baza live**.
- **Nimic din acest job nu rulează încă** — nu există job programat (Vercel Cron sau altul), `BOCP_AUTO_IMPORT_ENABLED` rămâne `false`, iar problema IP-ului fix de ieșire (whitelist BOCP) e nerezolvată.

### Administrare revânzători (configurare, nu flux operațional)
- Pagină nouă [/admin/resellers](app/admin/resellers/page.tsx): firme (`reseller_companies`), Delivery Groups, adăugare locație/revânzător, asociere în grupuri, setare stoc inițial (par level) per SKU.
- Nu creează conturi Auth pentru revânzători, nu generează coșuri și nu declanșează nimic din fluxul de refill descris în documentul de proiect — e doar ecranul de configurare de bază.

### Conturi noi
- `admin@atelierrebul.ro` → owner, `marketing@chicchic.ro` → operator_facturare, `contact@atelierrebul.ro` → operator_depozit, adăugate în Supabase Auth și legate de `app_users`. **Doar contul operator_depozit are un ecran funcțional** (board-ul de comenzi); owner și operator_facturare nu au încă nicio pagină dedicată.

## Ce a rămas neimplementat (față de `proiect-aplicatie-depozit-atelier-rebul.md`)

În ordinea de impact recomandată în conversație:

1. **Punerea în funcțiune reală a sincronizării BOCP** — alegerea hostingului cu IP de ieșire fix, whitelisting la BOCP, aplicarea migrației de scheduled import, programarea jobului și un test end-to-end după 1 octombrie (factură nouă → import fără dubluri → board → confirmare → predare, plus recuperare după întrerupere).
2. **Revenirea de la SKU la EAN** — completarea EAN-urilor lipsă în catalogul BOCP (8 produse identificate în audit la ultima verificare), apoi comutarea per-articol `scan_code_type` de la `sku` la `ean` și testare pe scannerele Zebra TC26 / DataWedge. Momentan confirmarea e explicit temporară.
3. **Flux 1 — Refill revânzători/horeca**, dincolo de ecranul de configurare admin: conturi + acces pentru revânzători, coșuri persistente, cereri din aplicație și automatizare WhatsApp, rezervare stoc, cele 3 triggere de livrare (manual / client important / countdown 48h), fluxul invers spre facturare.
4. **Retururi** — căutare comandă, înregistrare de către operator_facturare, verificare fizică, revenire în stoc, notificare + raport agregat pentru admin. Tabelul `order_returns` există, dar fără UI.
5. **Ecrane pentru `operator_facturare` și `owner`** — niciunul nu are pagină funcțională momentan; owner ar trebui să capete dashboard read-only (KPI-uri din secțiunea 8), facturare ar trebui să capete emitere factură + retururi.
6. **Notificări** (in-app, email, browser, WhatsApp) — doar tabelul `notifications` există, fără nicio integrare.
7. **Verificarea zilnică AWB Ecolet/Shopify** (secțiunea 9 din document) — neînceput.
8. **Ecran "comenzi greșite"** — căutare manuală după nume/email/telefon/nr. comandă pentru admin/operatori (nu tracking automat, doar investigare la cerere).

## De reținut / riscuri deschise semnalate în timpul lucrului

- Cheia API BOCP dedicată (#2) e restricționată doar pe IP-ul curent de birou, **nu și pe metodă** — interfața BOCP nu permite limitarea la `[GET]` din ecranul folosit; suportul BOCP ar trebui contactat pentru a limita cheia strict la `marketplace[GET],invoices[GET]` (+ celelalte module marcate pentru viitor). Codul aplicației face doar `GET`, dar cheia însăși permite azi mai mult.
- IP-ul de ieșire al găzduirii (Vercel implicit e dinamic) trebuie rezolvat înainte de orice sincronizare automată — opțiune candidată: Vercel Static IP (plan superior) sau un gateway dedicat.
- Cele două documente interne (`proiect-aplicatie-depozit-atelier-rebul.md`, `schema-baza-de-date-depozit.md`) rămân **doar locale**, neincluse în acest PR, conform deciziei explicite de a nu publica detalii interne de discovery/BOCP într-un repository public.
