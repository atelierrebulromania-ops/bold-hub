import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { mustChangePassword } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

// Every login can change its password here; a login with a temporary password is sent here first.
export default async function PasswordPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();
  if (!authData?.claims?.sub) redirect("/login");
  const required = mustChangePassword(authData.claims);

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
          <h1>{required ? "Alege-ți parola" : "Schimbă parola"}</h1>
          <p className="auth-lead">{required
            ? "Contul tău a fost creat cu o parolă temporară. Alege o parolă doar a ta înainte să continui."
            : "Alege o parolă nouă pentru contul tău."}</p>
          <PasswordForm />
          {!required && <p className="auth-help"><Link href="/">Înapoi în aplicație</Link></p>}
        </div>
      </section>
    </main>
  );
}
