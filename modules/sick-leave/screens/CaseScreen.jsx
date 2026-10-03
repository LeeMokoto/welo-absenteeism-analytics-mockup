"use client";

import { useMemo, useState, useCallback } from "react";
import SectionHeader from "../components/SectionHeader";
import AccessGate from "../components/AccessGate";
import AuditTrail from "../components/AuditTrail";
import EmployeeSelector from "../components/EmployeeSelector";
import CaseRecord from "../components/CaseRecord";
import AgentPanel from "../components/AgentPanel";
import { AGENTS } from "@/modules/sick-leave/agentMeta";
import { buildCaseContext } from "@/modules/sick-leave/context";
import { employeeIndex, meta } from "@/modules/sick-leave/data/sampleData";
import { employees } from "@/modules/sick-leave/data/sampleData.employees";
import { eventsByEmployee } from "@/modules/sick-leave/data/sampleData.events";

const ALLOWED_ROLES = ["Occupational Health"];

export default function CaseScreen({ agentsAvailable }) {
  const byId = useMemo(() => {
    const m = new Map();
    for (const e of employees) m.set(e.employeeId, e);
    return m;
  }, []);

  const [selectedId, setSelectedId] = useState(null);
  const [audit, setAudit] = useState([]);

  // Stubbed audit callback, threaded through as the production hook would be.
  const onRecordOpen = useCallback((employeeId) => {
    const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    setAudit((prev) => [{ timestamp, employeeId, role: "Occupational Health" }, ...prev]);
  }, []);

  const select = useCallback(
    (id) => {
      setSelectedId(id);
      onRecordOpen(id);
    },
    [onRecordOpen]
  );

  const record = selectedId ? byId.get(selectedId) : null;
  const events = selectedId ? eventsByEmployee[selectedId] || [] : [];

  return (
    <section>
      <SectionHeader title="Case view" sub="Clinically held, individual level" />
      <AccessGate allowedRoles={ALLOWED_ROLES}>
        <div className="case-grid">
          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            <EmployeeSelector index={employeeIndex} meta={meta} selectedId={selectedId} onSelect={select} />
            <AuditTrail entries={audit} />
          </div>

          <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
            {!record ? (
              <div className="card">
                <div className="card-title">Select a record</div>
                <p className="card-note">
                  Choose a synthetic record from the list. Opening a record writes to the access log
                  on the left, as it would in production.
                </p>
              </div>
            ) : (
              <>
                <CaseRecord record={record} events={events} />
                <AgentPanel
                  agent={AGENTS.case.id}
                  roleTag={AGENTS.case.roleTag}
                  description={AGENTS.case.description}
                  chips={AGENTS.case.chips}
                  available={agentsAvailable}
                  getContext={() => buildCaseContext(record, events)}
                />
              </>
            )}
          </div>
        </div>
      </AccessGate>
    </section>
  );
}
