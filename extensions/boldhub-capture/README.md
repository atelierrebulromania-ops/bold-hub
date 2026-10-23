# BoldHub Capture

Extensie Chrome (Manifest V3) care trimite facturile furnizorilor (PDF, CSV, XLSX) în BoldHub → Contabilitate.
Se dezvoltă și se distribuie separat de aplicația web; vorbește cu BoldHub doar prin `/api/capture/*`.

## Instalare (Developer Mode)

1. Copiază folderul `extensions/boldhub-capture` pe calculator.
2. Deschide `chrome://extensions` și pornește **Developer mode** (dreapta sus).
3. **Load unpacked** → alege folderul `boldhub-capture`.
4. Fixează extensia în bară (iconița puzzle → pin).
5. Deschide extensia → alege serverul → **Conectează BoldHub**. Se deschide BoldHub (logat ca administrator) → **Conectează**.
   Dacă trimiterea automată nu merge, pagina afișează o cheie: copiaz-o în extensie la „Am deja o cheie”.

## Folosire

1. Intră în contul furnizorului (Meta, Google Ads, TikTok, Shopify, MailerLite, Adobe, Claude, ChatGPT…) și deschide factura sau lista de facturi.
2. Apasă iconița extensiei. Furnizorul se recunoaște după domeniu; facturile găsite în pagină apar în listă.
3. Alege documentul (sau un fișier de pe calculator), compania și, opțional, nr. facturii / data emiterii.
4. **Trimite în BoldHub**. Rezultatul: salvat, duplicat (există deja) sau respins, cu link „Deschide în BoldHub”.

## Securitate

- Nu stochează parole și nu citește cookie-uri. Preia facturile doar din fila activă, când apeși iconița (`activeTab`).
- Primește o cheie `bhc_…` limitată la endpointurile Capture, valabilă 90 de zile; în BoldHub se păstrează doar hash-ul ei.
  Revocare: BoldHub → Contabilitate → Integrări → BoldHub Capture → Deconectează.
- Fișierul urcă direct în bucketul privat, printr-un URL semnat de unică folosință; BoldHub verifică apoi conținutul,
  dimensiunea (max. 25 MB) și duplicatele.
- Permisiuni: `activeTab`, `scripting`, `storage`; acces la gazde doar pentru BoldHub (www.boldhub.ro, localhost:3001)
  și pentru stocarea Supabase a proiectului. Doar paginile BoldHub pot trimite cheia extensiei (`externally_connectable`).

## Limitări

- Unele platforme generează factura printr-un buton JavaScript sau pe alt domeniu, fără un link direct. În acest caz
  descarcă factura și alege fișierul din extensie (fallback local).
- Furnizorii și domeniile se configurează în BoldHub → Contabilitate → Integrări.
- Pentru alt server decât cele două, adaugă-l în `host_permissions`, `externally_connectable` (manifest.json),
  `allowedOrigins` (background.js) și în lista din popup.html.
