import { notFound } from "next/navigation";
import { DEMO_ACCOUNTS, mockAuthAvailable } from "@/lib/platform/session";
import { ROLES } from "@/lib/platform/roles";
import AccountPicker from "@/components/platform/AccountPicker";

export const metadata = { title: "Sign in | Welo" };
export const dynamic = "force-dynamic";

/*
  The mocked sign-in.

  Styled after an Entra account chooser because that is what it stands in for,
  and labelled as a mock on the page itself because a convincing fake login is
  exactly the thing somebody later mistakes for a real one. There is no SAML
  assertion and no OIDC exchange: choosing an account sets a cookie holding a
  role key.

  Unreachable in a tenant that is not marked synthetic.
*/
export default function SignInPage() {
  if (!mockAuthAvailable()) notFound();

  const accounts = DEMO_ACCOUNTS.map((a) => ({
    ...a,
    roleLabel: ROLES[a.role].label,
    access: ROLES[a.role].access,
    permissionCount: ROLES[a.role].permissions.length,
  }));

  return <AccountPicker accounts={accounts} />;
}
