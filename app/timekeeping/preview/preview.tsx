"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import Timekeeping from "../timekeeping";
import {
  createEmployeePreview,
  type PreviewScenario,
} from "@/lib/timekeeping/preview";
export default function EmployeePreview() {
  const [scenario, setScenario] = useState<PreviewScenario>("first-visit"),
    [revision, setRevision] = useState(0);
  const request = useMemo(
    () => createEmployeePreview(scenario),
    [scenario, revision],
  );
  return (
    <>
      <aside
        className="tk-preview-banner"
        aria-label="Employee preview controls"
      >
        <div>
          <strong>EMPLOYEE PREVIEW · Taylor Example</strong>
          <p>
            Practice with fictional data. Changes stay in this tab; signing is
            simulated and nothing is sent to payroll or staff.
          </p>
        </div>
        <div className="tk-preview-controls">
          <label>
            Try a scenario
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value as PreviewScenario)}
            >
              <option value="first-visit">First visit · set usual hours</option>
              <option value="completed-period">
                Completed period · sign & submit
              </option>
            </select>
          </label>
          <button onClick={() => setRevision((r) => r + 1)}>
            Reset preview
          </button>
          <Link href="/timekeeping">Exit preview</Link>
        </div>
      </aside>
      <Timekeeping key={`${scenario}:${revision}`} request={request} />
    </>
  );
}
