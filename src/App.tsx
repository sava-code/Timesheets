import { useEffect, useState } from "react";
import { CalendarDays, Settings as SettingsIcon } from "lucide-react";
import { api, errorText } from "./api";
import type { AppData } from "./types";
import { TimesheetView } from "./TimesheetView";
import { SettingsView } from "./SettingsView";
import { applyTheme } from "./theme";

type View = "timesheet" | "settings";

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("timesheet");

  // The saved theme; Settings previews unsaved choices itself and restores this on leave.
  const savedTheme = data?.settings.theme ?? "system";
  useEffect(() => applyTheme(savedTheme), [savedTheme, view]);

  useEffect(() => {
    api()
      .loadData()
      .then((loaded) => {
        setData(loaded);
        if (!loaded.settings.jiraConnections.some((item) => item.baseUrl)) setView("settings");
      })
      .catch((reason) => setError(errorText(reason)));
  }, []);

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="brand">
          <span className="brandMark">TS</span>
          <h1>Jira Timesheets</h1>
        </div>
        <nav className="tabs">
          <button className={view === "timesheet" ? "active" : ""} onClick={() => setView("timesheet")}>
            <CalendarDays size={16} /> Timesheet
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <SettingsIcon size={16} /> Settings
          </button>
        </nav>
      </header>

      {error && <div className="fatal">Could not load settings: {error}</div>}
      {data && view === "timesheet" && (
        <TimesheetView data={data} onDataChange={setData} onOpenSettings={() => setView("settings")} />
      )}
      {data && view === "settings" && <SettingsView data={data} onSaved={setData} />}
    </div>
  );
}
