import { describe, expect, it } from "vitest";
import { reviewPeriods, selectedReviewPeriod } from "../review-periods";

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
