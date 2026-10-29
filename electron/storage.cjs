const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const core = require("./storage-core.cjs");
const { computerIdentity } = require("./domain.cjs");

const DATA_FILE = "timesheets-data.json";
// Where versions before the rename to "Timesheets" kept their settings.
const PREVIOUS_LOCATIONS = [
  ["Jira Timesheets", "jira-timesheets-data.json"],
  ["jira-timesheets-desktop", "jira-timesheets-data.json"]
];
let migrated = false;

// Copies settings from the previously named app on first start. Saved passwords stay
// unreadable (the OS keychain key belongs to the old app name) and must be re-entered.
function migrateFromPreviousName(file) {
  if (migrated) return;
  migrated = true;
  if (fs.existsSync(file)) return;
  for (const [folder, name] of PREVIOUS_LOCATIONS) {
    const previous = path.join(app.getPath("appData"), folder, name);
    if (previous !== file && fs.existsSync(previous)) {
      fs.copyFileSync(previous, file);
      return;
    }
  }
}

function dataFilePath() {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DATA_FILE);
  migrateFromPreviousName(file);
  return file;
}

function writeRawData(data) {
  const file = dataFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

// First launch: company users (openwaygroup.com domain on Windows, "OW…" Mac) start with their Jira sources pre-set.
function firstLaunchData() {
  return core.initialData({ companyDomain: core.isCompanyComputer(computerIdentity()) });
}

function readRawData() {
  const file = dataFilePath();
  if (!fs.existsSync(file)) {
    const initial = firstLaunchData();
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

// tokenPresent tells the UI a password is usable, so an unreadable one counts as missing.
function sanitizeData(data) {
  const visible = core.sanitizeData(data);
  visible.settings.jiraConnections = visible.settings.jiraConnections.map((connection, index) => ({
    ...connection,
    tokenPresent: Boolean(decryptToken(data.settings.jiraConnections[index]))
  }));
  return visible;
}

module.exports = {
  dataFilePath,
  decryptToken,
  normalizeIncomingData,
  readRawData,
  sanitizeData,
  writeRawData
};
