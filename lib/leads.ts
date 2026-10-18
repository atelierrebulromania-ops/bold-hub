// Turning whatever a lead source sends (Meta via Make/Zapier, the MailerLite site form, a CSV row)
// into one lead. Known fields are picked by name; everything else is kept as the form's answers.

export type LeadSource = "meta" | "website" | "google" | "tiktok" | "import";
export const leadSources: LeadSource[] = ["meta", "website", "google", "tiktok", "import"];

export type NormalizedLead = {
  source: LeadSource; external_id: string | null; campaign: string | null; ad_name: string | null; form_name: string | null;
  full_name: string | null; company: string | null; phone: string | null; email: string | null; city: string | null;
  message: string | null; answers: Record<string, string>; received_at: string | null;
};

const fields: Record<Exclude<keyof NormalizedLead, "source" | "answers">, string[]> = {
  external_id: ["leadgen_id", "lead_id", "leadid", "id"],
  campaign: ["campaign_name", "campaign", "campanie", "utm_campaign"],
  ad_name: ["ad_name", "adname", "ad"],
  form_name: ["form_name", "formname", "form", "formular"],
  full_name: ["full_name", "fullname", "name", "nume", "nume_complet", "nume_si_prenume"],
  company: ["company_name", "company", "firma", "companie", "societate", "denumire_firma", "business_name"],
  phone: ["phone_number", "phone", "telefon", "nr_telefon", "mobile", "mobil"],
  email: ["email", "e_mail", "email_address", "adresa_email"],
  city: ["city", "oras", "localitate", "judet_oras"],
  message: ["message", "mesaj", "comments", "comentarii", "observatii", "details"],
  received_at: ["created_time", "created_at", "date", "submitted_at"],
};

function keyOf(raw: string) {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ") || null;
  if (typeof value === "object") return null;
  const result = String(value).trim();
  return result ? result.slice(0, 1000) : null;
}

type Flat = Map<string, { label: string; value: string }>;

// Meta and Make turn questions into keys ("ce_tip_de_locație_reprezinți?"); show them as text again.
function readable(key: string) {
  const label = /\s/.test(key) ? key : key.replace(/_/g, " ");
  return (label.charAt(0).toUpperCase() + label.slice(1)).slice(0, 200);
}

// Flattens nested payloads to "last key → value" (keeping the original label for the answers);
// Meta's field_data ([{name, values}]) becomes plain keys.
function flatten(input: unknown, out: Flat, depth = 0) {
  if (depth > 5 || input === null || typeof input !== "object") return;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === "object" && "name" in item && ("values" in item || "value" in item)) {
        const value = text((item as { values?: unknown; value?: unknown }).values ?? (item as { value?: unknown }).value);
        const name = text((item as { name: unknown }).name);
        if (name && value) out.set(keyOf(name), { label: readable(name), value });
      } else flatten(item, out, depth + 1);
    }
    return;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")) {
      const plain = text(value);
      if (plain && !out.has(keyOf(key))) out.set(keyOf(key), { label: readable(key), value: plain });
    } else if (value && typeof value === "object") flatten(value, out, depth + 1);
    else {
      const plain = text(value);
      if (plain && !out.has(keyOf(key))) out.set(keyOf(key), { label: readable(key), value: plain });
    }
  }
}

// Bookkeeping that tools send along (MailerLite subscriber data, shop sync, tracking) — not answers.
const noise = /shopify|mailerlite|hubspot|accepts_marketing|orders_count|total_spent|order_date|zi_de_nastere|stele|^ip|opted_in|optin|subscribed|unsubscribed|_at$|^(sent|opens|clicks|open_rate|click_rate|opens_count|clicks_count|sent_count|source|platform|is_organic|country|state|z_i_p|zip|groups?|group_id|account_id|webhook_id|batch|value|float|string|id)$/;

export function normalizeLead(payload: unknown, source: LeadSource): NormalizedLead | null {
  const flat: Flat = new Map();
  flatten(payload, flat);
  const used = new Set<string>();
  const pick = (names: string[]) => {
    for (const name of names) if (flat.has(name)) { used.add(name); return flat.get(name)!.value; }
    return null;
  };
  const lead = { source, answers: {} } as NormalizedLead;
  for (const [field, names] of Object.entries(fields)) (lead as Record<string, unknown>)[field] = pick(names);
  // First and last name sent apart (MailerLite: name + last_name).
  const first = pick(["first_name", "prenume"]);
  const last = pick(["last_name", "nume_familie", "surname"]);
  if (!lead.full_name) lead.full_name = [first, last].filter(Boolean).join(" ") || null;
  else if (last && !lead.full_name.includes(last)) lead.full_name = `${lead.full_name} ${last}`;
  // A plain "id" means the lead id only for Meta; site forms reuse ids per subscriber or event.
  if (source !== "meta" && used.has("id") && !flat.has("leadgen_id") && !flat.has("lead_id")) lead.external_id = null;
  if (lead.received_at && Number.isNaN(Date.parse(lead.received_at))) lead.received_at = null;
  if (!lead.full_name && !lead.company && !lead.email && !lead.phone) return null;

  const skip = new Set(["type", "event", "events", "status", "page_id", "adgroup_id", "ad_id", "form_id", "campaign_id", "adset_id"]);
  for (const [key, { label, value }] of flat) {
    if (used.has(key) || skip.has(key) || noise.test(key) || Object.keys(lead.answers).length >= 40) continue;
    lead.answers[label] = value.slice(0, 500);
  }
  return lead;
}
