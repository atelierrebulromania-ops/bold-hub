"use client";

import { useEffect } from "react";

// Opens the browser's print dialog ("Save as PDF") once the document is on screen.
export function PrintButton() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 400);
    return () => clearTimeout(timer);
  }, []);
  return <button type="button" className="button button-primary print-hide" onClick={() => window.print()}>Salvează PDF / Printează</button>;
}
