import Image from "next/image";
import { signIn } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth-screen">
      <section className="auth-brand">
        <svg className="auth-arcs" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {[260, 330, 400, 470, 540, 610].map((radius) => <circle key={radius} cx="760" cy="120" r={radius} />)}
        </svg>
        <div className="auth-brand-inner">
          <Image src="/logo-white.png" alt="BoldHub" width={1446} height={440} className="auth-brand-logo" priority />
          <p>Platforma operațională care conectează fluxurile de lucru.</p>
        </div>
        <p className="auth-brand-footer">© {new Date().getFullYear()} BoldHub</p>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <h1>Intră în cont</h1>
          <form action={signIn} className="auth-form">
            <label className="auth-field">
              <span>Utilizator</span>
              <input name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="ex. ion.popescu" />
            </label>
            <label className="auth-field">
              <span>Parolă</span>
              <input name="password" type="password" autoComplete="current-password" required placeholder="Parola contului" />
            </label>
            {error && <p className="form-error" role="alert">{error === "missing" ? "Completează utilizatorul și parola." : "Datele de autentificare nu sunt corecte."}</p>}
            <SubmitButton className="auth-submit">Intră în aplicație</SubmitButton>
          </form>
          <p className="auth-help">Ai uitat parola? Cere una nouă administratorului.</p>
        </div>
      </section>
    </main>
  );
}
