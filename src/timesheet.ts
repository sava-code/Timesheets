import type { Absence, AllocationRule, Issue, MonthResult, SearchResult, Worklog } from "./types";
import { monthDays, type MonthDay } from "./time";

export interface Row {
  id: string;
  issue: Issue;
  cells: Record<string, Worklog[]>;
  total: number;
}

export const rowId = (sourceId: string, key: string) => `${sourceId}:${key}`;

export function cellSeconds(worklogs: Worklog[] | undefined): number {
  return (worklogs || []).reduce((sum, item) => sum + item.seconds, 0);
}

function issueNumber(key: string): number {
  return Number(key.split("-").pop()) || 0;
}

export function compareRows(a: Row, b: Row): number {
  return (
    a.issue.projectKey.localeCompare(b.issue.projectKey) ||
    issueNumber(a.issue.key) - issueNumber(b.issue.key) ||
    a.issue.sourceName.localeCompare(b.issue.sourceName)
  );
}

/** Most logged time first; equal totals keep the project/number order. */
export function compareRowsByTotal(a: Row, b: Row): number {
  return b.total - a.total || compareRows(a, b);
}

/** What one Jira source contributes to the grid: which issues to show, and your worklogs. */
export interface SourceRows {
  sourceId: string;
  issues: Issue[];
  worklogs: Worklog[];
}

/** Base list: issues from the month load (your worklogs + extra JQL). */
export function baseSources(result: MonthResult | null): SourceRows[] {
  return result ? result.sources.map(({ sourceId, issues, worklogs }) => ({ sourceId, issues, worklogs })) : [];
}

/**
 * Free JQL list: the issues the JQL returned, with your worklogs from the month load.
 * The month load already has every worklog of yours in the month, so no extra calls are needed.
 */
export function freeSources(result: MonthResult | null, search: SearchResult): SourceRows[] {
  const worklogsBySource = new Map((result?.sources || []).map((source) => [source.sourceId, source.worklogs]));
  return search.sources.map((source) => ({
    sourceId: source.sourceId,
    issues: source.issues,
    worklogs: worklogsBySource.get(source.sourceId) || []
  }));
}

export function buildRows(sources: SourceRows[]): Row[] {
  const rows = new Map<string, Row>();

  for (const source of sources) {
    for (const issue of source.issues) {
      const id = rowId(source.sourceId, issue.key);
      if (!rows.has(id)) {
        rows.set(id, { id, issue, cells: {}, total: 0 });
      }
    }
    for (const worklog of source.worklogs) {
      const row = rows.get(rowId(source.sourceId, worklog.issueKey));
      if (!row) continue;
      (row.cells[worklog.date] ||= []).push(worklog);
      row.total += worklog.seconds;
    }
  }

  for (const row of rows.values()) {
    for (const list of Object.values(row.cells)) {
      list.sort((a, b) => a.started.localeCompare(b.started) || Number(a.id) - Number(b.id));
    }
  }

  return [...rows.values()].sort(compareRowsByTotal);
}

/** Issue keys of each Jira source, as sent to a JQL filter. */
export function keysBySource(rows: Row[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const row of rows) (result[row.issue.sourceId] ||= []).push(row.issue.key);
  return result;
}

/** Row ids for the keys a JQL filter matched, per source. */
export function matchedRowIds(matches: Record<string, string[]>): Set<string> {
  const ids = new Set<string>();
  for (const [sourceId, keys] of Object.entries(matches)) keys.forEach((key) => ids.add(rowId(sourceId, key)));
  return ids;
}

/** `matched` is the set of row ids a JQL filter matched, or null for "All". */
export function filterRows(rows: Row[], matched: Set<string> | null, search: string): Row[] {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (matched && !matched.has(row.id)) return false;
    if (!query) return true;
    return row.issue.key.toLowerCase().includes(query) || row.issue.summary.toLowerCase().includes(query);
  });
}

/**
 * Working days (Mon-Fri) from date `a` to date `b` (YYYY-MM-DD): the weekdays after `a` up to and
 * including `b`. A Friday worklog entered on Monday is 1 working day late. 0 if `b` is not after `a`.
 */
export function workingDaysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  const start = Date.UTC(ya, ma - 1, da);
  const end = Date.UTC(yb, mb - 1, db);
  if (!(end > start)) return 0;
  const totalDays = Math.round((end - start) / 86_400_000);
  const fullWeeks = Math.floor(totalDays / 7);
  let count = fullWeeks * 5;
  // The remaining days after the full weeks
  const startDow = new Date(start).getUTCDay();
  for (let offset = 1; offset <= totalDays - fullWeeks * 7; offset++) {
    const dow = (startDow + offset) % 7;
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export interface Quality {
  /** One of the QUALITY_SCALE levels */
  percent: number;
  /** Time-weighted average delay between the worklog's date and the day it was entered, in working days */
  averageDelay: number;
  count: number;
}

/** Average delay in working days (up to and including `maxDays`) and the quality it gives. */
export const QUALITY_SCALE: Array<{ maxDays: number; percent: number }> = [
  { maxDays: 3, percent: 100 },
  { maxDays: 5, percent: 90 },
  { maxDays: 10, percent: 70 },
  { maxDays: 15, percent: 50 },
  { maxDays: 20, percent: 30 },
  { maxDays: Infinity, percent: 10 }
];

export function qualityForDelay(averageDelay: number): number {
  return (QUALITY_SCALE.find((level) => averageDelay <= level.maxDays) || QUALITY_SCALE[QUALITY_SCALE.length - 1]).percent;
}

/** The scale as text, for the indicator's hint. */
export function qualityScaleText(): string {
  let previous = 0;
  return QUALITY_SCALE.map(({ maxDays, percent }) => {
    const range = previous === 0 ? `up to ${maxDays}` : maxDays === Infinity ? `over ${previous}` : `${previous}–${maxDays}`;
    previous = maxDays;
    return `${range} working days: ${percent}%`;
  }).join("\n");
}

/**
 * Logging quality: the time-weighted average number of working days between a worklog's date and the
 * day it was entered in Jira, placed on QUALITY_SCALE. Worklogs entered in advance count as 0 days
 * late; worklogs without a creation date are skipped.
 */
export function worklogQuality(worklogs: Worklog[]): Quality | null {
  let weight = 0;
  let weightedDelay = 0;
  let count = 0;
  for (const worklog of worklogs) {
    const created = String(worklog.created || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created) || worklog.seconds <= 0) continue;
    const delay = workingDaysBetween(worklog.date, created);
    weight += worklog.seconds;
    weightedDelay += delay * worklog.seconds;
    count += 1;
  }
  if (!weight) return null;
  const averageDelay = weightedDelay / weight;
  return { percent: qualityForDelay(averageDelay), averageDelay, count };
}

/** A short motivating line for each quality level. */
export function qualityMessage(percent: number): string {
  if (percent >= 100) return "You are the best!";
  if (percent >= 90) return "Excellent, almost on time";
  if (percent >= 70) return "Good, but try to log sooner";
  if (percent >= 50) return "Logging is falling behind";
  if (percent >= 30) return "Time to catch up";
  return "Catch up and log daily";
}

/** Days of `month` covered by an absence (inclusive range), with the absences covering each. */
export function absenceDays(absences: Absence[], month: string): Map<string, Absence[]> {
  const days = new Map<string, Absence[]>();
  for (const day of monthDays(month)) {
    for (const absence of absences) {
      if (absence.from <= day.key && day.key <= absence.to) {
        days.set(day.key, [...(days.get(day.key) || []), absence]);
      }
    }
  }
  return days;
}

/** Weekends are hidden unless requested, but never when they hold logged time. */
export function visibleDays(month: string, rows: Row[], showWeekends: boolean): MonthDay[] {
  return monthDays(month).filter(
    (day) => showWeekends || !day.isWeekend || rows.some((row) => cellSeconds(row.cells[day.key]) > 0)
  );
}

export function dayTotals(rows: Row[], days: MonthDay[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const day of days) {
    totals[day.key] = rows.reduce((sum, row) => sum + cellSeconds(row.cells[day.key]), 0);
  }
  return totals;
}

export type EditOp =
  | { kind: "create"; seconds: number }
  | { kind: "update"; worklog: Worklog; seconds: number }
  | { kind: "delete"; worklog: Worklog };

/** Jira's smallest worklog. */
export const MIN_WORKLOG_SECONDS = 60;

/**
 * Turns "this cell should now hold `target` seconds" into Jira calls.
 * - Empty cell: create one worklog.
 * - More time: add the difference to the latest worklog of that day.
 * - Less time: shrink worklogs instead of deleting them, because many Jira
 *   setups let people edit their worklogs but not delete them. The latest
 *   worklog that can absorb the whole reduction is shrunk; otherwise time is
 *   taken from the latest ones first, keeping each at least 1 minute.
 * - Worklogs are deleted only when the cell is cleared, or when the target is
 *   too small to keep every worklog at 1 minute.
 */
export function planCellEdit(worklogs: Worklog[], target: number): EditOp[] {
  const current = cellSeconds(worklogs);
  if (target === current) return [];
  if (!worklogs.length) {
    return target > 0 ? [{ kind: "create", seconds: target }] : [];
  }

  const ordered = [...worklogs].sort((a, b) => a.started.localeCompare(b.started) || Number(a.id) - Number(b.id));
  const newestFirst = [...ordered].reverse();
  const latest = newestFirst[0];

  if (target > current) {
    return [{ kind: "update", worklog: latest, seconds: latest.seconds + (target - current) }];
  }

  if (target === 0) {
    return newestFirst.map((worklog) => ({ kind: "delete", worklog }));
  }

  // Too many worklogs to keep them all: delete the newest until the rest fit.
  const ops: EditOp[] = [];
  let kept = newestFirst;
  while (kept.length * MIN_WORKLOG_SECONDS > target) {
    ops.push({ kind: "delete", worklog: kept[0] });
    kept = kept.slice(1);
  }

  let toRemove = cellSeconds(kept) - target;
  if (toRemove <= 0) {
    // Deleting already went below the target: put the rest back on the latest kept one.
    if (toRemove < 0) ops.push({ kind: "update", worklog: kept[0], seconds: kept[0].seconds - toRemove });
    return ops;
  }

  const single = kept.find((worklog) => worklog.seconds - MIN_WORKLOG_SECONDS >= toRemove);
  if (single) {
    ops.push({ kind: "update", worklog: single, seconds: single.seconds - toRemove });
    return ops;
  }

  for (const worklog of kept) {
    if (toRemove <= 0) break;
    const take = Math.min(worklog.seconds - MIN_WORKLOG_SECONDS, toRemove);
    if (take > 0) {
      ops.push({ kind: "update", worklog, seconds: worklog.seconds - take });
      toRemove -= take;
    }
  }
  return ops;
}

/** Returns a new MonthResult with one source's worklogs changed by `change`. */
export function updateSourceWorklogs(
  result: MonthResult,
  sourceId: string,
  change: (worklogs: Worklog[]) => Worklog[]
): MonthResult {
  return {
    ...result,
    sources: result.sources.map((source) =>
      source.sourceId === sourceId ? { ...source, worklogs: change(source.worklogs) } : source
    )
  };
}

// ---------------------------------------------------------------------------
// Worklogs allocation: share of the month's logged time per category.
// ---------------------------------------------------------------------------

/** Same as DEFAULT_ALLOCATION_RULES in electron/storage-core.cjs. */
export const DEFAULT_ALLOCATION_RULES: AllocationRule[] = [
  { id: "support", name: "Support", types: "Support Request", projects: "Support Infrastructure, Customer Upgrade", summary: "" },
  {
    id: "implementation",
    name: "Implementation",
    types: "",
    projects:
      "Project Handover, BKNN, Custom Development, Customer Projects, MRJ, Nativa Core Team, RPC Core Team, NETS Core Team, Sberbank",
    summary: ""
  },
  { id: "sme", name: "SME", types: "", projects: "Business Analysis, Worklogs from OWS JIRA, OpenWay Vendor Support", summary: "SME" },
  { id: "academy", name: "Academy", types: "", projects: "OW ACADEMY", summary: "" },
  { id: "apollo", name: "Apollo", types: "", projects: "Apollo", summary: "" }
];

export interface AllocationShare {
  name: string;
  seconds: number;
  percent: number;
}

const listOf = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

/** The first rule the issue matches (issue type, project name or key, or text in the summary); otherwise "Other". */
export function allocationCategory(issue: Issue | undefined, rules: AllocationRule[]): string {
  if (!issue) return "Other";
  const type = (issue.issueType || "").toLowerCase();
  const projects = [issue.projectName || "", issue.projectKey || ""].map((value) => value.toLowerCase());
  const summary = (issue.summary || "").toLowerCase();
  for (const rule of rules) {
    if (listOf(rule.types).includes(type) && type) return rule.name;
    if (listOf(rule.projects).some((project) => projects.includes(project))) return rule.name;
    if (listOf(rule.summary).some((text) => summary.includes(text))) return rule.name;
  }
  return "Other";
}

/** Shares of all your worklogs of the month by category, largest first. */
export function worklogAllocation(result: MonthResult | null, rules: AllocationRule[]): AllocationShare[] {
  // No categories: no allocation line (it would only say "Other 100%").
  if (!result || !rules.length) return [];
  const totals = new Map<string, number>();
  for (const source of result.sources) {
    const issues = new Map(source.issues.map((issue) => [issue.key, issue]));
    for (const worklog of source.worklogs) {
      const name = allocationCategory(issues.get(worklog.issueKey), rules);
      totals.set(name, (totals.get(name) || 0) + worklog.seconds);
    }
  }
  const all = [...totals.values()].reduce((sum, seconds) => sum + seconds, 0);
  if (!all) return [];
  return [...totals.entries()]
    .filter(([, seconds]) => seconds > 0)
    .map(([name, seconds]) => ({ name, seconds, percent: (seconds / all) * 100 }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
}

/** The clients with the most of your logged time this month; percent of all your time in the month. */
export function topClients(result: MonthResult | null, count = 5): AllocationShare[] {
  if (!result) return [];
  const totals = new Map<string, number>();
  let all = 0;
  for (const source of result.sources) {
    const clients = new Map(source.issues.map((issue) => [issue.key, (issue.client || "").trim()]));
    for (const worklog of source.worklogs) {
      all += worklog.seconds;
      const client = clients.get(worklog.issueKey);
      if (client) totals.set(client, (totals.get(client) || 0) + worklog.seconds);
    }
  }
  if (!all) return [];
  return [...totals.entries()]
    .filter(([, seconds]) => seconds > 0)
    .map(([name, seconds]) => ({ name, seconds, percent: (seconds / all) * 100 }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
    .slice(0, count);
}
