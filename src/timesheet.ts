import type { Absence, Issue, MonthResult, SearchResult, Worklog } from "./types";
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

/** Whole calendar days between two YYYY-MM-DD dates (b - a). */
function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

export interface Quality {
  /** 0-100; 100 = every worklog entered on its own day */
  percent: number;
  /** Time-weighted average delay between the worklog's day and the day it was entered, in days */
  averageDelay: number;
  count: number;
}

/** Points lost per day of average delay. */
export const QUALITY_PENALTY_PER_DAY = 10;

/**
 * Logging quality: the time-weighted average number of days between a worklog's date and the day
 * it was entered in Jira. 0 days = 100%; each day of average delay costs 10 points (min 0%).
 * Worklogs entered in advance count as 0 days late; worklogs without a creation date are skipped.
 */
export function worklogQuality(worklogs: Worklog[]): Quality | null {
  let weight = 0;
  let weightedDelay = 0;
  let count = 0;
  for (const worklog of worklogs) {
    const created = String(worklog.created || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created) || worklog.seconds <= 0) continue;
    const delay = Math.max(0, daysBetween(worklog.date, created));
    weight += worklog.seconds;
    weightedDelay += delay * worklog.seconds;
    count += 1;
  }
  if (!weight) return null;
  const averageDelay = weightedDelay / weight;
  const percent = Math.max(0, Math.min(100, Math.round(100 - averageDelay * QUALITY_PENALTY_PER_DAY)));
  return { percent, averageDelay, count };
}

/** A short motivating line for a quality percentage. */
export function qualityMessage(percent: number): string {
  if (percent >= 100) return "You are the best!";
  if (percent >= 90) return "Excellent, almost always on time";
  if (percent >= 75) return "Good, keep it up";
  if (percent >= 50) return "Try to log on the same day";
  if (percent >= 25) return "Logging is falling behind";
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
