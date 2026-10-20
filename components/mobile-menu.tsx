"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Phones and tablets: the main navigation opens from this button as a full list (the sidebar is a top bar there).
// The open state is a checkbox next to the navigation, so CSS shows the list and page refreshes keep it.
export function MobileMenuButton() {
  const toggle = useRef<HTMLInputElement>(null);
  const pathname = usePathname();

  // A new page closes the menu.
  useEffect(() => { if (toggle.current) toggle.current.checked = false; }, [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && toggle.current) toggle.current.checked = false; };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <input ref={toggle} type="checkbox" id="mobile-menu" className="menu-toggle" aria-label="Meniu" />
      <label htmlFor="mobile-menu" className="menu-button" title="Meniu">
        <svg className="menu-open-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        <svg className="menu-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </label>
    </>
  );
}
