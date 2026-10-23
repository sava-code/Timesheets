# Timesheets

A desktop app for managing your Jira worklogs in a monthly, spreadsheet-like grid. It is a rewrite of the Python/Dash [jira-timesheets](https://github.com/mixaxa85/jira-timesheets) tool.

Jira is the only source of truth. Each cell shows your own logged time on one issue for one day. Changing a cell writes to Jira immediately.

## Features

- **Month grid.** Rows are issues, columns are days, with daily totals at the top and a total for each issue. Navigate to any month.
- **Spreadsheet editing.** Click a cell and type, or double-click it. Enter moves down, Tab moves right, arrow keys move, Esc cancels, Delete clears the cell.
- **Flexible time input.** Accepts `1.5`, `1,5`, `1h 30m`, `90m`, `1.5h` and `1:30`. An empty value or `0` deletes the time.
- **Several Jira instances in one grid.** Supports Jira Server/Data Center (API v2) and Jira Cloud (API v3), with password/API token or personal access token auth.
- **Extra issues.** Each source can have an optional JQL (for example `filter = worklogs`) to list issues before you have logged time on them. You can also add any issue by key; it stays in the list until you remove it.
- **JQL filters.** Quick filter chips, each defined by a label and a JQL (e.g. `project in (SUP, OPS)`, `labels = support`, `component = Billing`). Selecting one shows the timesheet issues that match it in Jira. There is also a text search.
- **Daily norm.** The daily totals row is green when a past working day reaches the norm, amber when it is short and red when it is empty. The header shows hours logged, the norm to date and the month norm.
- **Sorted by time.** Issues with the most logged time in the month come first. The order is set when the month loads or refreshes, so rows don't jump while you type.
- **Table font and size** are adjustable in Settings; the whole table scales with the size.
- **Look.** The table heading rows use the app header colour and the table sits on the window background. In Settings you can pick the theme (default *Classic*, with table details from the original Python app; also light, dark or same as system), the table font and size (default Segoe UI/Arial 12px), bold or regular table text (bold by default) and a custom background colour for the window and table. Decimal hours are shown with one decimal; the cell editor shows the exact value.
- **Activity log** with every change sent to Jira and any error.
- **Credentials** are encrypted with the OS keychain (Electron `safeStorage`). The app refuses to store them as plain text.

### How editing a cell maps to Jira

| Cell change | What is sent to Jira |
|---|---|
| empty → value | one new worklog, started at the configured time (default 09:00 local) |
| value goes up | the difference is added to that day's latest worklog |
| value goes down | worklogs are shortened, never deleted, as long as each can keep at least 1 minute (Jira's minimum) |
| cleared | all of your worklogs on that cell are deleted |

Lowering time avoids deletes because many Jira setups allow people to edit their own worklogs but not delete them. If your account cannot delete worklogs, clearing a cell keeps each worklog at 1 minute (the closest value Jira allows) and the Activity log says so.

The app asks for confirmation before deleting more than one worklog, or any worklog that has a comment. Comments and start times of existing worklogs are kept.

## Differences from the Python version

- No `var.json` or keyring command. Everything is set up in **Settings** inside the app.
- Any number of Jira instances. A second instance is no longer required.
- Any month, not only the current one.
- Filters are JQL queries instead of project-key lists. The hardcoded `POWJ` exclusion is gone; use a filter or the extra JQL instead.
- Clearing or reducing a cell works correctly. The Python version tried to set the worklog to 0, which Jira rejects.
- The "worklogs" filter is optional and configurable per source. ScriptRunner is not needed.

## Setup

1. Open **Settings**. On first launch the app opens there automatically.
2. For each Jira, fill in the following:
   - **Base URL**: e.g. `https://jira.company.com` or `https://company.atlassian.net`
   - **Jira type**: Server / Data Center or Cloud
   - **Authentication**:
     - Cloud: Atlassian email + [API token](https://id.atlassian.com/manage-profile/security/api-tokens)
     - Server/DC: user name + password, or a personal access token
   - **Extra issues JQL** (optional): e.g. `filter = worklogs`
3. Click **Test connection**, then **Save settings**.
4. Optionally add project filters, the worklog start time, the daily norm and the time format.

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
npm run dist           # Windows installer  → release/Timesheets-<version>-setup.exe
npm run dist:portable  # Windows portable   → release/Timesheets-<version>-portable.exe
npm run dist:mac       # macOS dmg + zip (run on a Mac)
```

The GitHub Actions workflow `.github/workflows/build.yml` builds the Windows and macOS installers when you push a `v*` tag, and attaches them to the release. You can also run it manually.

Builds are not signed with a paid certificate, so expect a warning on first launch:

- **Windows**: SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.
- **macOS**: the app is ad-hoc signed, but it is not notarized. On first launch macOS says it cannot verify the app. Go to **System Settings → Privacy & Security** and click **Open Anyway**. Alternatively, remove the download quarantine in Terminal:

  ```bash
  xattr -cr "/Applications/Timesheets.app"
  ```

## Project layout

```text
electron/
  main.cjs          window + IPC handlers
  preload.cjs       window.timesheets bridge
  jira.cjs          Jira REST calls (search, worklogs, create/update/delete)
  jira-core.cjs     pure helpers: JQL, auth, mapping (unit-tested)
  storage*.cjs      settings file + encrypted secrets (unit-tested)
src/
  TimesheetView.tsx grid, keyboard editing, filters, activity log
  SettingsView.tsx  Jira sources, filters, preferences
  timesheet.ts      pivot + cell edit planning (unit-tested)
  time.ts           time parsing/formatting, month helpers (unit-tested)
  devApi.ts         demo backend for the browser preview and tests
```
