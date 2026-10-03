/*
  Module registry.

  The one place that knows which modules exist. The shell asks this for the
  modules a tenant has enabled and builds navigation from what comes back, so
  adding a module is: write a module.js, add it here, add its manifest flag.
  Nothing in the shell changes.
*/

import absenceModule from "./absence/module";
import sickLeaveModule from "./sick-leave/module";

export const ALL_MODULES = [absenceModule, sickLeaveModule];

export function enabledModules(manifest) {
  return ALL_MODULES.filter((m) => manifest.modules?.[m.enabledBy]);
}

export function moduleById(id) {
  return ALL_MODULES.find((m) => m.id === id) || null;
}
