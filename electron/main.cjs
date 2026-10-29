const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { dataFilePath, normalizeIncomingData, readRawData, sanitizeData, writeRawData } = require("./storage.cjs");
const jira = require("./jira.cjs");
const storageCore = require("./storage-core.cjs");
const packageMetadata = require("../package.json");
const updates = require("./update-core.cjs");

let mainWindow;

// Windows remote desktop (RDP, Citrix): there is no real GPU, and every repainted frame travels over
// the network. Chromium's GPU emulation is slower there than plain software drawing, and smooth
// scrolling turns each wheel step into a dozen frames, so both are switched off for such sessions.
const remoteSession = process.platform === "win32" && /^(rdp-|ica-)/i.test(process.env.SESSIONNAME || "");
if (remoteSession) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-smooth-scrolling");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    title: "Timesheets",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);

  // Links (e.g. issue keys) open in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function findConnection(data, sourceId) {
  const connection = data.settings.jiraConnections.find((item) => item.id === sourceId);
  if (!connection) throw new Error(`Jira source is not configured: ${sourceId}`);
  return connection;
}

function activeConnections(data) {
  return data.settings.jiraConnections.filter((item) => item.enabled && item.baseUrl);
}

ipcMain.handle("data:load", async () => sanitizeData(readRawData()));

ipcMain.handle("data:save", async (_event, incoming) => {
  const next = normalizeIncomingData(incoming, readRawData());
  writeRawData(next);
  return sanitizeData(next);
});

ipcMain.handle("jira:fetchMonth", async (_event, month) => {
  const data = readRawData();
  const connections = activeConnections(data);
  const sources = [];
  const errors = [];
  let absences = [];
  const absenceErrors = [];
  const absenceSettings = data.settings.absences;
  const absenceSource = storageCore.absencesConfigured(absenceSettings)
    ? connections.find((item) => item.id === absenceSettings.sourceId) || connections[0]
    : null;

  const loadAbsences = async () => {
    if (!absenceSource) return;
    try {
      absences = await jira.fetchAbsences(absenceSource, absenceSettings);
    } catch (error) {
      absenceErrors.push({ sourceId: absenceSource.id, sourceName: absenceSource.name, message: error.message });
    }
  };

  await Promise.all([
    loadAbsences(),
    ...connections.map(async (connection) => {
      try {
        const result = await jira.fetchSourceMonth(connection, month, data.settings.baseJql);
        if (result.warning) {
          errors.push({ sourceId: connection.id, sourceName: connection.name, message: result.warning });
        }
        sources.push({
          sourceId: connection.id,
          sourceName: connection.name,
          user: result.user,
          issues: result.issues,
          worklogs: result.worklogs
        });
      } catch (error) {
        errors.push({ sourceId: connection.id, sourceName: connection.name, message: error.message });
      }
    })
  ]);

  return { month, sources, errors, configured: connections.length, absences, absenceErrors };
});

// Worklogs allocation for a month, loaded alongside jira:fetchMonth so the grid never waits for it.
// matches[ruleId][sourceId] = issue keys of the month that the category's JQL matches.
ipcMain.handle("jira:fetchAllocation", async (_event, month) => {
  const data = readRawData();
  const rules = data.settings.allocationRules.filter((rule) => rule.jql);
  const matches = Object.fromEntries(rules.map((rule) => [rule.id, {}]));
  const errors = [];
  await Promise.all(
    activeConnections(data).map(async (connection) => {
      const own = rules.filter((rule) => !rule.sourceId || rule.sourceId === connection.id);
      if (!own.length) return;
      const result = await jira.fetchAllocation(connection, month, data.settings.baseJql, own);
      for (const [ruleId, keys] of Object.entries(result.matches)) matches[ruleId][connection.id] = keys;
      for (const error of result.errors) {
        const rule = rules.find((item) => item.id === error.ruleId);
        errors.push({ sourceId: connection.id, sourceName: connection.name, message: `${rule?.name || "Category"}: ${error.message}` });
      }
    })
  );
  return { month, matches, errors };
});

// Free JQL (search box or free filter): the issues it returns on every enabled source,
// or only on the filter's own source.
ipcMain.handle("jira:searchIssues", async (_event, jql, sourceId) => {
  const connections = activeConnections(readRawData()).filter((connection) => !sourceId || connection.id === sourceId);
  const sources = [];
  const errors = [];
  await Promise.all(
    connections.map(async (connection) => {
      try {
        const result = await jira.searchIssues(connection, jql);
        sources.push({ sourceId: connection.id, sourceName: connection.name, ...result });
      } catch (error) {
        errors.push({ sourceId: connection.id, sourceName: connection.name, message: error.message });
      }
    })
  );
  return { sources, errors };
});

// Runs a filter JQL on each source, limited to the issues currently in the timesheet.
ipcMain.handle("jira:matchFilter", async (_event, jql, keysBySource) => {
  const data = readRawData();
  const matches = {};
  const errors = [];
  await Promise.all(
    Object.entries(keysBySource || {}).map(async ([sourceId, keys]) => {
      if (!Array.isArray(keys) || !keys.length) {
        matches[sourceId] = [];
        return;
      }
      const connection = findConnection(data, sourceId);
      try {
        matches[sourceId] = await jira.matchFilter(connection, jql, keys);
      } catch (error) {
        errors.push({ sourceId, sourceName: connection.name, message: error.message });
      }
    })
  );
  return { matches, errors };
});

ipcMain.handle("jira:createWorklog", async (_event, sourceId, payload) => {
  const data = readRawData();
  return jira.createWorklog(findConnection(data, sourceId), {
    ...payload,
    startTime: data.settings.worklogStartTime
  });
});

ipcMain.handle("jira:updateWorklog", async (_event, sourceId, payload) =>
  jira.updateWorklog(findConnection(readRawData(), sourceId), payload)
);

ipcMain.handle("jira:deleteWorklog", async (_event, sourceId, payload) =>
  jira.deleteWorklog(findConnection(readRawData(), sourceId), payload)
);

ipcMain.handle("jira:testConnection", async (_event, draft) => {
  const stored = readRawData().settings.jiraConnections.find((item) => item.id === draft?.id) || {};
  const connection = {
    ...draft,
    tokenCipher: draft?.clearToken ? undefined : stored.tokenCipher,
    token: typeof draft?.token === "string" ? draft.token.trim() : ""
  };
  return jira.testConnection(connection);
});

ipcMain.handle("app:openExternal", async (_event, url) => {
  if (/^https?:\/\//i.test(String(url))) await shell.openExternal(String(url));
});

// Asks GitHub Releases for a newer version; never downloads or installs anything by itself.
ipcMain.handle("update:check", async () => {
  try {
    return await updates.checkGitHubLatestRelease(app.getVersion(), process.platform);
  } catch (error) {
    return { stage: "error", currentVersion: app.getVersion(), releaseUrl: updates.GITHUB_RELEASES_URL, message: error.message };
  }
});

ipcMain.handle("app:getInfo", async () => ({
  version: packageMetadata.version,
  remoteSession,
  author: packageMetadata.author,
  releasesUrl: updates.GITHUB_RELEASES_URL,
  dataFilePath: dataFilePath()
}));

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
