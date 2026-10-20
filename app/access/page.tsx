import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  // A point-of-work login stops working when its client goes back to ordering centrally.
  const supabase = await createClient();
  const { data: pointPaused } = await supabase.rpc("point_login_paused");
  // A staff member who opened another role's screen (e.g. the admin) gets a way back.
  const { data: authData } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  const { data: staff } = userId ? await supabase.from("app_users").select("active").eq("id", userId).maybeSingle() : { data: null };
  return (
    <main className="access-screen">
      <p className="eyebrow">BoldHub</p>
      {pointPaused ? <>
        <h1>Contul acestui punct nu mai este activ.</h1>
        <p>Comenzile se fac acum centralizat, din contul firmei. Pentru detalii, contactează Atelier Rebul.</p>
      </> : staff?.active ? <>
        <h1>Ecranul acesta este pentru alt rol.</h1>
        <p>Întoarce-te în aplicație. Ca administrator, îl vezi alegând rolul din selectorul de sus.</p>
      </> : <>
        <h1>Contul tău nu are încă acces la acest ecran.</h1>
        <p>Administratorul trebuie să activeze profilul și rolul potrivit.</p>
      </>}
      <div className="access-actions">
        {staff?.active && <Link href="/" className="button button-primary">Înapoi la aplicație</Link>}
        <form action={signOut}><button className={`button ${staff?.active ? "button-outline" : "button-primary"}`}>Ieși din cont</button></form>
      </div>
    </main>
  );
}
