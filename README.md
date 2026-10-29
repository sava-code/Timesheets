# Timesheets

A desktop app for managing your Jira worklogs in a monthly, spreadsheet-like grid. The easiest way to manage your daily worklogs.

You can add/modify your worklogs in several jira instances right in the table form - like in Excel

![Timesheets main window](docs/screenshot.png)

## Features

Timesheets selects jira issues from several Jira endpoints by the following JQL via jira API, and represents the data in the grid:

```
(worklogAuthor = currentuser() AND worklogDate >= startOfMonth({{selected month}}) AND worklogDate <= endOfMonth({{selected month}}))
```

Additionally, it collects data on your registered absences (e.g. vacations) from Jira, and updates the planned worklog indicators accordingly. See Settings -> Absences: they are used whenever the JQL and both date fields are filled in (preset to the Delivery Jira on company computers); clear the JQL to turn them off.

Now you can add new worklog or update an existing one by just a double-click in a table cell. The application automatically registers/updates a worklog once the new value has been set.

You can set spent time either in hours in **decimals** (1.5) or in jira-like format (e.g. **1h 45m**).

You can optionally set additional filters list (e.g. "Support tickets" / "Development"), see predefined filters for reference.

Issue type icons next to the summaries are off by default; switch them on in Settings -> Appearance.

Under the table, the Allocation line splits the month's worklogs into categories, each defined by a JQL (e.g. `project in ("Custom Development", MRJ) OR summary ~ "SME"`), optionally on one Jira source; a worklog goes to the first category that matches. See Settings -> Allocation. It loads alongside the grid, so the table never waits for it.

On a Windows remote desktop (RDP, Citrix) the app switches off GPU acceleration, smooth scrolling and animations, which are slow over a remote connection.

## First Run

Builds are not signed with a paid certificate, so expect a warning on first launch:

- **Windows**: SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.
- **macOS**: the app is ad-hoc signed, but it is not notarized. On first launch macOS says it cannot verify the app. Go to **System Settings → Privacy & Security** and click **Open Anyway**. Alternatively, remove the download quarantine in Terminal:

  ```bash
  xattr -cr "/Applications/Timesheets.app"
  ```

## Setup

1. Open **Settings**. On first launch the app opens there automatically.
Set login and password. The credentials stored securily in macOS Keychain / Windows Credential Locker.
2. Click **Test connection**, then **Save settings**.
3. Optionally add project filters, the worklog start time, the daily norm and the time format.

Settings are stored in the app's profile folder. The exact path is shown at the bottom of Settings.

## Develop

```bash
npm install
npm run dev        # Electron + Vite with hot reload
npm run dev:web    # browser only, with built-in demo data (no Jira needed)
npm test           # unit + UI tests (Vitest)
```

## Build

```bash
npm run dist           # Windows portable   → release/Timesheets-<version>-portable.exe (no install needed)
npm run dist:installer # Windows installer  → release/Timesheets-<version>-setup.exe
npm run dist:mac       # macOS dmg (run on a Mac)
```

The GitHub Actions workflow `.github/workflows/build.yml` builds the Windows portable .exe and the macOS installers when you push a `v*` tag, and attaches them to the release. You can also run it manually.

## Project layout

```text
electron/
  main.cjs          window + IPC handlers
  preload.cjs       window.timesheets bridge
  jira.cjs          Jira REST calls (search, worklogs, create/update/delete)
  jira-core.cjs     pure helpers: JQL, auth, mapping (unit-tested)
  storage*.cjs      settings file + encrypted secrets (unit-tested)
  domain.cjs        Windows domain / Mac DNS and name, for first-launch Jira presets
docs/
  screenshot.png    main window, for this README
src/
  TimesheetView.tsx grid, keyboard editing, filters, activity log
  SettingsView.tsx  Jira sources, filters, preferences
  timesheet.ts      pivot + cell edit planning (unit-tested)
  time.ts           time parsing/formatting, month helpers (unit-tested)
  devApi.ts         demo backend for the browser preview and tests
```
