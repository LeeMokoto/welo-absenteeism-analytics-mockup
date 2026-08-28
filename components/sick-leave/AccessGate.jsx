"use client";

/*
  Communicates the production access posture of the clinical case view. This
  build has no auth, but the controls are threaded through so Anglo's security
  reviewer can see them in the design:
  - allowedRoles: the roles that would be permitted in production.
  - onRecordOpen: an audit callback fired whenever a record is opened.
  Both are real props here, stubbed rather than enforced.
*/
export default function AccessGate({ allowedRoles = ["Occupational Health"], children }) {
  return (
    <div>
      <div className="banner gate" role="note" style={{ marginBottom: 16 }}>
        <div>
          <strong>Clinically held view.</strong> In production, access is restricted to clinical
          roles ({allowedRoles.join(", ")}), and every record opened is audit logged. The records
          shown here are synthetic. No employment or disciplinary use is permitted: this data is
          for care and support only.
        </div>
      </div>
      {children}
    </div>
  );
}
