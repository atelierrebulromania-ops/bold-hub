"use client";

import { useEffect } from "react";
import { useLinkStatus } from "next/link";

// Placed inside a <Link>: while the page it opens is loading, the link shows a small spinner and
// the whole app shows the top progress bar and dims the current page (html[data-navigating]).
export function LinkPending() {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    document.documentElement.dataset.navigating = "true";
    return () => { delete document.documentElement.dataset.navigating; };
  }, [pending]);
  return <span aria-hidden="true" className={`link-pending ${pending ? "on" : ""}`} />;
}
