// Governance note at the foot of the page (compliance requirement 9.6).
export default function GovernanceNote() {
  return (
    <footer className="govnote">
      <div className="mono" style={{ marginBottom: 8 }}>Governance</div>
      <p style={{ margin: "0 0 8px" }}>
        Data residency remains in South Africa. Welo operates as operator, with the employer
        as responsible party. Health data is processed at ICD-10 chapter level outside the
        clinical case view, and cohort cells under five employees are suppressed and shown as
        n&lt;5. The case view is access controlled and audit logged.
      </p>
      <p style={{ margin: 0 }}>
        Sick leave intelligence here is oriented at care pathways and workforce planning. It is
        not used for HR review or disciplinary purposes. Agents propose, and a human decides the
        action. POPIA section 71 restricts decisions based solely on automated processing.
      </p>
    </footer>
  );
}
