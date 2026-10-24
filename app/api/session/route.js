import { NextResponse } from "next/server";
import { SESSION_COOKIE, accountFor, mockAuthAvailable } from "@/lib/platform/session";

export const dynamic = "force-dynamic";

/*
  Sets or clears the mocked session.

  Refuses outright when the tenant is not marked synthetic, so the fake login
  cannot be reached in a tenant holding real data even by calling the endpoint
  directly. Fail closed: the tenant marking is the same switch that makes a
  tenant real, so it is the right thing to hang this on.
*/
export async function POST(request) {
  if (!mockAuthAvailable()) {
    return NextResponse.json(
      { error: "Mocked sign-in is only available in a synthetic tenant." },
      { status: 404 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body was not valid JSON." }, { status: 400 });
  }

  const { email } = body || {};
  const account = accountFor(email);
  if (!account) {
    return NextResponse.json({ error: "Unknown demo account." }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, role: account.role });
  res.cookies.set(SESSION_COOKIE, account.email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Not signed, and deliberately short-lived. A demo session that outlives
    // the demo is a demo session somebody finds later and misreads.
    maxAge: 60 * 60 * 8,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
