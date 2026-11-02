import { useEffect, useState } from "react";
import { CalendarDays, CircleArrowUp, Settings as SettingsIcon } from "lucide-react";
import { api, errorText } from "./api";
import type { AppData, UpdateStatus } from "./types";
import { TimesheetView } from "./TimesheetView";
import { SettingsView, type SettingsTab } from "./SettingsView";
import { applyTheme } from "./theme";
import appIcon from "./assets/icon.svg";

type View = "timesheet" | "settings";

export default function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("timesheet");
  // Latest version check: once when the app opens, and again from Settings → About & updates.
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  // Settings tab to open next (the update notice opens About & updates); bumped to reopen it.
  const [settingsTab, setSettingsTab] = useState<{ tab: SettingsTab; count: number } | null>(null);

  // The saved theme; Settings previews unsaved choices itself and restores this on leave.
  const savedTheme = data?.settings.theme ?? "classic";
  const savedBackground = data?.settings.backgroundColor ?? "";
  useEffect(() => applyTheme(savedTheme, savedBackground), [savedTheme, savedBackground, view]);

  useEffect(() => {
    api()
      .loadData()
      .then((loaded) => {
        setData(loaded);
        if (!loaded.settings.jiraConnections.some((item) => item.baseUrl)) setView("settings");
      })
      .catch((reason) => setError(errorText(reason)));
    // Remote desktop: no animations or transitions, as every repainted frame crosses the network.
    void api()
      .getAppInfo()
      .then((info) => document.documentElement.classList.toggle("remoteSession", Boolean(info.remoteSession)))
      .catch(() => undefined);
    // New version check on start. Quiet: only a newer version shows up (in the top bar); being offline
    // or GitHub not answering shows nothing.
    let cancelled = false;
    api()
      .checkForUpdates()
      .then((status) => {
        if (!cancelled && status.stage !== "error") setUpdate((current) => current ?? status);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const openSettings = (tab?: SettingsTab) => {
    if (tab) setSettingsTab((current) => ({ tab, count: (current?.count || 0) + 1 }));
    setView("settings");
  };

  return (
    <div className="appShell">
      <header className="topBar">
        <div className="brand">
          <img className="brandMark" src={appIcon} alt="" />
          <h1>Timesheets</h1>
        </div>
        <nav className="tabs">
          {update?.stage === "available" && (
            <button
              className="updateNotice"
              title={`Timesheets ${update.version} is available (you have ${update.currentVersion}). Open About & updates to download it.`}
              onClick={() => openSettings("about")}
            >
              <CircleArrowUp size={16} /> Version {update.version} available
            </button>
          )}
          <button className={view === "timesheet" ? "active" : ""} onClick={() => setView("timesheet")}>
            <CalendarDays size={16} /> Timesheet
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => openSettings()}>
            <SettingsIcon size={16} /> Settings
          </button>
        </nav>
      </header>

      {error && <div className="fatal">Could not load settings: {error}</div>}
      {/* The timesheet stays mounted while Settings is open, so its table, month and filter survive. */}
      {data && (
        <div className="viewHost" hidden={view !== "timesheet"}>
          <TimesheetView data={data} onOpenSettings={() => openSettings()} />
        </div>
      )}
      {data && view === "settings" && (
        <SettingsView data={data} onSaved={setData} update={update} onUpdate={setUpdate} tabRequest={settingsTab} />
      )}
    </div>
  );
}
