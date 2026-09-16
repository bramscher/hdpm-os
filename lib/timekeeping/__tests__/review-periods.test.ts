import { describe, expect, it } from "vitest";
import {
  nextReviewSheet,
  reviewPeriods,
  selectedReviewPeriod,
} from "../review-periods";
import type { Sheet } from "../model";

const sheets = [
  {
    period_start: "2026-09-01",
    period_end: "2026-09-15",
    state: "submitted" as const,
  },
  {
    period_start: "2026-09-16",
    period_end: "2026-09-30",
    state: "draft" as const,
  },
  {
    period_start: "2026-09-01",
    period_end: "2026-09-15",
    state: "approved" as const,
  },
];

describe("review pay periods", () => {
  it("groups employees into distinct periods, newest first", () => {
    expect(reviewPeriods(sheets)).toEqual(["2026-09-16", "2026-09-01"]);
  });

  it("keeps unfinished payroll visible when a new pay period opens", () => {
    expect(selectedReviewPeriod(sheets, "", "2026-09-16")).toBe("2026-09-01");
    const complete = sheets.map((s) =>
      s.period_start === "2026-09-01"
        ? { ...s, state: "approved" as const }
        : s,
    );
    expect(selectedReviewPeriod(complete, "", "2026-09-16")).toBe("2026-09-16");
    // A user-selected period remains selected after its final approval.
    expect(selectedReviewPeriod(complete, "2026-09-01", "2026-09-16")).toBe(
      "2026-09-01",
    );
  });

  it("respects an explicit current period and ignores unavailable selections", () => {
    expect(selectedReviewPeriod(sheets, "2026-09-16", "2026-09-16")).toBe(
      "2026-09-16",
    );
    expect(selectedReviewPeriod(sheets, "2025-01-01", "2026-09-16")).toBe(
      "2026-09-01",
    );
  });

  it("handles an empty roster and a year boundary without mixing periods", () => {
    expect(selectedReviewPeriod([], "", "2027-01-01")).toBe("2027-01-01");
    expect(
      selectedReviewPeriod(
        [
          {
            period_start: "2026-12-16",
            period_end: "2026-12-31",
            state: "returned",
          },
          {
            period_start: "2027-01-01",
            period_end: "2027-01-15",
            state: "draft",
          },
        ],
        "",
        "2027-01-01",
      ),
    ).toBe("2026-12-16");
  });
});

describe("approve and next review queue", () => {
  const sheet = (name: string, overrides: Partial<Sheet> = {}): Sheet => ({
    id: name,
    employee_id: name,
    employee_name: name,
    period_start: "2026-09-01",
    period_end: "2026-09-15",
    state: "submitted",
    review_manager_id: "manager",
    days: [],
    note: "",
    pay_basis: "hourly",
    payroll_id: name,
    version: 1,
    reason: "",
    approved_by: null,
    approved_at: null,
    ...overrides,
  });
  it("advances alphabetically from refreshed data and wraps to earlier pending names", () => {
    const rows = [
      sheet("Zoe"),
      sheet("Amy"),
      sheet("Ben", { state: "approved" }),
    ];
    expect(nextReviewSheet(rows, sheet("Ben"), "manager")?.id).toBe("Zoe");
    expect(nextReviewSheet(rows, sheet("Zoe"), "manager")?.id).toBe("Amy");
  });
  it("skips other periods, ineligible states, other managers, and the reviewer's own sheet", () => {
    const rows = [
      sheet("Amy"),
      sheet("Ben", { period_start: "2026-09-16" }),
      sheet("Cara", { state: "draft" }),
      sheet("Dee", { state: "returned" }),
      sheet("Eve", { state: "approved" }),
      sheet("Finn", { review_manager_id: "another-manager" }),
      sheet("Manager", { employee_id: "manager" }),
    ];
    expect(nextReviewSheet(rows, sheet("Amy"), "manager")).toBeNull();
  });
  it("respects the employee filter and finishes without selecting another employee", () => {
    expect(
      nextReviewSheet([sheet("Ben")], sheet("Amy"), "manager", "Amy"),
    ).toBeNull();
    expect(nextReviewSheet([], sheet("Amy"), "manager")).toBeNull();
  });
});
