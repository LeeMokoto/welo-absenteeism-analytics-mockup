import { forbidden } from "next/navigation";
import { getSession } from "./session";
import { can } from "./roles";

/*
  The route guard.

  Every screen calls this. The navigation already hides what a session cannot
  open, but hiding is not refusing: the solution design requires the check to
  run where the data is served, so that a typed URL, a bookmark or a stale tab
  is refused the same way a missing menu item is.

  Returns the session when allowed, and renders the forbidden boundary when
  not, so a caller cannot accidentally continue past a denial.
*/
export async function guard(permission) {
  const session = await getSession();
  if (!can(session, permission)) forbidden();
  return session;
}
