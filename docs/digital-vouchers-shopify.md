# Digital Vouchers: integrating the Shopify landing page

How the `atelierrebul.ro/pages/private-gift` page uses BoldHub. The landing page lives in Shopify; BoldHub only
serves data, the Google Wallet link, the voucher image and the tracking. Nothing here changes the Shopify theme
or the GIFT25 discount.

Base address (production): `https://www.boldhub.ro/api/public/vouchers/private-gift`

## Endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/public/vouchers/{slug}` | Public data of the voucher (texts, code, dates, colours, links, available features). |
| GET | `/api/public/vouchers/{slug}/google-wallet` | `{ "saveUrl": "https://pay.google.com/gp/v/save/…" }`. With `?redirect=1` it redirects straight to Google (a plain link works). |
| GET | `/api/public/vouchers/{slug}/apple-wallet` | Reserved. Answers `501 not_configured` until Apple Wallet exists. Do not show the Apple button while `features.appleWallet` is `false`. |
| GET | `/api/public/vouchers/{slug}/image` | The voucher as PNG (1080 × 1350). `?download=1` makes the browser save it as `private-gift-voucher.png`. |
| POST | `/api/public/vouchers/{slug}/events` | Tracking from the page (see Events). |

Optional query parameters on `google-wallet` and `apple-wallet` (all go to the anonymous statistics):
`session`, `utm_source`, `utm_medium`, `utm_campaign`, `ref` (the page's referrer).

There is no endpoint that lists vouchers, and drafts answer exactly like a slug that does not exist.

## CORS

Browser calls are allowed from the voucher's own sites: `https://atelierrebul.ro` and `https://www.atelierrebul.ro`
(website, landing page and discount link, each with and without `www.`). To allow another site (e.g. the
`*.myshopify.com` preview domain while building the page), add it in BoldHub: Vouchers → Edit → Distribution →
*Extra sites allowed to use the public API*. Requests from other sites get no CORS header; `POST /events` from
another site is refused with `403 forbidden_origin`.

## Example: GET voucher

```http
GET /api/public/vouchers/private-gift
Origin: https://atelierrebul.ro
```

```json
{
  "slug": "private-gift",
  "brand": "Atelier Rebul",
  "title": "Un cadou pentru tine",
  "subtitle": "Bucuria de a dărui începe cu un cadou pentru tine.",
  "longDescription": "Bucură-te de 25% reducere la produsele tale preferate Atelier Rebul, pe tot parcursul lunii decembrie.",
  "language": "ro",
  "status": "scheduled",
  "discount": { "type": "percentage", "value": 25, "currency": null, "label": "25%", "code": "GIFT25" },
  "validity": { "startsAt": "2026-11-30T22:00:00+00:00", "expiresAt": "2026-12-31T21:59:59+00:00", "timezone": "Europe/Bucharest", "label": "01.12.2026 – 31.12.2026" },
  "terms": "Voucher valabil exclusiv online, …",
  "design": { "backgroundColor": "#651F2C", "textColor": "#F5EEE4", "accentColor": "#D8BE98", "logoUrl": "https://…/logo.png", "heroUrl": "https://…/hero.png" },
  "links": {
    "website": "https://atelierrebul.ro",
    "landing": "https://atelierrebul.ro/pages/private-gift",
    "shop": "https://atelierrebul.ro/discount/GIFT25?redirect=%2Fcollections%2Fall%3Futm_source%3Devent%26utm_medium%3Dqr%26utm_campaign%3Dprivate_gift_december_2026",
    "qr": "https://atelierrebul.ro/pages/private-gift?utm_source=event&utm_medium=qr&utm_campaign=private_gift_december_2026"
  },
  "features": { "googleWallet": true, "appleWallet": false, "imageDownload": true, "email": false },
  "endpoints": {
    "googleWallet": "https://www.boldhub.ro/api/public/vouchers/private-gift/google-wallet",
    "image": "https://www.boldhub.ro/api/public/vouchers/private-gift/image",
    "events": "https://www.boldhub.ro/api/public/vouchers/private-gift/events"
  }
}
```

`links.shop` opens the shop with GIFT25 applied (Shopify `/discount/` link) and keeps the UTM tags on the page it
redirects to.

## Statuses and what the page should show

| `status` | Meaning | Page |
|---|---|---|
| `scheduled` | Published, before 01.12.2026 00:00 (Bucharest). | Show the voucher, the code and the wallet button: **saving before the start is allowed**. Say “valabil din 1 decembrie”. In Shopify the code only works from its own start date. |
| `active` | Between start and expiration. | Everything. |
| `expired` | After 31.12.2026 23:59:59. | `discount.code` is `null`, all `features` are `false`, `links.shop` is the website. Show “Campania s-a încheiat”. |

Errors (JSON `{ "error": "...", "message": "..." }`):

| HTTP | `error` | When |
|---|---|---|
| 404 | `not_found` | Unknown slug or draft. |
| 410 | `archived` | Campaign archived in BoldHub. |
| 410 | `expired` | `google-wallet` or `image` after expiration. |
| 404 | `disabled` | Google Wallet or image download turned off for the voucher. |
| 503 | `unavailable` | Google Wallet not configured on the server. |
| 502 | `wallet_error` | Google did not accept the pass right now; retry later. |
| 501 | `not_configured` | Apple Wallet (always, for now). |
| 429 | `rate_limited` | Too many requests from one visitor (`Retry-After: 60`). |
| 400 / 403 / 413 | `invalid_type`, `invalid_body` / `forbidden_origin` / `too_large` | Tracking requests that are wrong. |

Rate limits per visitor per minute: data 120, wallet 20, events 60, image 20.

## Events

`POST /events` with `Content-Type: application/json`, at most 2 KB:

```json
{ "type": "discount_code_copy", "sessionId": "k3J9…", "utmSource": "event", "utmMedium": "qr", "utmCampaign": "private_gift_december_2026", "referrer": "https://l.instagram.com/" }
```

Answer: `202 { "ok": true }`.

Accepted `type` values from the page: `landing_page_view`, `discount_code_copy`, `shop_now_click`,
`voucher_image_download`. The server records the others itself, so they cannot be faked:

- `google_wallet_request` and `google_wallet_link_generated`: on every `google-wallet` call.
- `apple_wallet_request`: on every `apple-wallet` call.
- `email_voucher_requested` and `email_voucher_sent`: when e-mail delivery exists (not yet).

`sessionId` is a random id the page keeps in `localStorage` (8–64 of `A–Z a–z 0–9 _ -`). BoldHub stores no IP, no
user agent string and no personal data, only the device type and the referrer's host name. Wallet counts are
save **requests**, not confirmed saves. Shop clicks are not Shopify orders.

## JavaScript example (theme section or custom liquid)

The official “Add to Google Wallet” button must be the image from Google's brand guidelines
(https://developers.google.com/wallet/retail/offers/resources/brand-guidelines): download the Romanian badge
there, upload it to Shopify Files, and keep its proportions and clear space.

```html
<div id="ar-voucher" hidden>
  <p class="ar-benefit"></p>
  <p class="ar-code"><span></span> <button type="button" data-copy>Copiază codul</button></p>
  <p class="ar-validity"></p>
  <a class="ar-shop" data-event="shop_now_click">Cumpără acum</a>
  <a class="ar-gwallet" hidden><img src="{{ 'add-to-google-wallet-ro.svg' | file_url }}" alt="Adaugă în Google Wallet" height="48"></a>
  <a class="ar-image" data-event="voucher_image_download" hidden>Salvează ca imagine</a>
  <details class="ar-terms"><summary>Condiții de utilizare</summary><p></p></details>
</div>
<script>
(() => {
  const api = "https://www.boldhub.ro/api/public/vouchers/private-gift";
  const root = document.getElementById("ar-voucher");
  // Anonymous session id, kept on this device only.
  let session = null;
  try { session = localStorage.getItem("ar_voucher_session"); if (!session) { session = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("ar_voucher_session", session); } } catch (e) {}
  const params = new URLSearchParams(location.search);
  const utm = { utmSource: params.get("utm_source"), utmMedium: params.get("utm_medium"), utmCampaign: params.get("utm_campaign") };
  const track = type => fetch(`${api}/events`, {
    method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ type, sessionId: session, ...utm, referrer: document.referrer || null }),
  }).catch(() => {});

  fetch(api).then(r => r.ok ? r.json() : Promise.reject(r.status)).then(v => {
    root.hidden = false;
    root.querySelector(".ar-benefit").textContent = v.discount.label ? `${v.discount.label} reducere` : "";
    root.querySelector(".ar-validity").textContent = `Valabil ${v.validity.label}`;
    root.querySelector(".ar-terms p").textContent = v.terms;
    root.querySelector(".ar-shop").href = v.links.shop;
    if (v.status === "expired") { root.querySelector(".ar-code").hidden = true; return; }
    root.querySelector(".ar-code span").textContent = v.discount.code;
    root.querySelector("[data-copy]").onclick = () => navigator.clipboard.writeText(v.discount.code).then(() => track("discount_code_copy"));
    if (v.features.googleWallet) {
      const q = new URLSearchParams({ redirect: "1", ...(session ? { session } : {}), ...Object.fromEntries(Object.entries({ utm_source: utm.utmSource, utm_medium: utm.utmMedium, utm_campaign: utm.utmCampaign }).filter(([, x]) => x)) });
      const a = root.querySelector(".ar-gwallet"); a.href = `${v.endpoints.googleWallet}?${q}`; a.hidden = false;
    }
    if (v.features.imageDownload) { const a = root.querySelector(".ar-image"); a.href = `${v.endpoints.image}?download=1`; a.hidden = false; }
    root.querySelectorAll("[data-event]").forEach(el => el.addEventListener("click", () => track(el.dataset.event)));
    track("landing_page_view");
  }).catch(() => { /* keep the static fallback content of the page */ });
})();
</script>
```

The Google Wallet link is a plain `<a>` to the `?redirect=1` endpoint: BoldHub records the request, prepares the
pass and sends the customer to Google, which shows the save screen (Android with Google Wallet, or any browser
signed in to Google).

## E-mail delivery

Not available yet (`features.email` is `false`). When it is added, the request will be a separate endpoint; it
will not subscribe anyone to the newsletter without a separate consent checkbox.
