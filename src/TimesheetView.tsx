import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Code2, LoaderCircle, RefreshCw, Search, UserRound, X } from "lucide-react";
import { api, errorText } from "./api";
import { tableFontStack } from "./fonts";
import type { AppData, Issue, MonthResult, SearchResult, Worklog } from "./types";
import { currentMonth, formatDuration, monthDays, monthLabel, parseDuration, shiftMonth, todayKey } from "./time";
import {
  absenceDays,
  baseSources,
  buildRows,
  cellSeconds,
  freeSources,
  dayTotals,
  filterRows,
  keysBySource,
  matchedRowIds,
  MIN_WORKLOG_SECONDS,
  planCellEdit,
  updateSourceWorklogs,
  visibleDays,
  type SourceRows
} from "./timesheet";

interface Props {
  data: AppData;
  onOpenSettings: () => void;
}

interface Cell {
  row: string;
  day: string;
}

interface LogEntry {
  id: number;
  at: string;
  level: "info" | "ok" | "error";
  text: string;
}

const cellId = (cell: Cell) => `${cell.row}|${cell.day}`;
const EDIT_START = /^[0-9.,:hm]$/i;

/** Adds an issue to a source of the month result if it isn't there (e.g. first worklog on a JQL-search issue). */
function withIssue(result: MonthResult, sourceId: string, issue: Issue): MonthResult {
  return {
    ...result,
    sources: result.sources.map((source) =>
      source.sourceId === sourceId && !source.issues.some((item) => item.key === issue.key)
        ? { ...source, issues: [...source.issues, issue] }
        : source
    )
  };
}

function shortDate(key: string) {
  const [, m, d] = key.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function TimesheetView({ data, onOpenSettings }: Props) {
  const { settings } = data;
  const format = settings.displayFormat;
  const [month, setMonth] = useState(currentMonth());
  const [result, setResult] = useState<MonthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterId, setFilterId] = useState("all");
  // Narrowing filter: rows of the base list that match its JQL (ids null = could not be applied).
  const [filterMatch, setFilterMatch] = useState<{ key: string; ids: Set<string> | null } | null>(null);
  // JQL search box: what is typed, and what was last run with Enter/Refresh.
  const [searchDraft, setSearchDraft] = useState("");
  const [searchJql, setSearchJql] = useState("");
  // Issues returned by the free JQL in use (search box or free filter).
  const [freeResult, setFreeResult] = useState<{ key: string; search: SearchResult } | null>(null);
  const lastSources = useRef<SourceRows[]>([]);
  const [loadCount, setLoadCount] = useState(0);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<(Cell & { value: string; original: string }) | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  // Mirrors `editing` synchronously so Enter/Tab/blur cannot commit the same edit twice.
  const editingRef = useRef<(Cell & { value: string; original: string }) | null>(null);
  const logId = useRef(0);
  const requestId = useRef(0);

  const addLog = useCallback((level: LogEntry["level"], text: string) => {
    const at = new Date().toLocaleTimeString("en-GB");
    setLog((items) => [{ id: ++logId.current, at, level, text }, ...items].slice(0, 300));
    if (level === "error") setLogOpen(true);
  }, []);

  const activeSources = settings.jiraConnections.filter((item) => item.enabled && item.baseUrl);

  const load = useCallback(
    async (target: string) => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const next = await api().fetchMonth(target);
        if (id !== requestId.current) return;
        setResult(next);
        setLoadCount((count) => count + 1);
        for (const error of next.errors) {
          addLog("error", `${error.sourceName || error.sourceId}: ${error.message}`);
        }
        for (const error of next.absenceErrors || []) {
          addLog("error", `Absences · ${error.sourceName || error.sourceId}: ${error.message}`);
        }
        const count = next.sources.reduce((sum, source) => sum + source.worklogs.length, 0);
        const absent = absenceDays(next.absences || [], target);
        const absentWorkdays = monthDays(target).filter((day) => !day.isWeekend && absent.has(day.key)).length;
        if (next.configured) {
          addLog(
            "info",
            `Loaded ${monthLabel(target)}: ${count} worklogs` +
              (absentWorkdays ? `, ${absentWorkdays} absence day${absentWorkdays === 1 ? "" : "s"} left out of the norm` : "")
          );
        }
      } catch (error) {
        if (id === requestId.current) addLog("error", `Refresh failed: ${errorText(error)}`);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [addLog]
  );

  // Reload when the month changes or the set of Jira sources is edited in Settings.
  const sourcesSignature = JSON.stringify([
    settings.jiraConnections.map((item) => [item.id, item.enabled, item.baseUrl, item.extraJql, item.tokenPresent]),
    settings.absences
  ]);
  useEffect(() => {
    setSelected(null);
    editingRef.current = null;
    setEditing(null);
    void load(month);
  }, [month, sourcesSignature, load]);

  // Which JQL decides the rows:
  // - the JQL search box, once run with Enter/Refresh (free: only its issues);
  // - otherwise the selected chip: a free filter replaces the base list, a normal one narrows it.
  const allChip = { id: "all", label: "All", ...settings.allFilter };
  const chips = [allChip, ...settings.filters];
  const chip = chips.find((item) => item.id === filterId) || allChip;
  const freeJql = searchJql || (chip.free && chip.jql ? chip.jql : "");
  const narrowJql = !searchJql && !chip.free && chip.jql ? chip.jql : "";
  const freeLabel = searchJql ? "JQL search" : `Filter "${chip.label}"`;

  const freeKey = freeJql && result ? `${freeJql}|${loadCount}` : "";
  const freeReady = Boolean(freeKey && freeResult?.key === freeKey);

  useEffect(() => {
    if (!freeKey) return;
    let cancelled = false;
    api()
      .searchIssues(freeJql)
      .then((search) => {
        if (cancelled) return;
        // One Jira rejecting the JQL (e.g. unknown project there) is normal with several sources.
        const level = search.sources.length ? "info" : "error";
        for (const error of search.errors) addLog(level, `${freeLabel} · ${error.sourceName || error.sourceId}: ${error.message}`);
        for (const source of search.sources) {
          if (source.truncated) addLog("info", `${freeLabel} · ${source.sourceName}: showing the first ${source.issues.length} issues`);
        }
        setFreeResult({ key: freeKey, search });
      })
      .catch((error) => {
        if (cancelled) return;
        addLog("error", `${freeLabel}: ${errorText(error)}`);
        setFreeResult({ key: freeKey, search: { sources: [], errors: [] } });
      });
    return () => {
      cancelled = true;
    };
    // freeKey captures the JQL and the month load it belongs to.
  }, [freeKey]);

  // While a new JQL runs, keep showing the previous rows (dimmed) instead of an empty table.
  const readySources = useMemo(
    () => (freeJql ? (freeReady && freeResult ? freeSources(result, freeResult.search) : null) : baseSources(result)),
    [freeJql, freeReady, freeResult, result]
  );
  if (readySources) lastSources.current = readySources;
  const shownSources = readySources ?? lastSources.current;

  const builtRows = useMemo(() => buildRows(shownSources), [shownSources]);
  // Rows are sorted by total (most time first) when the list loads or changes,
  // but not after every edit, so the row you are typing in doesn't jump away.
  const builtIdsSignature = builtRows.map((row) => row.id).sort().join(",");
  const order = useMemo(
    () => new Map(builtRows.map((row, index) => [row.id, index])),
    // builtRows is already sorted by total; recompute the order only when the list itself changes.
    [loadCount, freeJql, builtIdsSignature]
  );
  const allRows = useMemo(
    () => [...builtRows].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)),
    [builtRows, order]
  );

  const rowIdsSignature = allRows.map((row) => row.id).join(",");
  const matchKey = narrowJql ? `${chip.id}|${narrowJql}|${loadCount}|${rowIdsSignature}` : "";
  const narrowReady = Boolean(matchKey && filterMatch?.key === matchKey);
  const narrowLoading = Boolean(matchKey) && allRows.length > 0 && !narrowReady;
  const freeLoading = Boolean(freeJql) && !freeReady;
  const rows = useMemo(
    () => filterRows(allRows, narrowReady && filterMatch ? filterMatch.ids : null, search),
    [allRows, narrowReady, filterMatch, search]
  );

  useEffect(() => {
    if (!matchKey || !allRows.length) return;
    let cancelled = false;
    const failed = (message: string) => {
      addLog("error", `Filter "${chip.label}": ${message}`);
      setFilterMatch({ key: matchKey, ids: null });
      if (chip.id !== "all") setFilterId("all");
    };
    api()
      .matchFilter(narrowJql, keysBySource(allRows))
      .then((match) => {
        if (cancelled) return;
        if (match.errors.length) {
          failed(match.errors.map((error) => `${error.sourceName || error.sourceId}: ${error.message}`).join("; "));
          return;
        }
        setFilterMatch({ key: matchKey, ids: matchedRowIds(match.matches) });
      })
      .catch((error) => {
        if (!cancelled) failed(errorText(error));
      });
    return () => {
      cancelled = true;
    };
    // matchKey captures every input that changes the answer.
  }, [matchKey]);

  // Filters were removed in Settings.
  useEffect(() => {
    if (filterId !== "all" && !settings.filters.some((item) => item.id === filterId)) setFilterId("all");
  }, [filterId, settings.filters]);

  const selectChip = (id: string) => {
    setFilterId(id);
    setSearchDraft("");
    setSearchJql("");
  };

  const runSearch = (jql: string) => {
    const next = jql.trim();
    setSearchDraft(next);
    setSearchJql(next);
  };

  const refresh = () => {
    // Refresh also runs whatever is typed in the JQL search box.
    if (searchDraft.trim() !== searchJql) runSearch(searchDraft);
    void load(month);
  };

  const days = useMemo(() => visibleDays(month, allRows, settings.showWeekends), [month, allRows, settings.showWeekends]);
  const totals = useMemo(() => dayTotals(rows, days), [rows, days]);
  const filteredTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const multiSource = (result?.sources.length || 0) > 1;
  const today = todayKey();

  // Everything you logged this month, whatever the table currently shows.
  const monthTotal = (result?.sources || []).reduce(
    (sum, source) => sum + source.worklogs.reduce((inner, item) => inner + item.seconds, 0),
    0
  );
  const fullView = !freeJql && !narrowJql && !search.trim();
  // Days off registered in Jira don't count towards the norm.
  const absent = useMemo(() => absenceDays(result?.absences || [], month), [result, month]);
  const absenceTitle = (dayKey: string) =>
    (absent.get(dayKey) || []).map((item) => `Absence: ${item.key} · ${item.summary}${item.status ? ` (${item.status})` : ""}`).join("\n");
  const workdays = monthDays(month).filter((day) => !day.isWeekend && !absent.has(day.key));
  const normSeconds = settings.dailyNormHours * 3600;
  const normToDate = workdays.filter((day) => day.key <= today).length * normSeconds;

  const rowById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const move = (cell: Cell, dRow: number, dDay: number): Cell => {
    const r = rows.findIndex((row) => row.id === cell.row);
    const d = days.findIndex((day) => day.key === cell.day);
    const nextRow = rows[Math.min(Math.max(r + dRow, 0), rows.length - 1)];
    const nextDay = days[Math.min(Math.max(d + dDay, 0), days.length - 1)];
    return nextRow && nextDay ? { row: nextRow.id, day: nextDay.key } : cell;
  };

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  useEffect(() => {
    if (!selected || editing) return;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${CSS.escape(cellId(selected))}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, editing]);

  const startEdit = (cell: Cell, initial?: string) => {
    const row = rowById.get(cell.row);
    if (!row || pending.has(cellId(cell))) return;
    setSelected(cell);
    const exact = formatDuration(cellSeconds(row.cells[cell.day]), format, 2);
    const next = { ...cell, value: initial ?? exact, original: exact };
    editingRef.current = next;
    setEditing(next);
  };

  const finishEdit = (save: boolean) => {
    const current = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (current && save && current.value.trim() !== current.original) void commit({ row: current.row, day: current.day }, current.value);
    return current;
  };

  const commit = async (cell: Cell, value: string) => {
    const row = rowById.get(cell.row);
    if (!row) return;
    const parsed = parseDuration(value);
    if (!parsed.ok) {
      addLog("error", `${row.issue.key} · ${shortDate(cell.day)}: ${parsed.error}`);
      return;
    }
    const worklogs = row.cells[cell.day] || [];
    const before = cellSeconds(worklogs);
    const ops = planCellEdit(worklogs, parsed.seconds);
    if (!ops.length) return;

    const deletes = ops.filter((op) => op.kind === "delete");
    const withComments = deletes.filter((op) => op.kind === "delete" && op.worklog.comment);
    if (deletes.length > 1 || withComments.length) {
      const detail = withComments.length ? " Some of them have comments." : "";
      if (!window.confirm(`This will delete ${deletes.length} worklog(s) on ${row.issue.key} for ${shortDate(cell.day)} in Jira.${detail} Continue?`)) {
        return;
      }
    }

    const id = cellId(cell);
    const { sourceId, key } = row.issue;
    setPending((set) => new Set(set).add(id));
    let keptMinimum = 0;
    try {
      for (const op of ops) {
        if (op.kind === "create") {
          const created = await api().createWorklog(sourceId, { issueKey: key, date: cell.day, seconds: op.seconds });
          setResult(
            (current) =>
              current &&
              updateSourceWorklogs(withIssue(current, sourceId, row.issue), sourceId, (list) => [...list, { ...created, date: cell.day }])
          );
        } else if (op.kind === "update") {
          const updated = await api().updateWorklog(sourceId, {
            issueKey: key,
            worklogId: op.worklog.id,
            seconds: op.seconds,
            started: op.worklog.started
          });
          setResult((current) =>
            current &&
            updateSourceWorklogs(current, sourceId, (list) =>
              list.map((item: Worklog) =>
                item.id === op.worklog.id ? { ...item, seconds: updated.seconds || op.seconds } : item
              )
            )
          );
        } else {
          try {
            await api().deleteWorklog(sourceId, { issueKey: key, worklogId: op.worklog.id });
            setResult((current) =>
              current && updateSourceWorklogs(current, sourceId, (list) => list.filter((item) => item.id !== op.worklog.id))
            );
          } catch (error) {
            // Jira refused the delete (no "Delete Own Worklogs" permission): keep the
            // worklog at Jira's minimum of 1 minute, the closest allowed value.
            if (!/Delete Own Worklogs/.test(errorText(error))) throw error;
            keptMinimum += MIN_WORKLOG_SECONDS;
            if (op.worklog.seconds > MIN_WORKLOG_SECONDS) {
              await api().updateWorklog(sourceId, {
                issueKey: key,
                worklogId: op.worklog.id,
                seconds: MIN_WORKLOG_SECONDS,
                started: op.worklog.started
              });
              setResult((current) =>
                current &&
                updateSourceWorklogs(current, sourceId, (list) =>
                  list.map((item) => (item.id === op.worklog.id ? { ...item, seconds: MIN_WORKLOG_SECONDS } : item))
                )
              );
            }
          }
        }
      }
      const finalSeconds = parsed.seconds + keptMinimum;
      addLog(
        "ok",
        `${key} · ${shortDate(cell.day)}: ${formatDuration(before, format, 2) || "0"} → ${formatDuration(finalSeconds, format, 2) || "0"}` +
          (keptMinimum
            ? ` (Jira doesn't allow you to delete worklogs, so ${keptMinimum / MIN_WORKLOG_SECONDS} worklog(s) kept at 1m)`
            : "")
      );
    } catch (error) {
      addLog("error", `${key} · ${shortDate(cell.day)}: ${errorText(error)}`);
    } finally {
      setPending((set) => {
        const next = new Set(set);
        next.delete(id);
        return next;
      });
    }
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !selected) {
      if (!selected && rows[0] && days[0] && event.key.startsWith("Arrow")) {
        event.preventDefault();
        setSelected({ row: rows[0].id, day: days[0].key });
      }
      return;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1]
    };
    if (arrows[event.key]) {
      event.preventDefault();
      setSelected(move(selected, ...arrows[event.key]));
    } else if (event.key === "Tab") {
      event.preventDefault();
      setSelected(move(selected, 0, event.shiftKey ? -1 : 1));
    } else if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      startEdit(selected);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      void commit(selected, "");
    } else if (event.key === "Escape") {
      setSelected(null);
    } else if (EDIT_START.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      startEdit(selected, event.key);
    }
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const cell = finishEdit(true);
      if (cell) {
        const step: [number, number] = event.key === "Enter" ? [event.shiftKey ? -1 : 1, 0] : [0, event.shiftKey ? -1 : 1];
        setSelected(move(cell, ...step));
      }
      focusGrid();
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishEdit(false);
      focusGrid();
    }
  };

  const totalClass = (dayKey: string, isWeekend: boolean, seconds: number) => {
    if (absent.has(dayKey)) return "absent";
    // The norm applies to the whole day, so colour only when the table shows all of your time.
    if (!fullView || isWeekend || dayKey > today) return "";
    if (seconds >= normSeconds) return "met";
    return seconds > 0 ? "under" : "empty";
  };

  if (!activeSources.length) {
    return (
      <main className="emptyPage">
        <h2>Connect Jira to see your timesheet</h2>
        <p>Add at least one Jira source with its URL and credentials in Settings.</p>
        <button className="primary" onClick={onOpenSettings}>
          Open Settings
        </button>
      </main>
    );
  }

  return (
    <main
      className="timesheet"
      style={
        {
          "--grid-font": tableFontStack(settings.tableFont),
          "--grid-font-size": `${settings.tableFontSize}px`
        } as CSSProperties
      }
    >
      <section className="toolbar">
        <div className="monthNav">
          <button className="icon" title="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={18} />
          </button>
          <h2>{monthLabel(month)}</h2>
          <button className="icon" title="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={18} />
          </button>
          {month !== currentMonth() && (
            <button className="ghost" onClick={() => setMonth(currentMonth())}>
              This month
            </button>
          )}
        </div>

        <div className="stats">
          <span>
            Logged <strong>{formatDuration(monthTotal, format) || "0"}</strong>
          </span>
          {month <= currentMonth() && (
            <span>
              Norm to date <strong>{formatDuration(normToDate, format) || "0"}</strong>
            </span>
          )}
          <span>
            Month norm <strong>{formatDuration(workdays.length * normSeconds, format)}</strong>
          </span>
        </div>

        <button className="primary" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
        </button>
      </section>

      <section className="filters">
        <div className="chips" role="radiogroup" aria-label="Filter">
          {chips.map((item) => {
            const active = !searchJql && filterId === item.id;
            const busy = active && (freeLoading || narrowLoading);
            const title = item.jql
              ? `${item.jql}${item.free ? "\n(free filter: its own list of issues)" : ""}`
              : "Issues with your worklogs this month";
            return (
              <button
                key={item.id}
                role="radio"
                aria-checked={active}
                className={active ? "chip active" : "chip"}
                title={title}
                onClick={() => selectChip(item.id)}
              >
                {busy && <LoaderCircle size={13} className="spin" />}
                {item.label}
              </button>
            );
          })}
        </div>
        <form
          className={searchJql ? "jqlSearch active" : "jqlSearch"}
          onSubmit={(event) => {
            event.preventDefault();
            runSearch(searchDraft);
          }}
        >
          {searchJql && freeLoading ? <LoaderCircle size={15} className="spin" /> : <Code2 size={15} />}
          <input
            value={searchDraft}
            aria-label="Jira JQL search"
            placeholder="Jira JQL"
            spellCheck={false}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") runSearch("");
            }}
          />
          {(searchDraft || searchJql) && (
            <button type="button" className="icon small" title="Clear JQL search" onClick={() => runSearch("")}>
              <X size={14} />
            </button>
          )}
        </form>
        <label className="search">
          <Search size={15} />
          <input value={search} placeholder="Find issue" onChange={(event) => setSearch(event.target.value)} />
          {search && (
            <button className="icon small" title="Clear" onClick={() => setSearch("")}>
              <X size={14} />
            </button>
          )}
        </label>
      </section>

      <div
        className={loading || freeLoading || narrowLoading ? "gridWrap loading" : "gridWrap"}
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        aria-label="Timesheet grid. Use arrow keys to move, type a value to edit."
      >
        <table className="grid">
          <thead>
            <tr className="dayRow">
              <th className="keyCol">Key</th>
              <th className="summaryCol">Summary</th>
              <th className="totalCol">Total</th>
              {days.map((day) => (
                <th
                  key={day.key}
                  className={["dayCol", day.isWeekend ? "weekend" : "", day.key === today ? "today" : "", absent.has(day.key) ? "absent" : ""].join(" ")}
                  title={absenceTitle(day.key) || undefined}
                >
                  <span className="dayNum">{day.day}</span>
                  <span className="dayName">{day.weekday}</span>
                </th>
              ))}
            </tr>
            <tr className="totalsRow">
              <th className="keyCol" />
              <th className="summaryCol">
                {narrowJql || search.trim() ? `Total · ${rows.length} of ${allRows.length} issues` : `Total · ${rows.length} issues`}
              </th>
              <th className="totalCol">{formatDuration(filteredTotal, format)}</th>
              {days.map((day) => (
                <th
                  key={day.key}
                  className={["dayCol", totalClass(day.key, day.isWeekend, totals[day.key])].join(" ")}
                  title={absenceTitle(day.key) || undefined}
                >
                  {formatDuration(totals[day.key], format)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="keyCol">
                  <a
                    href={row.issue.url}
                    onClick={(event) => {
                      event.preventDefault();
                      void api().openExternal(row.issue.url);
                    }}
                    title={`Open ${row.issue.key} in ${row.issue.sourceName}`}
                  >
                    {row.issue.key}
                  </a>
                  {multiSource && <span className="source">{row.issue.sourceName}</span>}
                </td>
                <td className="summaryCol" title={row.issue.summary}>
                  <span className="summaryText">{row.issue.summary}</span>
                </td>
                <td className="totalCol">{formatDuration(row.total, format)}</td>
                {days.map((day) => {
                  const cell = { row: row.id, day: day.key };
                  const id = cellId(cell);
                  const worklogs = row.cells[day.key] || [];
                  const seconds = cellSeconds(worklogs);
                  const isSelected = selected?.row === row.id && selected.day === day.key;
                  const isEditing = editing?.row === row.id && editing.day === day.key;
                  const isPending = pending.has(id);
                  const tooltip = worklogs.length
                    ? worklogs
                        .map((item) => `${formatDuration(item.seconds, "jira")}${item.comment ? ` — ${item.comment}` : ""}`)
                        .join("\n")
                    : undefined;
                  return (
                    <td
                      key={day.key}
                      data-cell={id}
                      className={[
                        "dayCol",
                        "cell",
                        day.isWeekend ? "weekend" : "",
                        day.key === today ? "today" : "",
                        absent.has(day.key) ? "absent" : "",
                        isSelected ? "selected" : "",
                        isPending ? "pending" : "",
                        worklogs.length > 1 ? "multi" : ""
                      ].join(" ")}
                      title={tooltip}
                      onMouseDown={(event) => {
                        if (isEditing) return;
                        event.preventDefault();
                        setSelected(cell);
                        focusGrid();
                      }}
                      onDoubleClick={() => startEdit(cell)}
                    >
                      {isEditing ? (
                        <input
                          className="editor"
                          autoFocus
                          value={editing.value}
                          onFocus={(event) => {
                            const input = event.currentTarget;
                            const end = input.value.length;
                            input.setSelectionRange(end, end);
                          }}
                          onChange={(event) => {
                            const next = { ...editing, value: event.target.value };
                            editingRef.current = next;
                            setEditing(next);
                          }}
                          onKeyDown={onEditorKeyDown}
                          onBlur={() => finishEdit(true)}
                        />
                      ) : isPending ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        formatDuration(seconds, format)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!rows.length && !loading && !freeLoading && !narrowLoading && (
              <tr>
                <td className="emptyRow" colSpan={days.length + 3}>
                  {freeJql
                    ? "No issues match this JQL."
                    : allRows.length
                      ? "No issues match this filter."
                      : "No worklogs this month yet. Use the JQL search above to find an issue to log time on."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="bottomBar">
        <p className="hint">Double-click or type in a cell · 1.5 · 1h 30m · 90m · Delete clears</p>
        <button className="ghost logToggle" onClick={() => setLogOpen(!logOpen)}>
          Activity {log.some((item) => item.level === "error") && <span className="errorDot" />}
        </button>
      </section>

      {logOpen && (
        <section className="logPanel" aria-label="Activity log">
          {log.length ? (
            log.map((item) => (
              <div key={item.id} className={`logLine ${item.level}`}>
                <time>{item.at}</time>
                <span>{item.text}</span>
              </div>
            ))
          ) : (
            <div className="logLine">Nothing yet.</div>
          )}
          {result?.sources.some((source) => source.user) && (
            <div className="logFooter">
              {result.sources.map((source) => (
                <span key={source.sourceId}>
                  <UserRound size={12} /> {source.sourceName}: signed in as {source.user}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
