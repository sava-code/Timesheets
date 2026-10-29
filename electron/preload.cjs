const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("timesheets", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data) => ipcRenderer.invoke("data:save", data),
  fetchMonth: (month) => ipcRenderer.invoke("jira:fetchMonth", month),
  fetchAllocation: (month) => ipcRenderer.invoke("jira:fetchAllocation", month),
  searchIssues: (jql, sourceId) => ipcRenderer.invoke("jira:searchIssues", jql, sourceId),
  matchFilter: (jql, keysBySource) => ipcRenderer.invoke("jira:matchFilter", jql, keysBySource),
  createWorklog: (sourceId, payload) => ipcRenderer.invoke("jira:createWorklog", sourceId, payload),
  updateWorklog: (sourceId, payload) => ipcRenderer.invoke("jira:updateWorklog", sourceId, payload),
  deleteWorklog: (sourceId, payload) => ipcRenderer.invoke("jira:deleteWorklog", sourceId, payload),
  testConnection: (connection) => ipcRenderer.invoke("jira:testConnection", connection),
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  checkForUpdates: () => ipcRenderer.invoke("update:check")
});
