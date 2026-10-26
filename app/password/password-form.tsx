"use client";

import { useActionState } from "react";
import { minPasswordLength } from "@/lib/accounts";
import { changeOwnPassword } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPassword, null);
  return (
    <form action={action} className="auth-form">
      <label className="auth-field">
        <span>Parolă nouă</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={minPasswordLength} maxLength={72} placeholder={`Cel puțin ${minPasswordLength} caractere`} />
      </label>
      <label className="auth-field">
        <span>Repetă parola</span>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={minPasswordLength} maxLength={72} placeholder="Aceeași parolă" />
      </label>
      {state?.error && <p className="form-error" role="alert">{state.error}</p>}
      <button type="submit" className="auth-submit" disabled={pending}>{pending ? "Se salvează…" : "Salvează parola"}</button>
    </form>
  );
}
