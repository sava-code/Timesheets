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
    title: "Jira Timesheets",
    backgroundColor: "#f6f7f9",
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

  await Promise.all(
    connections.map(async (connection) => {
      try {
        const result = await jira.fetchSourceMonth(connection, month);
        const known = new Set(result.issues.map((issue) => issue.key));
        const pinned = data.pinnedIssues.filter((item) => item.sourceId === connection.id && !known.has(item.key));
        for (const item of pinned) {
          try {
            result.issues.push(await jira.lookupIssue(connection, item.key));
          } catch (error) {
            errors.push({ sourceId: connection.id, sourceName: connection.name, message: `${item.key}: ${error.message}` });
          }
        }
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
  );

  return { month, sources, errors, configured: connections.length };
});

ipcMain.handle("jira:addIssue", async (_event, sourceId, issueKey) => {
  const data = readRawData();
  const issue = await jira.lookupIssue(findConnection(data, sourceId), issueKey);
  if (!data.pinnedIssues.some((item) => item.sourceId === sourceId && item.key === issue.key)) {
    data.pinnedIssues.push({ sourceId, key: issue.key });
    writeRawData(data);
  }
  return { data: sanitizeData(data), issue };
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
