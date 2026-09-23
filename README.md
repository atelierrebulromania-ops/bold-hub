# BoldHub · Atelier Rebul

Aplicație internă pentru operațiunile de depozit. Specificația funcțională este în `proiect-aplicatie-depozit-atelier-rebul.md`, iar schema de referință în `schema-baza-de-date-depozit.md`.

## Stadiul actual

- Next.js App Router, TypeScript și Tailwind CSS.
- Supabase Auth cu sesiune în cookie-uri și acces pe roluri.
- Schema celor 18 tabele din document, cu RLS activat pe toate și migrații SQL versionate.
- Primul flux funcțional: board de comenzi online, preluare exclusivă, eliberare, confirmare temporară după SKU cu progres și predare curierului/șoferului. EAN-ul rămâne în schemă pentru activarea ulterioară a scanării fizice.
- Actualizare prin Supabase Realtime, cu reîmprospătare periodică de rezervă.
- Pagină de administrare `/admin/integrations` cu audit BOCP doar prin `GET`, pe Orders și Invoices. SKU-ul decide eligibilitatea; lipsa EAN-ului este afișată separat ca diagnostic pentru etapa de scanare fizică. Auditul nu salvează datele primite.
- Retururi (`/returns`), facturare refill (`/billing`), căutare comenzi greșite (`/orders/search`) și dashboard read-only pentru owner (`/dashboard`), toate prin RPC-uri cu verificare de rol. Detalii în `UPDATE.md`.
- Pagină de administrare `/admin/partners` pentru firme, locații, Delivery Groups și par levels per SKU. Formularele verifică rolul admin și respectă RLS. Nu creează conturi Auth pentru revânzători și nu importă produse fictive.

Contul administratorului există, dar catalogul și comenzile nu sunt importate încă, așa că board-ul este gol. Importul manual al facturilor online din 1 octombrie 2026 este implementat, dar blocat până la acea dată. Până atunci, fluxul este verificat cu date sintetice într-o tranzacție anulată. Confirmarea după SKU este doar o etapă internă: nu echivalează cu scanarea fizică a EAN-ului. Fluxul de refill (coșuri, rezervare, cele 3 triggere, facturare, predare), contul de revânzător, notificările in-app/browser și trecerea SKU → EAN sunt implementate; botul WhatsApp, emailul, verificarea AWB și stocul BOCP live depind de acces extern (vezi `UPDATE.md`).

## Pornire locală

1. Instalează dependențele: `npm ci`.
2. Copiază `.env.example` în `.env.local` și setează URL-ul și cheia *publishable* ale proiectului Supabase BoldHub. În acest workspace, `.env.local` este deja configurat și ignorat de Git.
3. Rulează `npm run dev` și deschide `http://localhost:3000`.

Verificare: `npm test`, `npm run typecheck` și `npm run build`. Fluxurile per rol (admin, depozit, facturare, revânzător, owner) se verifică cu [`supabase/tests/role_flows.sql`](supabase/tests/role_flows.sql), rulat în SQL Editor-ul Supabase. Rularea e sigură și pe baza live: totul se anulează la final, iar rezultatul apare ca mesaj de eroare, de forma `ROLE FLOWS: 74/74 passed`. Build-ul folosește Webpack, deoarece Turbopack nu poate deschide procesele interne necesare în acest mediu.

## Primul administrator

1. În Supabase Dashboard → **Authentication → Users**, invită adresa care va fi administrator. Persoana invitată își stabilește singură parola.
2. După ce utilizatorul apare în `auth.users`, asociază-l cu rolul intern din SQL Editor, înlocuind valorile dintre paranteze:

```sql
insert into public.app_users (id, full_name, role)
select id, '<nume>', 'admin'::public.user_role
from auth.users
where email = '<email-administrator>'
on conflict (id) do update
  set full_name = excluded.full_name, role = excluded.role, active = true;
```

Ecranul de login folosește email și parolă. Nu există înregistrare publică sau atribuire automată de rol admin.

## Bază de date și deploy

Migrațiile operaționale până la `20260922215359_harden_sku_rpc_auth.sql`, plus `20260923120839_billing_returns_dashboard.sql`, `20260923122608_refill_flow_notifications.sql` și `20260923123114_ean_scan_mode.sql`, au fost aplicate proiectului BoldHub. Migrația `20260922220856_bocp_scheduled_import.sql` este pregătită, dar **nu este aplicată** până la decizia de activare a jobului. Nu se reaplică manual migrațiile existente. Proiectul local este conectat prin URL și cheia publishable; autentificarea CLI Supabase este separată și trebuie legată de contul corect înainte de comenzile `supabase db`.

Pentru Vercel, setează `NEXT_PUBLIC_SUPABASE_URL` și `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ca variabile de mediu. Nicio cheie `service_role` / `secret` nu intră în client sau în Git.

Integrarea BOCP are nevoie de un IP de ieșire stabil pentru hosting, trecut în whitelist-ul BOCP. Structura reală a răspunsurilor `/marketplace/orders/list/` și `/invoices/list/` a fost verificată pe date reale. Importul este manual, numai pentru administrator, și devine activ la data lansării; un job automat nu este încă configurat.

Ruta server-side `/api/cron/bocp-import` este pregătită pentru un job programat, dar **nu este programată și este dezactivată implicit**. Ea cere `Authorization: Bearer <CRON_SECRET>`, `BOCP_AUTO_IMPORT_ENABLED=true` și o cheie Supabase **secret** păstrată exclusiv pe server. Nu seta aceste valori până nu există o soluție de IP fix pentru BOCP și nu se aplică migrația `20260922220856_bocp_scheduled_import.sql`. Ruta refuză importul înainte de 1 octombrie 2026, verifică toate paginile înainte de prima scriere și folosește loturi idempotente. Pentru fiecare rulare reia facturile din ultimele șapte zile (niciodată înainte de lansare), ca să poată recupera întreruperi scurte; o întrerupere mai lungă sau facturi antedatate cer import manual de recuperare. Frecvența jobului și planul de hosting se decid înainte de activare.

### De reluat înainte de activarea BOCP

- Alegerea hostingului și a IP-ului fix de ieșire; adăugarea numai a acelui IP în whitelist-ul BOCP și verificarea permisiunilor read-only ale cheii API.
- Aplicarea migrației `20260922220856_bocp_scheduled_import.sql`, configurarea exclusiv server-side a `CRON_SECRET` și `SUPABASE_SECRET_KEY`, apoi alegerea frecvenței și programarea jobului. `BOCP_AUTO_IMPORT_ENABLED` rămâne `false` până la testul final.
- Test end-to-end după 1 octombrie: factură nouă → import fără dubluri → board → confirmare SKU → predare; verificarea recuperării după o întrerupere și a facturilor antedatate.
- Completarea EAN-urilor în catalog și înlocuirea confirmării temporare după SKU cu scanarea fizică EAN, după testarea pe dispozitivele de depozit.

## Pregătirea integrării BOCP

Clientul server-side din `lib/bocp/` poate face doar cereri `GET` către lista comenzilor marketplace, lista conectorilor și lista facturilor. Auditul este pornit manual de administrator și corelează comenzile cu facturile. Produsele fizice fără SKU, cu cantitate invalidă sau cu linie neclasificată blochează factura; lipsa EAN-ului nu blochează etapa SKU. Liniile de serviciu, transport și reducere nu devin articole de confirmat. Auditul nu importă date în Supabase.

Importul operațional folosește un RPC atomic pe loturi de maximum 25 de facturi, creează numai comenzi noi și nu modifică progresul comenzilor existente. Se poate rula din nou fără dubluri. Până la 1 octombrie 2026, butonul și ruta de import sunt blocate. După actualizarea catalogului EAN, fiecare articol poate trece explicit de la `scan_code_type = 'sku'` la `ean`; nu se redenumește SKU-ul ca EAN.

Pentru testare, folosește un utilizator BOCP REST API dedicat, ideal limitat la permisiunile `GET` necesare, cu IP-ul de ieșire explicit în whitelist și învățarea automată a IP-urilor dezactivată. Completează `BOCP_API_BASE_URL`, `BOCP_API_USERNAME` și `BOCP_API_PASSWORD` doar în `.env.local` sau în variabilele server-side ale platformei de hosting. Nu adăuga parola în Git și nu folosi prefixul `NEXT_PUBLIC_` pentru ea. Un răspuns `401` poate însemna și IP nepermis; nu relua automat încercarea.
