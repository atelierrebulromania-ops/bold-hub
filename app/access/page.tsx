import { signOut } from "@/app/login/actions";

export default function AccessPage() {
  return (
    <main className="access-screen">
      <p className="eyebrow">BoldHub</p>
      <h1>Contul tău nu are încă acces la acest ecran.</h1>
      <p>Administratorul trebuie să activeze profilul și rolul potrivit.</p>
      <form action={signOut}><button className="button button-primary">Ieși din cont</button></form>
    </main>
  );
}
