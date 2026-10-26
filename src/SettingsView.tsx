import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChartPie,
  CheckCircle2,
  Download,
  ExternalLink,
  Filter,
  GripVertical,
  Info,
  LoaderCircle,
  Palette,
  Plane,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Trash2,
  XCircle
} from "lucide-react";
import { api, errorText } from "./api";
import type { AllocationRule, AppData, AppInfo, FilterGroup, JiraConnection, Settings, Theme, UpdateStatus } from "./types";
import appIcon from "./assets/icon.svg";
import { applyTheme, themeBackground } from "./theme";
import { TABLE_FONT_SIZES, TABLE_FONTS, tableFontStack } from "./fonts";
import { DEFAULT_ALLOCATION_RULES } from "./timesheet";

interface Props {
  data: AppData;
  onSaved: (data: AppData) => void;
}

type TestState = { status: "running" } | { status: "ok"; text: string } | { status: "error"; text: string };

type SettingsTab = "jira" | "filters" | "absences" | "timesheet" | "allocation" | "appearance" | "about";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; icon: typeof Server }> = [
  { id: "jira", label: "Jira sources", icon: Server },
  { id: "filters", label: "Filters", icon: Filter },
  { id: "absences", label: "Absences", icon: Plane },
  { id: "timesheet", label: "Timesheet", icon: CalendarDays },
  { id: "allocation", label: "Allocation", icon: ChartPie },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "about", label: "About & updates", icon: Info }
];

// Remembered while the app runs, so Settings reopens on the last tab.
let lastTab: SettingsTab = "jira";
let lastUpdate: UpdateStatus | null = null;

const DEFAULT_BASE_JQL = 'worklogAuthor = currentUser() AND worklogDate >= "{monthStart}" AND worklogDate <= "{monthEnd}"';

/** The base JQL as it runs for the current month. */
function previewBaseJql(template: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (template.trim() || DEFAULT_BASE_JQL).replace(/\{monthStart\}/g, `${month}-01`).replace(/\{monthEnd\}/g, `${month}-${pad(last)}`);
}

/** Same as defaultClientField in electron/storage-core.cjs. */
export const defaultClientField = (baseUrl: string) =>
  baseUrl.toLowerCase().includes("ows-jira.spb.") ? "customfield_11000" : "customfield_10703";

/** The preset filters (Viewed recently, My open tickets) always run on every Jira source. */
const COMMON_FILTER_IDS = ["viewed-recently", "my-open-tickets"];

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function newConnection(index: number): JiraConnection {
  return {
    id: newId("jira"),
    name: `Jira ${index + 1}`,
    baseUrl: "",
    apiVersion: "2",
    authType: "basic",
    email: "",
    extraJql: "",
    clientField: defaultClientField(""),
    enabled: true
  };
}

export function SettingsView({ data, onSaved }: Props) {
  const [draft, setDraft] = useState<Settings>(data.settings);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [tab, setTab] = useState<SettingsTab>(lastTab);
  const [update, setUpdate] = useState<UpdateStatus | null>(lastUpdate);

  const selectTab = (next: SettingsTab) => {
    lastTab = next;
    setTab(next);
  };

  const checkUpdates = async () => {
    setUpdate({ stage: "checking", currentVersion: info?.version || "", releaseUrl: "", message: "Checking GitHub Releases…" });
    let next: UpdateStatus;
    try {
      next = await api().checkForUpdates();
    } catch (error) {
      next = { stage: "error", currentVersion: info?.version || "", releaseUrl: info?.releasesUrl || "", message: errorText(error) };
    }
    lastUpdate = next;
    setUpdate(next);
  };

  useEffect(() => {
    void api().getAppInfo().then(setInfo);
  }, []);

  const reset = () => {
    setDraft(data.settings);
  };

  useEffect(reset, [data.settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  // Preview the theme while choosing it; leaving Settings re-applies the saved one.
  useEffect(() => applyTheme(draft.theme, draft.backgroundColor), [draft.theme, draft.backgroundColor]);

  const patchConnection = (id: string, patch: Partial<JiraConnection>) => {
    setDraft((current) => ({
      ...current,
      jiraConnections: current.jiraConnections.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }));
    setTests((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  // Drag and drop to reorder filters ("All" stays first). `dropAt` is the index the dragged filter
  // would take; it is shown as a line between rows.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const moveFilter = (id: string, toIndex: number) => {
    setDraft((current) => {
      const from = current.filters.findIndex((item) => item.id === id);
      if (from < 0) return current;
      const filters = [...current.filters];
      const [moved] = filters.splice(from, 1);
      filters.splice(toIndex > from ? toIndex - 1 : toIndex, 0, moved);
      return { ...current, filters };
    });
  };

  const endDrag = () => {
    setDragId(null);
    setDropAt(null);
  };

  // Pointer-based dragging: press the handle, move, release. The drop position is the gap between
  // filter rows closest to the pointer.
  const filterListRef = useRef<HTMLDivElement>(null);
  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const list = filterListRef.current;
    if (!list) return;
    setDragId(id);
    const gapAt = (clientY: number) => {
      const rows = [...list.querySelectorAll<HTMLElement>("[data-filter-row]")];
      const index = rows.findIndex((row) => {
        const rect = row.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
      });
      return index < 0 ? rows.length : index;
    };
    setDropAt(gapAt(event.clientY));
    const onMove = (move: PointerEvent) => setDropAt(gapAt(move.clientY));
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      moveFilter(id, gapAt(up.clientY));
      endDrag();
    };
    const onCancel = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      endDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const patchRule = (id: string, patch: Partial<AllocationRule>) =>
    setDraft((current) => ({
      ...current,
      allocationRules: current.allocationRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    }));

  const moveRule = (index: number, step: number) =>
    setDraft((current) => {
      const rules = [...current.allocationRules];
      const [rule] = rules.splice(index, 1);
      rules.splice(index + step, 0, rule);
      return { ...current, allocationRules: rules };
    });

  const patchFilter = (id: string, patch: Partial<FilterGroup>) => {
    setDraft((current) => ({
      ...current,
      filters: current.filters.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }));
  };

  const test = async (connection: JiraConnection) => {
    setTests((current) => ({ ...current, [connection.id]: { status: "running" } }));
    try {
      const result = await api().testConnection(connection);
      setTests((current) => ({
        ...current,
        [connection.id]: { status: "ok", text: `Connected as ${result.displayName}${result.emailAddress ? ` (${result.emailAddress})` : ""}` }
      }));
    } catch (error) {
      setTests((current) => ({ ...current, [connection.id]: { status: "error", text: errorText(error) } }));
    }
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api().saveData({ ...data, settings: draft });
      onSaved(saved);
      setMessage({ ok: true, text: "Settings saved." });
    } catch (error) {
      setMessage({ ok: false, text: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="settings">
      <div className="settingsHeader">
        <h2>Settings</h2>
        <div className="saveArea">
          {message && <span className={message.ok ? "okText" : "errorText"}>{message.text}</span>}
          <button className="ghost" disabled={!dirty || saving} onClick={reset}>
            Discard
          </button>
          <button className="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Save settings
          </button>
        </div>
      </div>

      <div className="settingsBody">
        <nav className="settingsTabs" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          {SETTINGS_TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls="settings-panel"
              className={tab === item.id ? "active" : ""}
              onClick={() => selectTab(item.id)}
            >
              <item.icon size={16} />
              {item.label}
              {item.id === "about" && update?.stage === "available" && <span className="tabDot" aria-label="Update available" />}
            </button>
          ))}
        </nav>
        <div className="settingsPanel" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
          {tab === "jira" && (
            <>
              <section className="panel">
                <div className="panelHead">
                  <div>
                    <h3>Jira sources</h3>
                    <p>Worklogs from every enabled source are shown together in one timesheet.</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        jiraConnections: [...current.jiraConnections, newConnection(current.jiraConnections.length)]
                      }))
                    }
                  >
                    <Plus size={15} /> Add source
                  </button>
                </div>

                {draft.jiraConnections.map((connection) => {
                  const state = tests[connection.id];
                  return (
                    <div className="sourceCard" key={connection.id}>
                      <div className="formGrid">
                        <label>
                          Name
                          <input value={connection.name} onChange={(event) => patchConnection(connection.id, { name: event.target.value })} />
                        </label>
                        <label className="wide">
                          Base URL
                          <input
                            value={connection.baseUrl}
                            placeholder="https://jira.company.com or https://company.atlassian.net"
                            onChange={(event) => {
                              const baseUrl = event.target.value;
                              // The client field follows the URL while it is still the default for the old URL.
                              const followsUrl = !connection.clientField || connection.clientField === defaultClientField(connection.baseUrl);
                              patchConnection(connection.id, followsUrl ? { baseUrl, clientField: defaultClientField(baseUrl) } : { baseUrl });
                            }}
                          />
                        </label>
                        <label>
                          Jira type
                          <select
                            value={connection.apiVersion}
                            onChange={(event) => patchConnection(connection.id, { apiVersion: event.target.value as "2" | "3" })}
                          >
                            <option value="2">Server / Data Center</option>
                            <option value="3">Cloud</option>
                          </select>
                        </label>
                        <label>
                          Authentication
                          <select
                            value={connection.authType}
                            onChange={(event) => patchConnection(connection.id, { authType: event.target.value as "basic" | "bearer" })}
                          >
                            <option value="basic">Password / API token</option>
                            <option value="bearer">Personal access token</option>
                          </select>
                        </label>
                        {connection.authType === "basic" && (
                          <label>
                            {connection.apiVersion === "3" ? "Atlassian email" : "User name"}
                            <input value={connection.email} onChange={(event) => patchConnection(connection.id, { email: event.target.value })} />
                          </label>
                        )}
                        <div className="formField wide">
                          <label htmlFor={`secret-${connection.id}`}>
                            {connection.authType === "bearer" ? "Token / PAT" : connection.apiVersion === "3" ? "API token" : "Password / token"}
                          </label>
                          <div className="secretRow">
                            <input
                              id={`secret-${connection.id}`}
                              type="password"
                              value={connection.token || ""}
                              placeholder={connection.tokenPresent && !connection.clearToken ? "Saved — type to replace" : "Not set"}
                              onChange={(event) => patchConnection(connection.id, { token: event.target.value, clearToken: false })}
                            />
                            {connection.tokenPresent && !connection.clearToken && (
                              <button
                                type="button"
                                className="ghost"
                                title="Delete the saved password/token from this computer"
                                onClick={() => patchConnection(connection.id, { clearToken: true, token: "" })}
                              >
                                Forget
                              </button>
                            )}
                          </div>
                        </div>
                        <label className="wide">
                          Extra issues JQL <span className="muted">(optional — issues to show even without time this month)</span>
                          <input
                            value={connection.extraJql}
                            placeholder='e.g. filter = worklogs   or   assignee = currentUser() AND resolution = Unresolved'
                            onChange={(event) => patchConnection(connection.id, { extraJql: event.target.value })}
                          />
                        </label>
                        <label>
                          Client field <span className="muted">(for top clients)</span>
                          <input
                            value={connection.clientField}
                            placeholder="e.g. customfield_10703"
                            spellCheck={false}
                            onChange={(event) => patchConnection(connection.id, { clientField: event.target.value })}
                          />
                        </label>
                      </div>
                      <div className="sourceActions">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={connection.enabled}
                            onChange={(event) => patchConnection(connection.id, { enabled: event.target.checked })}
                          />
                          Enabled
                        </label>
                        <button className="secondary" onClick={() => void test(connection)} disabled={state?.status === "running"}>
                          {state?.status === "running" ? <LoaderCircle size={15} className="spin" /> : null} Test connection
                        </button>
                        {state?.status === "ok" && (
                          <span className="okText">
                            <CheckCircle2 size={15} /> {state.text}
                          </span>
                        )}
                        {state?.status === "error" && (
                          <span className="errorText">
                            <XCircle size={15} /> {state.text}
                          </span>
                        )}
                        <span className="spacer" />
                        <button
                          className="ghost danger"
                          disabled={draft.jiraConnections.length === 1}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              jiraConnections: current.jiraConnections.filter((item) => item.id !== connection.id)
                            }))
                          }
                        >
                          <Trash2 size={15} /> Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </section>
            </>
          )}
          {tab === "filters" && (
            <>
              <section className="panel">
                <div className="baseJql">
                  <h3>
                    <label htmlFor="base-jql">Base JQL</label>
                  </h3>
                  <p>Builds the base list: the issues shown under "All" and narrowed by quick filters.</p>
                  <div className="baseJqlRow">
                    <input
                      id="base-jql"
                      value={draft.baseJql}
                      spellCheck={false}
                      onChange={(event) => setDraft({ ...draft, baseJql: event.target.value })}
                    />
                    <button
                      type="button"
                      className="secondary"
                      title="Back to the default base JQL"
                      aria-label="Reset base JQL"
                      disabled={draft.baseJql.trim() === DEFAULT_BASE_JQL}
                      onClick={() => setDraft({ ...draft, baseJql: DEFAULT_BASE_JQL })}
                    >
                      <RotateCcw size={14} /> Reset
                    </button>
                  </div>
                  <p className="hint">
                    <code>{"{monthStart}"}</code> and <code>{"{monthEnd}"}</code> are replaced with the first and last day of the month
                    you are viewing, so the list follows the month. Your logged time is read from the issues this JQL returns.
                    For this month it runs: <code>{previewBaseJql(draft.baseJql)}</code>
                  </p>
                </div>

                <div className="panelHead quickFiltersHead">
                  <div>
                    <h3>Quick filters</h3>
                    <p>
                      JQL filters shown as chips above the timesheet. Each narrows the base list; tick <strong>Free</strong> to
                      show exactly the issues its JQL returns instead.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      const id = newId("filter");
                      setDraft((current) => ({ ...current, filters: [...current.filters, { id, label: "", jql: "", free: false, sourceId: "" }] }));
                    }}
                  >
                    <Plus size={15} /> Add filter
                  </button>
                </div>

                <div className="filterRow">
                  <span />
                  <span className="fixedLabel" title="The default view. It always stays first.">All</span>
                  <select disabled aria-label="Jira source for All" title="All always runs on every Jira source">
                    <option>All</option>
                  </select>
                  <input
                    value={draft.allFilter.jql}
                    placeholder="Optional JQL. Empty: issues with your worklogs this month"
                    aria-label="JQL for All"
                    onChange={(event) => setDraft({ ...draft, allFilter: { ...draft.allFilter, jql: event.target.value } })}
                  />
                  <label className="check freeCheck" title="Show exactly the issues this JQL returns, not only the base list">
                    <input
                      type="checkbox"
                      aria-label="Free filter: All"
                      checked={draft.allFilter.free}
                      onChange={(event) => setDraft({ ...draft, allFilter: { ...draft.allFilter, free: event.target.checked } })}
                    />
                    Free
                  </label>
                  <span />
                </div>
                <div ref={filterListRef} className={dragId ? "filterList dragActive" : "filterList"}>
                {draft.filters.map((filter, index) => (
                  <div
                    className={[
                      "filterRow",
                      dragId === filter.id ? "dragging" : "",
                      dragId && dropAt === index ? "dropBefore" : "",
                      dragId && dropAt === index + 1 && index === draft.filters.length - 1 ? "dropAfter" : ""
                    ].join(" ")}
                    key={filter.id}
                    data-filter-row
                  >
                    <span
                      className="dragHandle"
                      role="button"
                      tabIndex={-1}
                      title="Drag to reorder"
                      aria-label={`Move ${filter.label || "filter"}`}
                      onPointerDown={(event) => startDrag(event, filter.id)}
                    >
                      <GripVertical size={16} />
                    </span>
                    <input
                      value={filter.label}
                      placeholder="Label, e.g. Support"
                      onChange={(event) => patchFilter(filter.id, { label: event.target.value })}
                    />
                    {COMMON_FILTER_IDS.includes(filter.id) ? (
                      <select disabled aria-label={`Jira source for ${filter.label || "filter"}`} title="This preset runs on every Jira source">
                        <option>All</option>
                      </select>
                    ) : (
                      <select
                        aria-label={`Jira source for ${filter.label || "filter"}`}
                        title="The Jira this filter runs on"
                        value={draft.jiraConnections.some((item) => item.id === filter.sourceId) ? filter.sourceId : ""}
                        onChange={(event) => patchFilter(filter.id, { sourceId: event.target.value })}
                      >
                        <option value="">All</option>
                        {draft.jiraConnections.map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      value={filter.jql}
                      placeholder="JQL, e.g. project in (SUP, OPS) AND labels = support"
                      aria-label={`JQL for ${filter.label || "filter"}`}
                      onChange={(event) => patchFilter(filter.id, { jql: event.target.value })}
                    />
                    <label className="check freeCheck" title="Show exactly the issues this JQL returns, not only the base list">
                      <input
                        type="checkbox"
                        aria-label={`Free filter: ${filter.label || "filter"}`}
                        checked={filter.free}
                        onChange={(event) => patchFilter(filter.id, { free: event.target.checked })}
                      />
                      Free
                    </label>
                    <button
                      className="icon danger"
                      title="Remove filter"
                      onClick={() => setDraft((current) => ({ ...current, filters: current.filters.filter((item) => item.id !== filter.id) }))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                </div>
              </section>
            </>
          )}
          {tab === "allocation" && (
            <>
              <section className="panel">
                <div className="panelHead">
                  <div>
                    <h3>Worklogs allocation</h3>
                    <p>
                      Categories for the allocation line under the timesheet. Each worklog of the month goes to the first category its
                      issue matches: by issue type, by project (name or key) or by text in the summary. Lists are
                      comma-separated and not case-sensitive. Everything else is <strong>Other</strong>.
                    </p>
                  </div>
                  <div className="panelActions">
                    <button
                      className="secondary"
                      title="Back to the default categories"
                      onClick={() => setDraft({ ...draft, allocationRules: DEFAULT_ALLOCATION_RULES.map((rule) => ({ ...rule })) })}
                    >
                      <RotateCcw size={14} /> Reset
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          allocationRules: [
                            ...current.allocationRules,
                            { id: newId("category"), name: "", types: "", projects: "", summary: "" }
                          ]
                        }))
                      }
                    >
                      <Plus size={15} /> Add category
                    </button>
                  </div>
                </div>
                <div className="ruleRow ruleHead" aria-hidden="true">
                  <span>Category</span>
                  <span>Issue types</span>
                  <span>Projects</span>
                  <span>Summary contains</span>
                  <span />
                </div>
                {draft.allocationRules.map((rule, index) => (
                  <div className="ruleRow" key={rule.id} data-rule-row>
                    <input
                      value={rule.name}
                      placeholder="Name"
                      aria-label={`Category name ${index + 1}`}
                      onChange={(event) => patchRule(rule.id, { name: event.target.value })}
                    />
                    <input
                      value={rule.types}
                      placeholder="e.g. Support Request"
                      aria-label={`Issue types for ${rule.name || "category"}`}
                      onChange={(event) => patchRule(rule.id, { types: event.target.value })}
                    />
                    <input
                      value={rule.projects}
                      placeholder="e.g. Apollo, SUP"
                      aria-label={`Projects for ${rule.name || "category"}`}
                      onChange={(event) => patchRule(rule.id, { projects: event.target.value })}
                    />
                    <input
                      value={rule.summary}
                      placeholder="e.g. SME"
                      aria-label={`Summary text for ${rule.name || "category"}`}
                      onChange={(event) => patchRule(rule.id, { summary: event.target.value })}
                    />
                    <span className="ruleButtons">
                      <button className="icon" title="Move up" aria-label={`Move ${rule.name || "category"} up`} disabled={index === 0} onClick={() => moveRule(index, -1)}>
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="icon"
                        title="Move down"
                        aria-label={`Move ${rule.name || "category"} down`}
                        disabled={index === draft.allocationRules.length - 1}
                        onClick={() => moveRule(index, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="icon danger"
                        title="Remove category"
                        aria-label={`Remove ${rule.name || "category"}`}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            allocationRules: current.allocationRules.filter((item) => item.id !== rule.id)
                          }))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </div>
                ))}
              </section>
            </>
          )}
          {tab === "absences" && (
            <>
              <section className="panel">
                <div className="panelHead">
                  <div>
                    <h3>Absences</h3>
                    <p>
                      Days off registered as Jira issues (vacation, sick leave…). Their working days are left out of the norm
                      and shown in light grey.
                    </p>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label="Use absences"
                      checked={draft.absences.enabled}
                      onChange={(event) => setDraft({ ...draft, absences: { ...draft.absences, enabled: event.target.checked } })}
                    />
                    Use absences
                  </label>
                </div>
                <div className="formGrid">
                  <label>
                    Jira source
                    <select
                      disabled={!draft.absences.enabled}
                      value={draft.absences.sourceId}
                      onChange={(event) => setDraft({ ...draft, absences: { ...draft.absences, sourceId: event.target.value } })}
                    >
                      <option value="">First enabled source</option>
                      {draft.jiraConnections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="wide">
                    Absences JQL
                    <input
                      disabled={!draft.absences.enabled}
                      value={draft.absences.jql}
                      onChange={(event) => setDraft({ ...draft, absences: { ...draft.absences, jql: event.target.value } })}
                    />
                  </label>
                  <span />
                  <label>
                    "Leave from date" field id
                    <input
                      disabled={!draft.absences.enabled}
                      value={draft.absences.fromField}
                      placeholder="customfield_10800"
                      onChange={(event) => setDraft({ ...draft, absences: { ...draft.absences, fromField: event.target.value } })}
                    />
                  </label>
                  <label>
                    "Leave to date" field id
                    <input
                      disabled={!draft.absences.enabled}
                      value={draft.absences.toField}
                      placeholder="customfield_10801"
                      onChange={(event) => setDraft({ ...draft, absences: { ...draft.absences, toField: event.target.value } })}
                    />
                  </label>
                </div>
              </section>
            </>
          )}
          {tab === "timesheet" && (
            <>
              <section className="panel">
                <h3>Timesheet</h3>
                <div className="formGrid">
                  <label>
                    New worklog start time
                    <input
                      type="time"
                      value={draft.worklogStartTime}
                      onChange={(event) => setDraft({ ...draft, worklogStartTime: event.target.value || "09:00" })}
                    />
                  </label>
                  <label>
                    Daily norm, hours
                    <input
                      type="number"
                      min={1}
                      max={24}
                      step={0.5}
                      value={draft.dailyNormHours}
                      onChange={(event) => setDraft({ ...draft, dailyNormHours: Number(event.target.value) || 8 })}
                    />
                  </label>
                  <label>
                    Show time as
                    <select
                      value={draft.displayFormat}
                      onChange={(event) => setDraft({ ...draft, displayFormat: event.target.value as "decimal" | "jira" })}
                    >
                      <option value="decimal">Decimal hours (1.5)</option>
                      <option value="jira">Jira style (1h 30m)</option>
                    </select>
                  </label>
                  <label className="check standalone">
                    <input
                      type="checkbox"
                      checked={draft.showWeekends}
                      onChange={(event) => setDraft({ ...draft, showWeekends: event.target.checked })}
                    />
                    Always show weekends
                  </label>
                  <label className="check standalone">
                    <input
                      type="checkbox"
                      checked={draft.askComment}
                      onChange={(event) => setDraft({ ...draft, askComment: event.target.checked })}
                    />
                    Ask for a comment on new worklogs
                  </label>
                </div>
              </section>
            </>
          )}
          {tab === "appearance" && (
            <>
              <section className="panel">
                <h3>Appearance</h3>
                <div className="formGrid">
                  <label>
                    Theme
                    <select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Theme })}>
                      <option value="classic">Classic (original)</option>
                      <option value="system">Same as system</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>
                  <label>
                    Table font
                    <select
                      value={draft.tableFont}
                      style={{ fontFamily: tableFontStack(draft.tableFont) }}
                      onChange={(event) => setDraft({ ...draft, tableFont: event.target.value })}
                    >
                      {TABLE_FONTS.map((font) => (
                        <option key={font.id} value={font.id} style={{ fontFamily: font.stack }}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Table font size
                    <select
                      value={draft.tableFontSize}
                      onChange={(event) => setDraft({ ...draft, tableFontSize: Number(event.target.value) })}
                    >
                      {TABLE_FONT_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Background colour
                    <span className="colorField">
                      <input
                        type="color"
                        aria-label="Background colour"
                        value={draft.backgroundColor || themeBackground(draft.theme)}
                        onChange={(event) => setDraft({ ...draft, backgroundColor: event.target.value })}
                      />
                      <span className="colorValue">{draft.backgroundColor || "Theme default"}</span>
                      {draft.backgroundColor && (
                        <button type="button" className="ghost" onClick={() => setDraft({ ...draft, backgroundColor: "" })}>
                          Reset
                        </button>
                      )}
                    </span>
                  </label>
                  <label className="check standalone">
                    <input
                      type="checkbox"
                      checked={draft.showTypeIcons}
                      onChange={(event) => setDraft({ ...draft, showTypeIcons: event.target.checked })}
                    />
                    Show issue type icons
                  </label>
                </div>
              </section>
            </>
          )}
          {tab === "about" && (
            <section className="panel about">
              <div className="aboutHead">
                <img className="aboutIcon" src={appIcon} alt="" />
                <div>
                  <h3>Timesheets</h3>
                  <p>
                    Version {info?.version || "…"}
                    {info?.author ? ` · by ${info.author}` : ""}
                  </p>
                </div>
              </div>

              <div className="updateBox">
                <div className="updateRow">
                  <button className="secondary" onClick={() => void checkUpdates()} disabled={update?.stage === "checking"}>
                    {update?.stage === "checking" ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Check for
                    updates
                  </button>
                  {update && update.stage !== "checking" && (
                    <span className={update.stage === "error" ? "errorText" : update.stage === "available" ? "updateAvailable" : "okText"}>
                      {update.stage === "up-to-date" && <CheckCircle2 size={15} />}
                      {update.stage === "error" && <XCircle size={15} />}
                      {update.message}
                    </span>
                  )}
                </div>
                {update?.stage === "available" && (
                  <div className="updateDetails">
                    <div className="updateRow">
                      {update.downloadUrl && (
                        <button className="primary" onClick={() => void api().openExternal(update.downloadUrl!)}>
                          <Download size={15} /> Download {update.downloadName}
                        </button>
                      )}
                      <button className="secondary" onClick={() => void api().openExternal(update.releaseUrl)}>
                        <ExternalLink size={15} /> Open release page
                      </button>
                    </div>
                    <p className="hint">
                      Replace the app with the downloaded file; your settings and saved password are kept.
                      {update.releaseDate ? ` Released ${update.releaseDate}.` : ""}
                    </p>
                    {update.releaseNotes?.trim() && (
                      <div className="releaseNotes">
                        <strong>What's new in {update.version}</strong>
                        <pre>{update.releaseNotes.trim()}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {info && (
                <p className="appInfo">
                  Settings file: <code>{info.dataFilePath}</code>
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
