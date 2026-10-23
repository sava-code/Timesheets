import { describe, expect, it } from "vitest";
import type { MonthResult, Worklog } from "./types";
import { buildRows, dayTotals, filterRows, planCellEdit, updateSourceWorklogs, visibleDays } from "./timesheet";

const wl = (id: string, date: string, seconds: number, time = "09:00", comment = ""): Worklog => ({
  id,
  issueKey: "SUP-1",
  date,
  started: `${date}T${time}:00.000+0200`,
  seconds,
  comment
});

const issue = (sourceId: string, key: string) => ({
  sourceId,
  sourceName: sourceId,
  key,
  summary: `Summary ${key}`,
  projectKey: key.split("-")[0],
  status: "",
  url: ""
});

const result: MonthResult = {
  month: "2026-10",
  configured: 2,
  errors: [],
  sources: [
    {
      sourceId: "a",
      sourceName: "a",
      user: "",
      issues: [issue("a", "SUP-10"), issue("a", "SUP-9"), issue("a", "INT-1")],
      worklogs: [
        { ...wl("1", "2026-10-05", 3600), issueKey: "SUP-9" },
        { ...wl("2", "2026-10-05", 1800, "13:00"), issueKey: "SUP-9" },
        { ...wl("3", "2026-10-06", 7200), issueKey: "SUP-10" }
      ]
    },
    {
      sourceId: "b",
      sourceName: "b",
      user: "",
      // Same key in another Jira must stay a separate row.
      issues: [issue("b", "SUP-9")],
      worklogs: [{ ...wl("1", "2026-10-04", 900), issueKey: "SUP-9" }]
    }
  ]
};

describe("buildRows", () => {
  const rows = buildRows(result, [{ sourceId: "a", key: "INT-1" }]);

  it("keeps one row per source and issue, sorted by project then number", () => {
    expect(rows.map((row) => row.id)).toEqual(["a:INT-1", "a:SUP-9", "b:SUP-9", "a:SUP-10"]);
  });

  it("groups worklogs by day and totals them", () => {
    const sup9 = rows.find((row) => row.id === "a:SUP-9")!;
    expect(sup9.cells["2026-10-05"]).toHaveLength(2);
    expect(sup9.total).toBe(5400);
    expect(rows.find((row) => row.id === "a:INT-1")!.pinned).toBe(true);
  });

  it("filters by project keys and search text", () => {
    expect(filterRows(rows, { id: "f", label: "", projectKeys: ["INT"] }, "")).toHaveLength(1);
    expect(filterRows(rows, null, "sup-1")).toHaveLength(1);
    expect(filterRows(rows, null, "summary")).toHaveLength(4);
  });

  it("hides empty weekends but keeps weekends with time", () => {
    const days = visibleDays("2026-10", rows, false);
    expect(days.some((day) => day.key === "2026-10-04")).toBe(true); // Sunday with 15m
    expect(days.some((day) => day.key === "2026-10-03")).toBe(false); // empty Saturday
    expect(days).toHaveLength(23);
    expect(dayTotals(rows, days)["2026-10-05"]).toBe(5400);
  });
});

describe("planCellEdit", () => {
  it("creates a worklog in an empty cell", () => {
    expect(planCellEdit([], 5400)).toEqual([{ kind: "create", seconds: 5400 }]);
    expect(planCellEdit([], 0)).toEqual([]);
  });

  it("does nothing when the value is unchanged", () => {
    expect(planCellEdit([wl("1", "2026-10-05", 3600)], 3600)).toEqual([]);
  });

  it("adds extra time to the latest worklog", () => {
    const early = wl("1", "2026-10-05", 3600, "09:00");
    const late = wl("2", "2026-10-05", 1800, "14:00");
    expect(planCellEdit([late, early], 7200)).toEqual([{ kind: "update", worklog: late, seconds: 3600 }]);
  });

  it("removes time from the latest worklogs first, deleting ones that reach zero", () => {
    const early = wl("1", "2026-10-05", 3600, "09:00");
    const late = wl("2", "2026-10-05", 1800, "14:00");
    expect(planCellEdit([early, late], 2700)).toEqual([
      { kind: "delete", worklog: late },
      { kind: "update", worklog: early, seconds: 2700 }
    ]);
    expect(planCellEdit([early, late], 3600)).toEqual([{ kind: "delete", worklog: late }]);
  });

  it("deletes every worklog when the cell is cleared", () => {
    const early = wl("1", "2026-10-05", 3600, "09:00");
    const late = wl("2", "2026-10-05", 1800, "14:00");
    expect(planCellEdit([early, late], 0)).toEqual([
      { kind: "delete", worklog: late },
      { kind: "delete", worklog: early }
    ]);
  });
});

describe("updateSourceWorklogs", () => {
  it("changes only the given source", () => {
    const next = updateSourceWorklogs(result, "b", () => []);
    expect(next.sources[1].worklogs).toEqual([]);
    expect(next.sources[0]).toBe(result.sources[0]);
  });
});
