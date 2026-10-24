import { cookies } from "next/headers";
import { getManifest } from "./manifest";
import { ROLES, can, canVisit } from "./roles";

/*
  The mocked session.

  What is mocked: the identity federation. There is no SAML assertion, no OIDC
  exchange and no Entra tenant. Choosing an account sets a cookie holding a
  role key, and that is all.

  What is not mocked: everything downstream. The role drives real permission
  checks on every route and every API handler, so the day a real provider is
  wired in, the change is this file and nothing else.

  The cookie is not signed and is trivially forgeable. That is acceptable for a
  tenant whose data is synthetic and would not be for any other, which is why
  the whole mechanism refuses to operate outside one.
*/

export const SESSION_COOKIE = "welo_demo_session";

/*
  The accounts the picker offers, styled after an Entra account chooser.
  Addresses are on example.com, which is reserved by RFC 2606 and cannot be
  registered, so none of these can ever be a real mailbox.
*/
export const DEMO_ACCOUNTS = [
  { email: "thandi.mokoena@example.com", name: "Thandi Mokoena", title: "Operations Director", role: "viewer" },
  { email: "sipho.dlamini@example.com", name: "Sipho Dlamini", title: "Occupational Health Lead", role: "analyst" },
  { email: "lerato.nkosi@example.com", name: "Lerato Nkosi", title: "HR Data Owner", role: "data_owner" },
  { email: "johan.vandermerwe@example.com", name: "Johan van der Merwe", title: "IT Programme Owner", role: "client_admin" },
  { email: "naledi.khumalo@example.com", name: "Naledi Khumalo", title: "Wellness Committee Chair", role: "approver" },
  { email: "support@example.com", name: "Welo Support", title: "Platform engineering", role: "welo_support" },
  { email: "prospect@example.com", name: "Demo Visitor", title: "Prospective client", role: "prospect" },
];

export function accountFor(email) {
  return DEMO_ACCOUNTS.find((a) => a.email === email) || null;
}

/*
  Whether mocked sign-in may run at all.

  Fail closed on the tenant marking rather than on an environment variable, so
  the switch that turns a tenant into a real one is the same switch that
  removes the fake login. A tenant with synthetic = false gets no sign-in page
  and no session, which denies everything rather than admitting everyone.
*/
export function mockAuthAvailable() {
  return getManifest().tenant.synthetic === true;
}

export async function getSession() {
  if (!mockAuthAvailable()) return null;

  const store = await cookies();
  const email = store.get(SESSION_COOKIE)?.value;
  if (!email) return null;

  const account = accountFor(email);
  if (!account) return null;

  const r = ROLES[account.role];
  if (!r) return null;

  return {
    email: account.email,
    name: account.name,
    title: account.title,
    role: account.role,
    roleLabel: r.label,
    permissions: r.permissions,
    // Says plainly what this is, everywhere it is read.
    authenticated: false,
    mechanism: "mocked account picker",
  };
}

export async function requirePermission(permission) {
  const session = await getSession();
  return { session, allowed: can(session, permission) };
}

export async function requireRoute(href) {
  const session = await getSession();
  return { session, allowed: canVisit(session, href) };
}
