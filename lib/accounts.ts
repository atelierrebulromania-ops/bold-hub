// Accounts log in with a username; Supabase Auth gets a technical email nobody sees.
export const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const minPasswordLength = 6;
const loginDomain = "users.boldhub.invalid";

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function loginEmail(username: string) {
  return `${normalizeUsername(username)}@${loginDomain}`;
}

// The admin keeps logging in with a real email; everyone else types a username.
export function loginIdentifier(value: string) {
  const trimmed = value.trim();
  return trimmed.includes("@") ? trimmed : loginEmail(trimmed);
}

export const roleLabels = {
  admin: "Administrator",
  owner: "Owner",
  operator_depozit: "Operator depozit",
  operator_facturare: "Operator facturare",
} as const;
