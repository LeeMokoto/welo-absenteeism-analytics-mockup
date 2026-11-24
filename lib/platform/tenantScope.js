import { scopedStorageKey } from "./tenants.js";

/*
  The tenant whose browser storage the client stores read and write.

  The shell sets it as it renders, before any screen's effects run, so every
  store that keeps drafts in the browser keeps them per tenant: an
  intervention drafted for one demo group never appears in another's list.
  The base tenant keeps the keys it always had (scopedStorageKey), so nothing
  already saved in a browser is lost.

  Switching tenant reloads the page (TenantSwitch), so no screen carries one
  tenant's state into the other.
*/
let current = null;

export function setTenantScope(key) {
  current = key || null;
}

export function storageKey(base) {
  return scopedStorageKey(base, current);
}
