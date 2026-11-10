"use client";

import type { ReactNode } from "react";
import { SubmitButton } from "@/components/submit-button";

// A submit button that asks before a destructive or hard-to-undo action.
export function ConfirmSubmit({ message, className, children }: { message: string; className?: string; children: ReactNode }) {
  return (
    <SubmitButton className={className} onClick={event => { if (!window.confirm(message)) event.preventDefault(); }}>
      {children}
    </SubmitButton>
  );
}
