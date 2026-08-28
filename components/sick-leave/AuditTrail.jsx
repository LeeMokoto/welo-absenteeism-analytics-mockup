"use client";

// A simulated audit trail so the reviewer can see the control exists in the
// design. Entries are appended by the onRecordOpen callback in the case screen.
export default function AuditTrail({ entries }) {
  return (
    <div className="card cream" style={{ padding: 12 }}>
      <div className="mono">Access log (simulated)</div>
      <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
        {entries.length === 0 ? (
          <div className="caption">No records opened yet.</div>
        ) : (
          entries.slice(0, 6).map((e, i) => (
            <div key={i} className="caption" style={{ lineHeight: 1.4 }}>
              Record opened, {e.timestamp}, id {e.employeeId}, role: {e.role}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
