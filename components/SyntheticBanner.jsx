// Synthetic-data label for a tenant whose data is not real.
//
// The platform's tenant manifest declares whether a tenant is synthetic; the
// demo and staging tenants are, client tenants are not. Here that is read from
// WELO_TENANT_SYNTHETIC on the server.
//
// It defaults to shown: an unset value means the label appears. Failing toward
// disclosure is deliberate, because the cost of labelling real data as
// synthetic is embarrassment, and the cost of presenting synthetic data as
// real is a client acting on numbers that mean nothing.
//
// Kept to a slim strip rather than a banner: it has to be visible on every
// screen, so it should not shout on any of them.
export function tenantIsSynthetic() {
  const v = (process.env.WELO_TENANT_SYNTHETIC || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(v)) return false;
  return true;
}

export default function SyntheticBanner({ synthetic }) {
  if (!synthetic) return null;
  return (
    <div className="synthetic-strip" role="note">
      <span>Synthetic sample data. No client data is present.</span>
    </div>
  );
}
