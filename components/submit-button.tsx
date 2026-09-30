"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

// A form's submit button that shows a spinner and blocks double submits while the form is sent.
export function SubmitButton({ children, className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} type="submit" className={`${className ?? ""} ${pending ? "is-busy" : ""}`.trim()} disabled={disabled || pending} aria-busy={pending || undefined}>
      {pending && <span className="busy-spinner" aria-hidden="true" />}{children}
    </button>
  );
}
