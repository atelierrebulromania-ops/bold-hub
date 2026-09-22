# BoldHub · Atelier Rebul

Aplicație internă pentru operațiunile de depozit. Specificația funcțională este în `proiect-aplicatie-depozit-atelier-rebul.md`, iar schema de referință în `schema-baza-de-date-depozit.md`.

## Stadiul actual

- Next.js App Router, TypeScript și Tailwind CSS.
- Supabase Auth cu sesiune în cookie-uri și acces pe roluri.
- Schema celor 18 tabele din document, cu RLS activat pe toate și migrații SQL versionate.
- Primul flux funcțional: board de comenzi online, preluare exclusivă, eliberare, scanare EAN cu progres și predare curierului/șoferului.
- Actualizare prin Supabase Realtime, cu reîmprospătare periodică de rezervă.

BOCP nu este încă sincronizat. Baza nu conține produse, comenzi sau utilizatori, așa că board-ul este gol până la configurarea conturilor și a integrării. Refill, retururile, dashboard-ul owner și notificările vor fi construite în etapele următoare.

## Pornire locală

1. Instalează dependențele: `npm ci`.
2. Copiază `.env.example` în `.env.local` și setează URL-ul și cheia *publishable* ale proiectului Supabase BoldHub. În acest workspace, `.env.local` este deja configurat și ignorat de Git.
3. Rulează `npm run dev` și deschide `http://localhost:3000`.

Verificare: `npm run typecheck` și `npm run build`. Build-ul folosește Webpack, deoarece Turbopack nu poate deschide procesele interne necesare în acest mediu.

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

Migrațiile din `supabase/migrations/` au fost aplicate proiectului BoldHub. Nu se reaplică manual. Proiectul local este conectat prin URL și cheia publishable; autentificarea CLI Supabase este separată și trebuie legată de contul corect înainte de comenzile `supabase db`.

Pentru Vercel, setează `NEXT_PUBLIC_SUPABASE_URL` și `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ca variabile de mediu. Nicio cheie `service_role` / `secret` nu intră în client sau în Git.

Integrarea BOCP are nevoie de o soluție pentru IP-ul de ieșire whitelisted și de confirmarea structurii reale a răspunsului `/invoices/list/` înainte de implementarea sincronizării automate.
