const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const core = require("./storage-core.cjs");

function dataFilePath() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "jira-timesheets-data.json");
}

function writeRawData(data) {
  const file = dataFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function readRawData() {
  const file = dataFilePath();
  if (!fs.existsSync(file)) {
    const initial = core.defaultData();
    writeRawData(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const merged = core.mergeDefaults(parsed);
    // mergeDefaults drops secrets; carry them over by connection id.
    const ciphers = new Map((parsed?.settings?.jiraConnections || []).map((item) => [item.id, item.tokenCipher]));
    merged.settings.jiraConnections = merged.settings.jiraConnections.map((connection) =>
      ciphers.get(connection.id) ? { ...connection, tokenCipher: ciphers.get(connection.id) } : connection
    );
    return merged;
  } catch (_error) {
    fs.copyFileSync(file, `${file}.broken-${Date.now()}`);
    const initial = core.defaultData();
    writeRawData(initial);
    return initial;
  }
}

function decryptToken(connection) {
  return core.decryptToken(connection, safeStorage);
}

function normalizeIncomingData(incoming, existing) {
  return core.normalizeIncomingData(incoming, existing, safeStorage);
}

module.exports = {
  dataFilePath,
  decryptToken,
  normalizeIncomingData,
  readRawData,
  sanitizeData: core.sanitizeData,
  writeRawData
};
