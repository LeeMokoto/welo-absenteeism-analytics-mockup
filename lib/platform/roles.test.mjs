/*
  The permission model.

  Run with: node --test lib/platform/roles.test.mjs

  The identity is mocked and these are not. The point of the split is that
  these checks have actually run before anybody's real data reaches them.
*/

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PERMISSIONS as P,
  ROLES,
  ROLE_KEYS,
  ROUTE_PERMISSIONS,
  can,
  canVisit,
  permissionFor,
  visibleNavigation,
} from "./roles.js";

const as = (role) => ({ role });

test("the seven roles in the solution design all exist", () => {
  assert.deepEqual(
    ROLE_KEYS.sort(),
    ["analyst", "approver", "client_admin", "data_owner", "prospect", "viewer", "welo_support"].sort()
  );
});

test("no session reaches anything", () => {
  for (const p of Object.values(P)) {
    assert.equal(can(null, p), false, `${p} was granted with no session`);
    assert.equal(can({}, p), false, `${p} was granted with an empty session`);
  }
});

test("an unknown role reaches nothing", () => {
  for (const p of Object.values(P)) assert.equal(can(as("wizard"), p), false);
});

test("Welo support holds no application access by default", () => {
  assert.equal(ROLES.welo_support.permissions.length, 0);
  for (const p of Object.values(P)) assert.equal(can(as("welo_support"), p), false);
  for (const href of Object.keys(ROUTE_PERMISSIONS)) {
    assert.equal(canVisit(as("welo_support"), href), false, `support reached ${href}`);
  }
});

test("a viewer sees cohort dashboards and nothing clinical, administrative or agentic", () => {
  assert.equal(can(as("viewer"), P.VIEW_COHORTS), true);
  for (const p of [P.VIEW_CASE, P.VIEW_CONDITIONS, P.VIEW_ADMIN, P.USE_AGENTS, P.VIEW_DATA, P.CONTROL_VIEW]) {
    assert.equal(can(as("viewer"), p), false, `viewer held ${p}`);
  }
});

test("a client admin administers without reading health data", () => {
  assert.equal(can(as("client_admin"), P.VIEW_ADMIN), true);
  // Administering a tenant is not a reason to read its health data.
  for (const p of [P.VIEW_CASE, P.VIEW_CONDITIONS, P.VIEW_COHORTS]) {
    assert.equal(can(as("client_admin"), p), false, `client admin held ${p}`);
  }
});

/*
  Every permission has at least one holder.

  This test exists because its absence hid a real defect. CONTROL_CREATE was
  defined, referenced, and held by nobody, which made the separation test below
  pass on a vacuum: no role could both create and approve because no role could
  create at all. Meanwhile the control centre gated its create form on
  CONTROL_VIEW, which the Approver holds, so the role whose entire purpose is to
  approve what it did not create could create.

  A permission nothing holds is either a missing grant or dead code, and both
  are worth failing on.
*/
test("every permission is held by someone", () => {
  const orphans = Object.values(P).filter(
    (p) => !ROLE_KEYS.some((k) => ROLES[k].permissions.includes(p)),
  );
  assert.deepEqual(
    orphans,
    [],
    `permissions held by no role: ${orphans.join(", ")}. Either grant it or remove it; a permission nobody holds makes any test about who holds it pass for the wrong reason.`,
  );
});

test("approval is separate from creation", () => {
  // The whole reason the approver role exists.
  assert.equal(can(as("approver"), P.CONTROL_APPROVE), true);
  assert.equal(can(as("approver"), P.CONTROL_CREATE), false);

  // Both sides must actually be held by somebody, or the loop below proves
  // nothing. This is the guard that was missing.
  const creators = ROLE_KEYS.filter((k) => ROLES[k].permissions.includes(P.CONTROL_CREATE));
  const approvers = ROLE_KEYS.filter((k) => ROLES[k].permissions.includes(P.CONTROL_APPROVE));
  assert.ok(creators.length > 0, "no role can create, so this separation is vacuous");
  assert.ok(approvers.length > 0, "no role can approve, so this separation is vacuous");

  // And nobody who creates can approve their own.
  for (const key of ROLE_KEYS) {
    const r = ROLES[key];
    const both = r.permissions.includes(P.CONTROL_CREATE) && r.permissions.includes(P.CONTROL_APPROVE);
    assert.equal(both, false, `${key} can both create and approve`);
  }
});

test("the roles that act on cohorts are the ones that can create", () => {
  const creators = ROLE_KEYS.filter((k) => ROLES[k].permissions.includes(P.CONTROL_CREATE));
  assert.deepEqual(creators.sort(), ["analyst", "prospect"]);
  // Reading the register is not permission to add to it.
  assert.equal(can(as("approver"), P.CONTROL_VIEW), true);
  assert.equal(can(as("approver"), P.CONTROL_CREATE), false);
});

test("only the analyst reaches the individual case view", () => {
  const holders = ROLE_KEYS.filter((k) => ROLES[k].permissions.includes(P.VIEW_CASE));
  assert.deepEqual(holders, ["analyst"]);
});

test("a prospect is an analyst without the case view", () => {
  assert.equal(can(as("prospect"), P.VIEW_CASE), false);
  assert.equal(can(as("prospect"), P.VIEW_CONDITIONS), true);
});

test("every navigable route has a permission, so a new screen fails closed", () => {
  // canVisit returns false for anything unlisted, which is the safe default.
  assert.equal(canVisit(as("analyst"), "/a-screen-added-later"), false);
  assert.equal(permissionFor("/a-screen-added-later"), null);
});

test("navigation hides only what a guard would also refuse", () => {
  const nav = [
    { section: "Overview", items: [{ href: "/" }] },
    { section: "Absence analytics", items: [{ href: "/absence" }, { href: "/absence/cohorts" }] },
    { section: "Sick leave", items: [{ href: "/sick-leave" }, { href: "/sick-leave/case" }] },
    { section: "Administration", items: [{ href: "/admin" }] },
  ];

  for (const key of ROLE_KEYS) {
    const session = as(key);
    for (const group of visibleNavigation(nav, session)) {
      for (const item of group.items) {
        assert.equal(canVisit(session, item.href), true,
          `${key} was shown ${item.href} but the guard would refuse it`);
      }
    }
  }
});

test("a viewer's menu carries no clinical or admin door", () => {
  const nav = [
    { section: "Sick leave", items: [{ href: "/sick-leave" }, { href: "/sick-leave/case" }] },
    { section: "Administration", items: [{ href: "/admin" }] },
  ];
  const shown = visibleNavigation(nav, as("viewer")).flatMap((g) => g.items.map((i) => i.href));
  assert.deepEqual(shown, ["/sick-leave"]);
});

test("an empty group disappears rather than rendering a heading with nothing under it", () => {
  const nav = [{ section: "Administration", items: [{ href: "/admin" }] }];
  assert.deepEqual(visibleNavigation(nav, as("viewer")), []);
});
