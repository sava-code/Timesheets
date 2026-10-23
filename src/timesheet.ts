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
