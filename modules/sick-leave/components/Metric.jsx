"use client";

import { useState } from "react";

// A header-band figure. `hover` is optional detail revealed on hover / focus
// (used for the cost split into paid days and cover).
export default function Metric({ label, value, unit, hover }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="metric"
      tabIndex={hover ? 0 : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {unit ? <div className="metric-unit">{unit}</div> : null}
      {hover && open ? <div className="metric-hover">{hover}</div> : null}
    </div>
  );
}
