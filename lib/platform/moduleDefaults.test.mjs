import { test } from "node:test";
import assert from "node:assert/strict";

import { ALWAYS_ON_DEFAULT, controlCentreDefault } from "./moduleDefaults.js";

/*
  A client tenant must not inherit the control centre.

  Testable only here: for a real tenant the session layer refuses before any
  route reads the module flag, so this cannot be observed through a page. The
  rule is a governance one, so it gets asserted rather than assumed.
*/
test("a synthetic tenant gets the control centre by default", () => {
  assert.equal(controlCentreDefault(true), "1");
});

test("a real tenant does not, because the actions store is still mocked", () => {
  assert.equal(controlCentreDefault(false), "0");
});

test("anything other than an explicit true is treated as a real tenant", () => {
  // Fails closed on a value nobody meant: undefined, a string, a truthy object.
  for (const value of [undefined, null, "true", "1", 1, {}, ""]) {
    assert.equal(controlCentreDefault(value), "0", `${JSON.stringify(value)} opened the module`);
  }
});

test("the modules that need no store are on for everybody", () => {
  assert.equal(ALWAYS_ON_DEFAULT, "1");
});
