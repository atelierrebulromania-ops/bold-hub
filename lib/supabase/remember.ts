// "Ține-mă minte" on the login screen. Checked (the default), the session cookies last as long as Supabase allows
// (400 days); unchecked, they become browser-session cookies and the user is signed out when the browser closes.
export const rememberCookie = "boldhub-remember";

type CookieOptions = { maxAge?: number; expires?: Date | number | string } & Record<string, unknown>;

export function forSession<T extends CookieOptions | undefined>(options: T, remember: boolean): T {
  if (remember || !options) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  // A cookie being cleared (maxAge 0) must stay cleared.
  return (options.maxAge === 0 ? options : rest) as T;
}
