import { monthDays } from "./time";
import { describe, expect, it } from "vitest";
import type { MonthResult, Worklog } from "./types";
import {
  qualityForDelay,
  qualityMessage,
  qualityScaleText,
  workingDaysBetween,
  timeliness,
  absenceDays,
  allocationCategory,
  DEFAULT_ALLOCATION_RULES,
  worklogAllocation,
  topClients,
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

describe("timeliness", () => {
  const logged = (date: string, created: string, seconds = 3600) => ({ ...wl("1", date, seconds), created });
  const vacation = { key: "CAL-1", summary: "Vacation", status: "", from: "2026-10-12", to: "2026-10-16", url: "" };
  // Every working day of October 2026 fully logged, entered the same day.
  const fullMonth = (except: string[] = []) =>
    monthDays("2026-10")
      .filter((day) => !day.isWeekend && !except.includes(day.key))
      .map((day) => logged(day.key, `${day.key}T18:00:00.000+0200`, 8 * 3600));

  it("counts working days, skipping weekends and absences", () => {
    expect(workingDaysBetween("2026-10-09", "2026-10-12")).toBe(1); // Fri -> Mon
    expect(workingDaysBetween("2026-10-05", "2026-10-05")).toBe(0); // same day
    expect(workingDaysBetween("2026-10-05", "2026-10-19")).toBe(10); // two weeks
    expect(workingDaysBetween("2026-10-10", "2026-10-11")).toBe(0); // Sat -> Sun
    expect(workingDaysBetween("2026-10-09", "2026-10-05")).toBe(0); // entered in advance
    expect(workingDaysBetween("2026-09-30", "2026-10-02")).toBe(2); // across months
    const off = (key: string) => key >= "2026-10-12" && key <= "2026-10-16";
    expect(workingDaysBetween("2026-10-09", "2026-10-19", off)).toBe(1); // Fri, a week off, Mon
  });

  it("places each delay on the scale", () => {
    expect([0, 3, 4, 5, 6, 10, 12, 15, 18, 20, 21, 60].map(qualityForDelay)).toEqual([100, 100, 90, 90, 70, 70, 50, 50, 30, 30, 10, 10]);
  });

  it("scores each worklog by its own delay and averages by hours", () => {
    // 4h entered 2 working days late (100%), 1h entered 8 working days late (70%): (100*4 + 70*1) / 5 = 94%.
    const result = timeliness({
      worklogs: [logged("2026-10-01", "2026-10-05T10:00:00.000+0200", 4 * 3600), logged("2026-10-01", "2026-10-13T10:00:00.000+0200", 3600)],
      month: "2026-10",
      today: "2026-10-01",
      normSeconds: 8 * 3600
    })!;
    expect(result.percent).toBe(94);
    expect(result.logged).toEqual({ percent: 94, seconds: 5 * 3600, count: 2 });
    expect(result.missing).toBeNull(); // nothing is due before today
    // Worklogs without a creation date are skipped.
    expect(timeliness({ worklogs: [{ ...wl("1", "2026-10-01", 3600), created: "" }], month: "2026-10", today: "2026-10-01", normSeconds: 8 * 3600 })).toBeNull();
  });

  it("scores time not logged yet as if it were logged today, day by day", () => {
    // Today Fri 2026-10-30. Mon 26 – Thu 29 not logged at all: 1-4 working days ago -> 100, 100, 100, 90.
    const missing = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"];
    const result = timeliness({ worklogs: fullMonth([...missing, "2026-10-30"]), month: "2026-10", today: "2026-10-30", normSeconds: 8 * 3600 })!;
    expect(result.missing).toEqual({ percent: (100 * 3 + 90) / 4, seconds: 32 * 3600, count: 4 });
    expect(result.logged!.percent).toBe(100);
    // 17 logged days at 100% and 4 missing days averaging 97.5%, all 8h each.
    expect(result.percent).toBeCloseTo((17 * 100 + 3 * 100 + 90) / 21, 6);
    // Today itself is never counted as missing.
    expect(timeliness({ worklogs: fullMonth(["2026-10-30"]), month: "2026-10", today: "2026-10-30", normSeconds: 8 * 3600 })!.missing).toBeNull();
  });

  it("counts a short day per day: extra hours on one day don't cover another", () => {
    const worklogs = fullMonth(["2026-10-01"]).map((item) => (item.date === "2026-10-02" ? { ...item, seconds: 12 * 3600 } : item));
    worklogs.push(logged("2026-10-01", "2026-10-01T18:00:00.000+0200", 6 * 3600));
    const result = timeliness({ worklogs, month: "2026-10", today: "2026-10-30", normSeconds: 8 * 3600 })!;
    // Only the 2h missing on Oct 1 count; Oct 1 is 21 working days before Oct 30 -> 10%.
    expect(result.missing).toEqual({ percent: 10, seconds: 2 * 3600, count: 1 });
    // Mid-month it would still score 70%: Oct 1 -> Oct 9 is 6 working days.
    expect(timeliness({ worklogs, month: "2026-10", today: "2026-10-09", normSeconds: 8 * 3600 })!.missing!.percent).toBe(70);
  });

  it("leaves absences out of the missing time and of the delays", () => {
    const vacationDays = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];
    const worklogs = fullMonth([...vacationDays, "2026-10-09"]);
    // Friday's time entered on the Monday after the vacation week: 1 working day late, not 6.
    worklogs.push(logged("2026-10-09", "2026-10-19T09:00:00.000+0200", 8 * 3600));
    const result = timeliness({ worklogs, month: "2026-10", today: "2026-10-30", normSeconds: 8 * 3600, absences: [vacation] })!;
    expect(result.missing).toBeNull();
    expect(result.percent).toBe(100);
    // Without the absence, the vacation week is missing and Friday's worklog is 6 days late.
    const without = timeliness({ worklogs, month: "2026-10", today: "2026-10-30", normSeconds: 8 * 3600 })!;
    expect(without.missing!.count).toBe(5);
    expect(without.percent).toBeLessThan(100);
  });

  it("describes the scale and has a line for every level", () => {
    expect(qualityScaleText().split("\n")).toEqual([
      "0–3 working days: 100%",
      "4–5 working days: 90%",
      "6–10 working days: 70%",
      "11–15 working days: 50%",
      "16–20 working days: 30%",
      "over 20 working days: 10%"
    ]);
    expect(qualityMessage(100)).toBe("You are the best!");
    expect(new Set([100, 90, 70, 50, 30, 10].map(qualityMessage)).size).toBe(6);
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

describe("worklog allocation", () => {
  const rules = DEFAULT_ALLOCATION_RULES;
  const of = (fields: Partial<ReturnType<typeof issue>> & { issueType?: string; projectName?: string }) =>
    allocationCategory({ ...issue("a", "X-1"), ...fields }, rules);

  it("puts an issue in the first category it matches", () => {
    expect(of({ issueType: "Support Request", projectName: "Apollo" })).toBe("Support");
    expect(of({ projectName: "Customer Upgrade" })).toBe("Support");
    expect(of({ projectName: "nets core team" })).toBe("Implementation");
    expect(of({ projectName: "Business Analysis" })).toBe("SME");
    expect(of({ projectName: "Internal", summary: "SME review of the export" })).toBe("SME");
    expect(of({ projectName: "OW ACADEMY" })).toBe("Academy");
    expect(of({ projectName: "Apollo" })).toBe("Apollo");
    expect(of({ projectName: "Internal", summary: "Team meeting" })).toBe("Other");
    // Project keys work too.
    expect(allocationCategory({ ...issue("a", "APL-1") }, [{ id: "x", name: "Apollo", types: "", projects: "APL", summary: "" }])).toBe("Apollo");
    expect(allocationCategory(undefined, rules)).toBe("Other");
  });

  it("splits all worklogs of the month by category, largest first", () => {
    const month: MonthResult = {
      ...result,
      sources: [
        {
          ...result.sources[0],
          issues: [
            { ...issue("a", "SUP-10"), projectName: "Support Infrastructure" },
            { ...issue("a", "SUP-9"), projectName: "Apollo" },
            { ...issue("a", "INT-1"), projectName: "Internal" }
          ]
        },
        result.sources[1]
      ]
    };
    // a: SUP-10 2h Support, SUP-9 1.5h Apollo; b: SUP-9 15m without a project -> Other.
    expect(worklogAllocation(month, rules).map((share) => [share.name, share.seconds, Math.round(share.percent * 100) / 100])).toEqual([
      ["Support", 7200, 53.33],
      ["Apollo", 5400, 40],
      ["Other", 900, 6.67]
    ]);
    expect(worklogAllocation(null, rules)).toEqual([]);
    expect(worklogAllocation(month, [])).toEqual([]);
  });
});

describe("topClients", () => {
  it("lists up to N clients by logged time, as a share of all time in the month", () => {
    const withClients = (clients: Record<string, string>): MonthResult => ({
      ...result,
      sources: result.sources.map((source) => ({
        ...source,
        issues: source.issues.map((item) => ({ ...item, client: clients[`${source.sourceId}:${item.key}`] || "" }))
      }))
    });
    // a:SUP-10 2h, a:SUP-9 1.5h, b:SUP-9 15m (no client) = 3.75h in all.
    const month = withClients({ "a:SUP-10": "Acme", "a:SUP-9": "Globex" });
    expect(topClients(month).map((share) => [share.name, share.seconds, Math.round(share.percent * 100) / 100])).toEqual([
      ["Acme", 7200, 53.33],
      ["Globex", 5400, 40]
    ]);
    expect(topClients(month, 1).map((share) => share.name)).toEqual(["Acme"]);
    // The same client in two Jiras adds up.
    expect(topClients(withClients({ "a:SUP-10": "Acme", "b:SUP-9": "Acme" }))[0].seconds).toBe(8100);
    expect(topClients(null)).toEqual([]);
  });
});
