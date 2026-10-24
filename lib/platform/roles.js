/*
  Roles and permissions.

  The identity federation is mocked in this tenant. The authorisation is not:
  these permissions are enforced server side on every route and every API
  handler, so when a real identity provider replaces the account picker, the
  only thing that changes is where the role comes from.

  That split is deliberate. Mocking authorisation as well would mean shipping a
  demo whose access controls had never run, and then discovering what they do
  on a client's data.

  The roles are the seven in the solution design, with their wording kept so a
  reader can line them up.
*/

export const PERMISSIONS = {
  // Reading
  VIEW_OVERVIEW: "view.overview",
  VIEW_COHORTS: "view.cohorts",
  VIEW_CONDITIONS: "view.conditions",
  VIEW_CASE: "view.case",
  VIEW_MODEL_CARD: "view.model_card",
  VIEW_DATA: "view.data",
  VIEW_ADMIN: "view.admin",
  // Agents
  USE_AGENTS: "use.agents",
  // Control centre
  CONTROL_VIEW: "control.view",
  CONTROL_CREATE: "control.create",
  CONTROL_APPROVE: "control.approve",
};

const P = PERMISSIONS;

/*
  Viewer is the floor and every other client role builds on it, except the two
  that deliberately do not: Approver holds approval and nothing else, and Welo
  support holds nothing at all.
*/
const VIEWER = [P.VIEW_OVERVIEW, P.VIEW_COHORTS];

export const ROLES = {
  viewer: {
    key: "viewer",
    label: "Viewer",
    holder: "Senior leaders and site managers",
    access: "Overview and module dashboards at cohort level.",
    permissions: VIEWER,
  },

  analyst: {
    key: "analyst",
    label: "Analyst",
    holder: "HR, wellness and occupational health staff",
    access:
      "Viewer access plus cohort comparison, conditions, the model card and the Case Assistant where enabled.",
    // VIEW_CASE is here because the solution design puts occupational health
    // staff in this role and gives the role the Case Assistant, which sits on
    // an individual case view. The same section also says no role sees data
    // below cohort level. Both cannot hold. See docs/design-alignment.md.
    // CONTROL_CREATE sits here because this role is the one that acts on
    // cohorts. It was held by nobody, which made the permission dead and left
    // creation gated on CONTROL_VIEW instead: the Approver, whose whole purpose
    // is to approve what it did not create, could do both.
    permissions: [
      ...VIEWER,
      P.VIEW_CONDITIONS,
      P.VIEW_CASE,
      P.VIEW_MODEL_CARD,
      P.USE_AGENTS,
      P.CONTROL_VIEW,
      P.CONTROL_CREATE,
    ],
  },

  data_owner: {
    key: "data_owner",
    label: "Data owner",
    holder: "The named person responsible for uploads",
    access: "The Data section, plus dashboards as a viewer.",
    permissions: [...VIEWER, P.VIEW_DATA],
  },

  client_admin: {
    key: "client_admin",
    label: "Client admin",
    holder: "Client IT or the programme owner",
    access:
      "Settings, the model card and upload history; read-only tenant configuration and audit.",
    // No cohort comparison, no conditions, no case view: administering a
    // tenant is not a reason to read its health data.
    permissions: [P.VIEW_OVERVIEW, P.VIEW_ADMIN, P.VIEW_MODEL_CARD, P.VIEW_DATA],
  },

  approver: {
    key: "approver",
    label: "Approver",
    holder: "A named client group, control centre only",
    access: "Approves plans and outbound tasks for interventions the approver did not create.",
    // Approve without create, on purpose. A role that can do both cannot
    // satisfy "approval is separate from creation", which is the whole point
    // of having this role at all.
    permissions: [...VIEWER, P.CONTROL_VIEW, P.CONTROL_APPROVE],
  },

  welo_support: {
    key: "welo_support",
    label: "Welo support",
    holder: "Welo engineers",
    access:
      "No application access by default. Tenant access comes through a Privileged Access Manager grant, which this tenant does not implement.",
    permissions: [],
  },

  prospect: {
    key: "prospect",
    label: "Prospect",
    holder: "Demo users",
    access: "The demo tenant only, as an analyst, on synthetic data.",
    // As an analyst, minus the case view: a demo visitor has no business on an
    // individual record even a synthetic one. Creation is included so a
    // walkthrough can actually use the control centre; the store is mocked and
    // browser-local, so nothing is filed.
    permissions: [
      ...VIEWER,
      P.VIEW_CONDITIONS,
      P.VIEW_MODEL_CARD,
      P.USE_AGENTS,
      P.CONTROL_VIEW,
      P.CONTROL_CREATE,
    ],
  },
};

export const ROLE_KEYS = Object.keys(ROLES);

export function role(key) {
  return ROLES[key] || null;
}

export function can(session, permission) {
  if (!session?.role) return false;
  const r = ROLES[session.role];
  if (!r) return false;
  return r.permissions.includes(permission);
}

export function canAll(session, permissions) {
  return (permissions || []).every((p) => can(session, p));
}

export function canAny(session, permissions) {
  return (permissions || []).some((p) => can(session, p));
}

/*
  Which permission a destination needs.

  Keyed by the href the navigation uses, so one table drives both the menu and
  the route guard. A menu that hides what a guard would refuse is a courtesy; a
  menu that hides what a guard would allow is a bug nobody notices.
*/
export const ROUTE_PERMISSIONS = {
  "/": P.VIEW_OVERVIEW,
  "/absence": P.VIEW_COHORTS,
  "/absence/cohorts": P.VIEW_COHORTS,
  "/absence/outcomes": P.VIEW_COHORTS,
  "/absence/operations": P.VIEW_COHORTS,
  "/sick-leave": P.VIEW_COHORTS,
  "/sick-leave/case": P.VIEW_CASE,
  "/sick-leave/ops": P.VIEW_COHORTS,
  "/control-centre": P.CONTROL_VIEW,
  "/control-centre/playbooks": P.CONTROL_VIEW,
  "/control-centre/alerts": P.CONTROL_VIEW,
  "/control-centre/briefing": P.CONTROL_VIEW,
  "/admin": P.VIEW_ADMIN,
};

export function permissionFor(href) {
  return ROUTE_PERMISSIONS[href] || null;
}

export function canVisit(session, href) {
  const needed = permissionFor(href);
  // A route with no entry is not implicitly public. Anything reachable has to
  // be listed, so adding a screen without a permission fails closed.
  if (!needed) return false;
  return can(session, needed);
}

// Navigation filtered to what this session may actually open.
export function visibleNavigation(navigation, session) {
  return (navigation || [])
    .map((group) => ({
      ...group,
      items: (group.items || []).filter((item) => item.external || canVisit(session, item.href)),
    }))
    .filter((group) => group.items.length > 0);
}
