import { describe, expect, it } from "vitest";
import type { MonthResult, Worklog } from "./types";
import {
  qualityMessage,
  worklogQuality,
  absenceDays,
  baseSources,
  buildRows,
  dayTotals,
  filterRows,
  freeSources,
  keysBySource,
  matchedRowIds,
  planCellEdit,
  updateSourceWorklogs,
  visibleDays
} from "./timesheet";

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
  absences: [],
  absenceErrors: [],
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
  const rows = buildRows(baseSources(result));

  it("keeps one row per source and issue, most logged time first", () => {
    // 2h, 1.5h, 15m, then the extra-JQL issue with no time.
    expect(rows.map((row) => row.id)).toEqual(["a:SUP-10", "a:SUP-9", "b:SUP-9", "a:INT-1"]);
  });

  it("groups worklogs by day and totals them", () => {
    const sup9 = rows.find((row) => row.id === "a:SUP-9")!;
    expect(sup9.cells["2026-10-05"]).toHaveLength(2);
    expect(sup9.total).toBe(5400);
    expect(rows.find((row) => row.id === "a:INT-1")!.total).toBe(0);
  });

  it("builds a free JQL list from its issues plus your worklogs from the month load", () => {
    const free = buildRows(
      freeSources(result, {
        errors: [],
        sources: [{ sourceId: "a", sourceName: "a", truncated: false, issues: [issue("a", "SUP-9"), issue("a", "NEW-5")] }]
      })
    );
    // Only the JQL's issues; SUP-9 keeps its 1.5h, NEW-5 has no time yet; source b isn't in the result.
    expect(free.map((row) => [row.id, row.total])).toEqual([
      ["a:SUP-9", 5400],
      ["a:NEW-5", 0]
    ]);
  });

  it("sends keys per source to a JQL filter and filters by its matches", () => {
    expect(keysBySource(rows)).toEqual({ a: ["SUP-10", "SUP-9", "INT-1"], b: ["SUP-9"] });
    // The same key in another Jira only matches there.
    const matched = matchedRowIds({ a: ["INT-1"], b: ["SUP-9"] });
    expect(filterRows(rows, matched, "").map((row) => row.id)).toEqual(["b:SUP-9", "a:INT-1"]);
    expect(filterRows(rows, new Set(), "")).toHaveLength(0);
  });

  it("filters by search text", () => {
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

describe("worklogQuality", () => {
  const logged = (date: string, created: string, seconds = 3600) => ({ ...wl("1", date, seconds), created });

  it("is 100% when every worklog is entered on its own day", () => {
    expect(worklogQuality([logged("2026-10-05", "2026-10-05T18:00:00.000+0200"), logged("2026-10-06", "2026-10-06T09:30:00.000+0200")])).toEqual({
      percent: 100,
      averageDelay: 0,
      count: 2
    });
  });

  it("weights the delay by logged time and loses 10 points per day", () => {
    // 6h on time, 2h entered 4 days later: (0*6 + 4*2) / 8 = 1 day -> 90%
    const quality = worklogQuality([
      logged("2026-10-05", "2026-10-05T18:00:00.000+0200", 6 * 3600),
      logged("2026-10-05", "2026-10-09T10:00:00.000+0200", 2 * 3600)
    ])!;
    expect(quality.averageDelay).toBe(1);
    expect(quality.percent).toBe(90);
    expect(worklogQuality([logged("2026-10-01", "2026-10-31T10:00:00.000+0200")])!.percent).toBe(0);
  });

  it("counts worklogs entered in advance as on time and skips unknown creation dates", () => {
    expect(worklogQuality([logged("2026-10-09", "2026-10-05T10:00:00.000+0200")])!.percent).toBe(100);
    expect(worklogQuality([{ ...wl("1", "2026-10-05", 3600), created: "" }])).toBeNull();
    expect(worklogQuality([])).toBeNull();
  });

  it("has a motivating line for every level", () => {
    expect(qualityMessage(100)).toBe("You are the best!");
    expect(qualityMessage(95)).toMatch(/Excellent/);
    expect(qualityMessage(80)).toMatch(/Good/);
    expect(qualityMessage(60)).toMatch(/same day/);
    expect(qualityMessage(30)).toMatch(/behind/);
    expect(qualityMessage(0)).toMatch(/Catch up/);
  });
});

describe("absenceDays", () => {
  const absence = (key: string, from: string, to: string) => ({ key, summary: key, status: "", from, to, url: "" });

  it("lists every day of the month an absence covers, clipped to the month", () => {
    const days = absenceDays(
      [absence("CAL-1", "2026-10-08", "2026-10-09"), absence("CAL-2", "2026-09-28", "2026-10-01"), absence("CAL-3", "2026-11-02", "2026-11-03")],
      "2026-10"
    );
    expect([...days.keys()]).toEqual(["2026-10-01", "2026-10-08", "2026-10-09"]);
    expect(days.get("2026-10-01")![0].key).toBe("CAL-2");
  });

  it("keeps overlapping absences on the same day", () => {
    const days = absenceDays([absence("CAL-1", "2026-10-08", "2026-10-08"), absence("CAL-2", "2026-10-08", "2026-10-10")], "2026-10");
    expect(days.get("2026-10-08")!.map((item) => item.key)).toEqual(["CAL-1", "CAL-2"]);
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

  it("lowers a single worklog by updating it, never deleting", () => {
    const only = wl("1", "2026-10-05", 7200);
    expect(planCellEdit([only], 1800)).toEqual([{ kind: "update", worklog: only, seconds: 1800 }]);
    expect(planCellEdit([only], 60)).toEqual([{ kind: "update", worklog: only, seconds: 60 }]);
  });

  it("shrinks the latest worklog that can absorb the whole reduction", () => {
    const early = wl("1", "2026-10-05", 3600, "09:00");
    const late = wl("2", "2026-10-05", 1800, "14:00");
    // 1.5h -> 1h: the 30m worklog cannot give 30m and stay >= 1m, so the 1h one shrinks.
    expect(planCellEdit([early, late], 3600)).toEqual([{ kind: "update", worklog: early, seconds: 1800 }]);
    expect(planCellEdit([early, late], 4500)).toEqual([{ kind: "update", worklog: late, seconds: 900 }]);
  });

  it("spreads a large reduction from the newest worklogs, keeping each at 1 minute", () => {
    const a = wl("1", "2026-10-05", 1800, "09:00");
    const b = wl("2", "2026-10-05", 1800, "11:00");
    const c = wl("3", "2026-10-05", 1800, "14:00");
    // 1.5h -> 15m: nobody can give 75m alone.
    expect(planCellEdit([a, b, c], 900)).toEqual([
      { kind: "update", worklog: c, seconds: 60 },
      { kind: "update", worklog: b, seconds: 60 },
      { kind: "update", worklog: a, seconds: 780 }
    ]);
  });

  it("deletes only when the target is too small to keep every worklog", () => {
    const a = wl("1", "2026-10-05", 1800, "09:00");
    const b = wl("2", "2026-10-05", 1800, "11:00");
    const c = wl("3", "2026-10-05", 1800, "14:00");
    expect(planCellEdit([a, b, c], 120)).toEqual([
      { kind: "delete", worklog: c },
      { kind: "update", worklog: b, seconds: 60 },
      { kind: "update", worklog: a, seconds: 60 }
    ]);
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
