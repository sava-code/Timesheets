import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Plus, RefreshCw, Search, UserRound, X } from "lucide-react";
import { api, errorText } from "./api";
import type { AppData, MonthResult, Worklog } from "./types";
import { currentMonth, formatDuration, monthDays, monthLabel, parseDuration, shiftMonth, todayKey } from "./time";
import {
  buildRows,
  cellSeconds,
  dayTotals,
  filterRows,
  planCellEdit,
  rowId,
  updateSourceWorklogs,
  visibleDays,
  type Row
} from "./timesheet";

interface Props {
  data: AppData;
  onDataChange: (data: AppData) => void;
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

function shortDate(key: string) {
  const [, m, d] = key.split("-").map(Number);
  return new Date(2000, m - 1, d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function TimesheetView({ data, onDataChange, onOpenSettings }: Props) {
  const { settings } = data;
  const format = settings.displayFormat;
  const [month, setMonth] = useState(currentMonth());
  const [result, setResult] = useState<MonthResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterId, setFilterId] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<(Cell & { value: string }) | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [addSource, setAddSource] = useState("");
  const [addKey, setAddKey] = useState("");
  const [adding, setAdding] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  // Mirrors `editing` synchronously so Enter/Tab/blur cannot commit the same edit twice.
  const editingRef = useRef<(Cell & { value: string }) | null>(null);
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
        for (const error of next.errors) {
          addLog("error", `${error.sourceName || error.sourceId}: ${error.message}`);
        }
        const count = next.sources.reduce((sum, source) => sum + source.worklogs.length, 0);
        if (next.configured) addLog("info", `Loaded ${monthLabel(target)}: ${count} worklogs`);
      } catch (error) {
        if (id === requestId.current) addLog("error", `Refresh failed: ${errorText(error)}`);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [addLog]
  );

  // Reload when the month changes or the set of Jira sources is edited in Settings.
  const sourcesSignature = JSON.stringify(
    settings.jiraConnections.map((item) => [item.id, item.enabled, item.baseUrl, item.extraJql, item.tokenPresent])
  );
  useEffect(() => {
    setSelected(null);
    editingRef.current = null;
    setEditing(null);
    void load(month);
  }, [month, sourcesSignature, load]);

  const allRows = useMemo(() => buildRows(result, data.pinnedIssues), [result, data.pinnedIssues]);
  const filter = settings.filters.find((item) => item.id === filterId) || null;
  const rows = useMemo(() => filterRows(allRows, filter, search), [allRows, filter, search]);
  const days = useMemo(() => visibleDays(month, allRows, settings.showWeekends), [month, allRows, settings.showWeekends]);
  const totals = useMemo(() => dayTotals(rows, days), [rows, days]);
  const filteredTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const multiSource = (result?.sources.length || 0) > 1;
  const today = todayKey();

  const monthTotal = allRows.reduce((sum, row) => sum + row.total, 0);
  const workdays = monthDays(month).filter((day) => !day.isWeekend);
  const normSeconds = settings.dailyNormHours * 3600;
  const normToDate = workdays.filter((day) => day.key <= today).length * normSeconds;

  useEffect(() => {
    if (!addSource && activeSources[0]) setAddSource(activeSources[0].id);
  }, [activeSources, addSource]);

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
    const next = { ...cell, value: initial ?? formatDuration(cellSeconds(row.cells[cell.day]), format) };
    editingRef.current = next;
    setEditing(next);
  };

  const finishEdit = (save: boolean) => {
    const current = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    if (current && save) void commit({ row: current.row, day: current.day }, current.value);
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
    try {
      for (const op of ops) {
        if (op.kind === "create") {
          const created = await api().createWorklog(sourceId, { issueKey: key, date: cell.day, seconds: op.seconds });
          setResult((current) => current && updateSourceWorklogs(current, sourceId, (list) => [...list, { ...created, date: cell.day }]));
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
          await api().deleteWorklog(sourceId, { issueKey: key, worklogId: op.worklog.id });
          setResult((current) =>
            current && updateSourceWorklogs(current, sourceId, (list) => list.filter((item) => item.id !== op.worklog.id))
          );
        }
      }
      addLog(
        "ok",
        `${key} · ${shortDate(cell.day)}: ${formatDuration(before, format) || "0"} → ${formatDuration(parsed.seconds, format) || "0"}`
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

  const unpin = async (row: Row) => {
    const next = {
      ...data,
      pinnedIssues: data.pinnedIssues.filter((item) => rowId(item.sourceId, item.key) !== row.id)
    };
    try {
      onDataChange(await api().saveData(next));
      setResult((current) =>
        current && {
          ...current,
          sources: current.sources.map((source) =>
            source.sourceId === row.issue.sourceId
              ? { ...source, issues: source.issues.filter((issue) => issue.key !== row.issue.key) }
              : source
          )
        }
      );
      addLog("info", `${row.issue.key} removed from the list`);
    } catch (error) {
      addLog("error", errorText(error));
    }
  };

  const addIssue = async () => {
    const key = addKey.trim().toUpperCase();
    if (!key || !addSource) return;
    setAdding(true);
    try {
      const { data: nextData, issue } = await api().addIssue(addSource, key);
      onDataChange(nextData);
      setResult((current) => {
        if (!current) return current;
        return {
          ...current,
          sources: current.sources.map((source) =>
            source.sourceId === addSource && !source.issues.some((item) => item.key === issue.key)
              ? { ...source, issues: [...source.issues, issue] }
              : source
          )
        };
      });
      setAddKey("");
      setFilterId("all");
      setSearch("");
      const day = days.find((item) => item.key === today) || days[0];
      if (day) setSelected({ row: rowId(addSource, issue.key), day: day.key });
      addLog("ok", `${issue.key} added: ${issue.summary}`);
    } catch (error) {
      addLog("error", `${key}: ${errorText(error)}`);
    } finally {
      setAdding(false);
    }
  };

  const totalClass = (dayKey: string, isWeekend: boolean, seconds: number) => {
    if (isWeekend || dayKey > today) return "";
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
    <main className="timesheet">
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

        <button className="primary" onClick={() => void load(month)} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
        </button>
      </section>

      <section className="filters">
        {settings.filters.length > 0 && (
        <div className="chips" role="radiogroup" aria-label="Project filter">
          {[{ id: "all", label: "All", projectKeys: [] as string[] }, ...settings.filters].map((item) => (
            <button
              key={item.id}
              role="radio"
              aria-checked={filterId === item.id}
              className={filterId === item.id ? "chip active" : "chip"}
              title={item.projectKeys.join(", ")}
              onClick={() => setFilterId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        )}
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
        className={loading ? "gridWrap loading" : "gridWrap"}
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKeyDown}
        aria-label="Timesheet grid. Use arrow keys to move, type a value to edit."
      >
        <table className="grid">
          <thead>
            <tr className="dayRow">
              <th className="keyCol">Key</th>
              <th className="summaryCol">Issue</th>
              {days.map((day) => (
                <th
                  key={day.key}
                  className={["dayCol", day.isWeekend ? "weekend" : "", day.key === today ? "today" : ""].join(" ")}
                >
                  <span className="dayNum">{day.day}</span>
                  <span className="dayName">{day.weekday}</span>
                </th>
              ))}
              <th className="totalCol">Total</th>
            </tr>
            <tr className="totalsRow">
              <th className="keyCol" />
              <th className="summaryCol">
                {filter || search ? `Total · ${rows.length} of ${allRows.length} issues` : `Total · ${rows.length} issues`}
              </th>
              {days.map((day) => (
                <th key={day.key} className={["dayCol", totalClass(day.key, day.isWeekend, totals[day.key])].join(" ")}>
                  {formatDuration(totals[day.key], format)}
                </th>
              ))}
              <th className="totalCol">{formatDuration(filteredTotal, format)}</th>
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
                  {row.pinned && row.total === 0 && (
                    <button className="icon small unpin" title="Remove from list" onClick={() => void unpin(row)}>
                      <X size={13} />
                    </button>
                  )}
                </td>
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
                <td className="totalCol">{formatDuration(row.total, format)}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td className="emptyRow" colSpan={days.length + 3}>
                  {allRows.length ? "No issues match this filter." : "No worklogs this month yet. Add an issue below to start logging."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="bottomBar">
        <form
          className="addIssue"
          onSubmit={(event) => {
            event.preventDefault();
            void addIssue();
          }}
        >
          {activeSources.length > 1 && (
            <select value={addSource} onChange={(event) => setAddSource(event.target.value)} aria-label="Jira source">
              {activeSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={addKey}
            onChange={(event) => setAddKey(event.target.value)}
            placeholder="Add issue, e.g. SUP-123"
            aria-label="Issue key"
          />
          <button className="secondary" disabled={!addKey.trim() || adding}>
            {adding ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} Add
          </button>
        </form>
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
