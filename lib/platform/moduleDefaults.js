/*
  Which modules a tenant gets when nobody says.

  Its own file, with no imports, for two reasons. It is a governance rule rather
  than plumbing, so it should be named and testable on its own. And
  manifest.js imports the module registry through the webpack alias, which the
  Node test runner cannot resolve, so a rule left in there could only be tested
  through a rendered page. For a real tenant that is impossible: the session
  layer refuses first and the route redirects before the module flag is ever
  read, so the only way to assert this is directly.
*/

/*
  The control centre defaults on for a synthetic tenant and off for a real one.

  The actions store is mocked and browser-local. A client tenant provisioned on
  defaults would be handed a register that files nothing, which is worse than
  not having the screen. A synthetic tenant is exactly where a mocked store is
  acceptable, and it is also the tenant the module exists to demonstrate.

  Same rule as the mocked sign-in: the switch that makes a tenant real is the
  switch that takes the mock away, and it fails closed.
*/
export function controlCentreDefault(synthetic) {
  return synthetic === true ? "1" : "0";
}

/*
  The modules that are on for everybody. Absence and sick leave read committed
  aggregates and need no store, so there is nothing to fail closed about.
*/
export const ALWAYS_ON_DEFAULT = "1";
