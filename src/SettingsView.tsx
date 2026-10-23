import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, Plus, Save, Trash2, XCircle } from "lucide-react";
import { api, errorText } from "./api";
import type { AppData, AppInfo, FilterGroup, JiraConnection, Settings, Theme } from "./types";
import { applyTheme } from "./theme";
import { TABLE_FONT_SIZES, TABLE_FONTS, tableFontStack } from "./fonts";

interface Props {
  data: AppData;
  onSaved: (data: AppData) => void;
}

type TestState = { status: "running" } | { status: "ok"; text: string } | { status: "error"; text: string };

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
    enabled: true
  };
}

export function SettingsView({ data, onSaved }: Props) {
  const [draft, setDraft] = useState<Settings>(data.settings);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void api().getAppInfo().then(setInfo);
  }, []);

  const reset = () => {
    setDraft(data.settings);
  };

  useEffect(reset, [data.settings]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  // Preview the theme while choosing it; leaving Settings re-applies the saved one.
  useEffect(() => applyTheme(draft.theme), [draft.theme]);

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
                    onChange={(event) => patchConnection(connection.id, { baseUrl: event.target.value })}
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
                <label>
                  {connection.authType === "bearer" ? "Token / PAT" : connection.apiVersion === "3" ? "API token" : "Password / token"}
                  <input
                    type="password"
                    value={connection.token || ""}
                    placeholder={connection.tokenPresent && !connection.clearToken ? "Saved — type to replace" : "Not set"}
                    onChange={(event) => patchConnection(connection.id, { token: event.target.value, clearToken: false })}
                  />
                </label>
                <label className="full">
                  Extra issues JQL <span className="muted">(optional — issues to show even without time this month)</span>
                  <input
                    value={connection.extraJql}
                    placeholder='e.g. filter = worklogs   or   assignee = currentUser() AND resolution = Unresolved'
                    onChange={(event) => patchConnection(connection.id, { extraJql: event.target.value })}
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
                {connection.tokenPresent && !connection.clearToken && (
                  <button className="ghost" onClick={() => patchConnection(connection.id, { clearToken: true, token: "" })}>
                    Forget secret
                  </button>
                )}
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

      <section className="panel">
        <div className="panelHead">
          <div>
            <h3>Filters</h3>
            <p>
              Quick filters above the timesheet. Each one shows the timesheet issues that match its JQL, e.g.{" "}
              <code>project in (SUP, OPS)</code> or <code>labels = support</code>.
            </p>
          </div>
          <button
            className="secondary"
            onClick={() => {
              const id = newId("filter");
              setDraft((current) => ({ ...current, filters: [...current.filters, { id, label: "", jql: "" }] }));
            }}
          >
            <Plus size={15} /> Add filter
          </button>
        </div>
        {!draft.filters.length && <p className="muted">No filters yet.</p>}
        {draft.filters.map((filter) => (
          <div className="filterRow" key={filter.id}>
            <input
              value={filter.label}
              placeholder="Label, e.g. Support"
              onChange={(event) => patchFilter(filter.id, { label: event.target.value })}
            />
            <input
              value={filter.jql}
              placeholder="JQL, e.g. project in (SUP, OPS) AND labels = support"
              aria-label={`JQL for ${filter.label || "filter"}`}
              onChange={(event) => patchFilter(filter.id, { jql: event.target.value })}
            />
            <button
              className="icon danger"
              title="Remove filter"
              onClick={() => setDraft((current) => ({ ...current, filters: current.filters.filter((item) => item.id !== filter.id) }))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </section>

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
            Theme
            <select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Theme })}>
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
                  {size}px{size === 14 ? " (default)" : ""}
                </option>
              ))}
            </select>
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
        </div>
      </section>

      {info && (
        <p className="appInfo">
          Version {info.version} · Settings file: <code>{info.dataFilePath}</code>
        </p>
      )}
    </main>
  );
}
