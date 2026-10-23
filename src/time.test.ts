import { describe, expect, it } from "vitest";
import { formatDuration, monthDays, parseDuration, shiftMonth } from "./time";

const ok = (input: string) => {
  const result = parseDuration(input);
  if (!result.ok) throw new Error(result.error);
  return result.seconds;
};

describe("parseDuration", () => {
  it("reads decimal hours with dot or comma", () => {
    expect(ok("1.5")).toBe(5400);
    expect(ok("1,5")).toBe(5400);
    expect(ok(".25")).toBe(900);
    expect(ok("8")).toBe(28800);
  });

  it("reads Jira style values", () => {
    expect(ok("1h 45m")).toBe(6300);
    expect(ok("1h45m")).toBe(6300);
    expect(ok("2h")).toBe(7200);
    expect(ok("90m")).toBe(5400);
    expect(ok("1.5h")).toBe(5400);
    expect(ok(" 1H 5M ")).toBe(3900);
  });

  it("reads h:mm", () => {
    expect(ok("1:30")).toBe(5400);
    expect(ok("0:45")).toBe(2700);
  });

  it("treats empty and zero as clearing the cell", () => {
    expect(ok("")).toBe(0);
    expect(ok("0")).toBe(0);
    expect(ok("0h")).toBe(0);
  });

  it("rounds to whole minutes", () => {
    expect(ok("0.33")).toBe(1200);
  });

  it("rejects invalid or out of range values", () => {
    expect(parseDuration("abc").ok).toBe(false);
    expect(parseDuration("1x").ok).toBe(false);
    expect(parseDuration("25").ok).toBe(false);
    expect(parseDuration("1:75").ok).toBe(false);
    expect(parseDuration("0.001").ok).toBe(false);
    expect(parseDuration("h").ok).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats decimal hours with one decimal", () => {
    expect(formatDuration(5400)).toBe("1.5");
    expect(formatDuration(900)).toBe("0.3");
    expect(formatDuration(28800)).toBe("8");
    expect(formatDuration(0)).toBe("");
    // A 1-minute worklog is still visible, not an empty cell.
    expect(formatDuration(60)).toBe("0.0");
  });

  it("keeps two decimals for the cell editor", () => {
    expect(formatDuration(900, "decimal", 2)).toBe("0.25");
    expect(formatDuration(60, "decimal", 2)).toBe("0.02");
  });

  it("formats Jira style", () => {
    expect(formatDuration(6300, "jira")).toBe("1h 45m");
    expect(formatDuration(2700, "jira")).toBe("45m");
    expect(formatDuration(7200, "jira")).toBe("2h");
  });
});

describe("month helpers", () => {
  it("shifts across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("lists every day with weekends", () => {
    const days = monthDays("2026-02");
    expect(days).toHaveLength(28);
    expect(days[0]).toMatchObject({ key: "2026-02-01", isWeekend: true });
    expect(days[1]).toMatchObject({ key: "2026-02-02", isWeekend: false });
  });
});
