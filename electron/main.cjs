const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const { dataFilePath, normalizeIncomingData, readRawData, sanitizeData, writeRawData } = require("./storage.cjs");
const jira = require("./jira.cjs");
const packageMetadata = require("../package.json");

let mainWindow;

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
  const absenceSource = absenceSettings.enabled
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
        const result = await jira.fetchSourceMonth(connection, month);
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

// Free JQL (search box or free filter): the issues it returns on every enabled source.
ipcMain.handle("jira:searchIssues", async (_event, jql) => {
  const connections = activeConnections(readRawData());
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

ipcMain.handle("app:getInfo", async () => ({
  version: packageMetadata.version,
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
