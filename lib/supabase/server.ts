import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { forSession, rememberCookie } from "./remember";

// `remember` is passed at sign-in; afterwards the choice is read from its cookie.
export async function createClient(remember?: boolean) {
  const cookieStore = await cookies();
  const keep = remember ?? cookieStore.get(rememberCookie)?.value !== "0";

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, forSession(options, keep)),
            );
          } catch {
            // Server Components cannot write cookies; the proxy refreshes sessions.
          }
        },
      },
    },
  );
}
