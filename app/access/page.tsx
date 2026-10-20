import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccessPage() {
  // A point-of-work login stops working when its client goes back to ordering centrally.
  const supabase = await createClient();
  const { data: pointPaused } = await supabase.rpc("point_login_paused");
  return (
    <main className="access-screen">
      <p className="eyebrow">BoldHub</p>
      {pointPaused ? <>
        <h1>Contul acestui punct nu mai este activ.</h1>
        <p>Comenzile se fac acum centralizat, din contul firmei. Pentru detalii, contactează Atelier Rebul.</p>
      </> : <>
        <h1>Contul tău nu are încă acces la acest ecran.</h1>
        <p>Administratorul trebuie să activeze profilul și rolul potrivit.</p>
      </>}
      <form action={signOut}><button className="button button-primary">Ieși din cont</button></form>
    </main>
  );
}
