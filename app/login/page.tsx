import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login-screen">
      <div className="login-mark">B<span>·</span></div>
      <section className="login-card">
        <p className="eyebrow">Atelier Rebul · operațiuni</p>
        <h1>Bine ai venit în BoldHub.</h1>
        <p className="muted">Un singur loc pentru comenzile care trec prin depozit.</p>
        <form action={signIn} className="login-form">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required placeholder="nume@atelierrebul.ro" />
          <label htmlFor="password">Parolă</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="Parola contului" />
          {error && <p className="form-error" role="alert">{error === "missing" ? "Completează emailul și parola." : "Datele de autentificare nu sunt corecte."}</p>}
          <button className="button button-primary" type="submit">Intră în aplicație <span aria-hidden="true">↗</span></button>
        </form>
        <p className="login-help">Accesul este oferit de administratorul Atelier Rebul.</p>
      </section>
      <p className="login-footer">ATELIER REBUL <span>—</span> BOLDHUB</p>
    </main>
  );
}
