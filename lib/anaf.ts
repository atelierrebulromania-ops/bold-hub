import "server-only";

// Company data by CUI from the public ANAF web service (no key; about one request per second).
export type AnafCompany = {
  cui: string;
  vatId: string;
  name: string;
  registrationNumber: string;
  street: string;
  city: string;
  county: string;
  zip: string;
  vatPayer: boolean;
  inactive: boolean;
  deregistered: boolean;
};

const ANAF_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva";

// "RO 42910222" → "42910222", when the control digit is right.
export function normalizeCui(value: string): string | null {
  const digits = value.trim().toUpperCase().replace(/^RO/, "").replace(/\s+/g, "");
  if (!/^\d{2,10}$/.test(digits)) return null;
  const key = "753217532";
  const body = digits.slice(0, -1).padStart(9, "0");
  let sum = 0;
  for (let index = 0; index < 9; index++) sum += Number(body[index]) * Number(key[index]);
  const control = (sum * 10) % 11 % 10;
  return control === Number(digits.at(-1)) ? digits : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function lookupAnafCompany(cui: string): Promise<{ ok: true; company: AnafCompany } | { ok: false; error: string }> {
  const digits = normalizeCui(cui);
  if (!digits) return { ok: false, error: "CUI-ul nu este valid (verifică cifrele)." };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(new Date());
  let json: { found?: Record<string, Record<string, unknown>>[] } | null = null;
  try {
    const response = await fetch(ANAF_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify([{ cui: Number(digits), data: today }]),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, error: "ANAF nu răspunde acum. Încearcă din nou peste câteva secunde." };
    json = await response.json();
  } catch {
    return { ok: false, error: "ANAF nu răspunde acum. Încearcă din nou peste câteva secunde." };
  }
  const found = json?.found?.[0];
  if (!found) return { ok: false, error: `CUI-ul ${digits} nu există în baza ANAF.` };

  const general = found.date_generale ?? {};
  const address = found.adresa_sediu_social ?? {};
  const street = [
    [text(address.sdenumire_Strada), text(address.snumar_Strada) && `nr. ${text(address.snumar_Strada)}`].filter(Boolean).join(" "),
    text(address.sdetalii_Adresa),
  ].filter(Boolean).join(", ");
  const vatPayer = found.inregistrare_scop_Tva?.scpTVA === true;
  return {
    ok: true,
    company: {
      cui: digits,
      vatId: vatPayer ? `RO${digits}` : digits,
      name: text(general.denumire),
      registrationNumber: text(general.nrRegCom),
      street: street || text(general.adresa),
      city: text(address.sdenumire_Localitate),
      county: text(address.sdenumire_Judet),
      zip: text(address.scod_Postal) || text(general.codPostal),
      vatPayer,
      inactive: found.stare_inactiv?.statusInactivi === true,
      deregistered: text(found.stare_inactiv?.dataRadiere).length > 0,
    },
  };
}
