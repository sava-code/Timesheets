import type { FilterGroup, Issue, MonthResult, PinnedIssue, Worklog } from "./types";
import { monthDays, type MonthDay } from "./time";

export interface Row {
  id: string;
  issue: Issue;
  cells: Record<string, Worklog[]>;
  total: number;
  pinned: boolean;
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

export function buildRows(result: MonthResult | null, pinned: PinnedIssue[]): Row[] {
  if (!result) return [];
  const pinnedIds = new Set(pinned.map((item) => rowId(item.sourceId, item.key)));
  const rows = new Map<string, Row>();

  for (const source of result.sources) {
    for (const issue of source.issues) {
      const id = rowId(source.sourceId, issue.key);
      if (!rows.has(id)) {
        rows.set(id, { id, issue, cells: {}, total: 0, pinned: pinnedIds.has(id) });
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

  return [...rows.values()].sort(compareRows);
}

export function filterRows(rows: Row[], filter: FilterGroup | null, search: string): Row[] {
  const query = search.trim().toLowerCase();
  const keys = filter ? new Set(filter.projectKeys) : null;
  return rows.filter((row) => {
    if (keys && !keys.has(row.issue.projectKey.toUpperCase())) return false;
    if (!query) return true;
    return row.issue.key.toLowerCase().includes(query) || row.issue.summary.toLowerCase().includes(query);
  });
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

/**
 * Turns "this cell should now hold `target` seconds" into Jira calls.
 * - Empty cell: create one worklog.
 * - More time: add the difference to the latest worklog of that day.
 * - Less time: take it from the latest worklogs first, deleting any that reach zero.
 */
export function planCellEdit(worklogs: Worklog[], target: number): EditOp[] {
  const current = cellSeconds(worklogs);
  if (target === current) return [];
  if (!worklogs.length) {
    return target > 0 ? [{ kind: "create", seconds: target }] : [];
  }

  const ordered = [...worklogs].sort((a, b) => a.started.localeCompare(b.started) || Number(a.id) - Number(b.id));
  const latest = ordered[ordered.length - 1];

  if (target > current) {
    return [{ kind: "update", worklog: latest, seconds: latest.seconds + (target - current) }];
  }

  const ops: EditOp[] = [];
  let toRemove = current - target;
  for (const worklog of [...ordered].reverse()) {
    if (toRemove <= 0) break;
    if (worklog.seconds <= toRemove) {
      ops.push({ kind: "delete", worklog });
      toRemove -= worklog.seconds;
    } else {
      ops.push({ kind: "update", worklog, seconds: worklog.seconds - toRemove });
      toRemove = 0;
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
