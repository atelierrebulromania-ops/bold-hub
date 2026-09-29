"use client";

import { useTransition } from "react";
import { roleLabels } from "@/lib/accounts";
import type { UserRole } from "@/lib/auth";
import { switchView } from "@/app/dev/actions";

const roles = Object.entries(roleLabels) as [UserRole, string][];

export type SwitcherPartner = { id: string; business_name: string };

// Dev mode for the admin: switch the role (or partner location) the screens are shown for.
// `current` is a staff role or "partner:<id>".
export function RoleSwitcher({ current, partners }: { current: string; partners: SwitcherPartner[] }) {
  const [pending, startTransition] = useTransition();
  const viewingAs = current !== "admin";
  return (
    <label className={`role-switcher ${viewingAs ? "viewing-as" : ""}`} title="Mod dezvoltare: vezi aplicația ca alt rol">
      <span className="role-switcher-label">{viewingAs ? "Vezi ca" : "Dev · rol"}</span>
      <select value={current} disabled={pending} aria-label="Rolul cu care vezi aplicația"
        onChange={(event) => { const next = event.target.value; startTransition(() => switchView(next)); }}>
        <optgroup label="Echipă">
          {roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </optgroup>
        <optgroup label="Partener">
          {partners.length
            ? partners.map((partner) => <option key={partner.id} value={`partner:${partner.id}`}>{partner.business_name}</option>)
            : <option value="" disabled>Nicio locație configurată</option>}
        </optgroup>
      </select>
    </label>
  );
}
