"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { renameCatalog } from "./actions";

// "Redenumire" in the catalog list: the button turns into the title field, saved with Enter or "Salvează".
export function RenameCatalog({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" className="button button-outline" onClick={() => setOpen(true)}>Redenumire</button>;
  return (
    <form action={renameCatalog} className="hc-rename-catalog">
      <input type="hidden" name="id" value={id} />
      <input name="title" defaultValue={title} required maxLength={120} autoFocus aria-label="Titlul nou al catalogului"
        onFocus={event => event.currentTarget.select()} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }} />
      <SubmitButton className="button button-primary">Salvează</SubmitButton>
      <button type="button" className="button button-outline" onClick={() => setOpen(false)}>Renunță</button>
    </form>
  );
}
