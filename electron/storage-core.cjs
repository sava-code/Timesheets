// Pure settings logic (no Electron imports) so it can be unit-tested.

const DATA_VERSION = 3;

// Default look. Settings files from older versions are switched to it once (see mergeDefaults).
const DEFAULT_APPEARANCE = {
  theme: "classic",
  tableFont: "system",
  tableFontSize: 12,
  backgroundColor: "#ffffff"
};

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultConnection(index = 0) {
  return {
    id: index === 0 ? "jira-1" : makeId("jira"),
    name: index === 0 ? "Jira" : `Jira ${index + 1}`,
    baseUrl: "",
    apiVersion: "2",
    authType: "basic",
    email: "",
    extraJql: "",
    enabled: true
  };
}

function defaultData() {
  return {
    version: DATA_VERSION,
    settings: {
      worklogStartTime: "09:00",
      dailyNormHours: 8,
      showWeekends: false,
      displayFormat: "decimal",
      ...DEFAULT_APPEARANCE,
      // The "All" chip. Empty JQL: issues with your worklogs this month (+ each source's extra JQL).
      allFilter: { jql: "", free: false },
      filters: [],
      jiraConnections: [defaultConnection(0)]
    }
  };
}

function normalizeStartTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "09:00";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "09:00";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeKeys(keys) {
  const list = Array.isArray(keys) ? keys : String(keys || "").split(/[\s,;]+/);
  return [...new Set(list.map((key) => String(key).trim().toUpperCase()).filter(Boolean))];
}

function normalizeFilter(filter) {
  let jql = String(filter?.jql || "").trim();
  if (!jql) {
    // Filters from earlier versions were lists of project keys.
    const keys = normalizeKeys(filter?.projectKeys);
    if (keys.length) jql = `project in (${keys.join(", ")})`;
  }
  return {
    id: String(filter?.id || makeId("filter")),
    label: String(filter?.label || "").trim() || "Filter",
    jql,
    // Free: the JQL alone decides which issues are shown. Otherwise it narrows the base list.
    free: filter?.free === true
  };
}

function normalizeAllFilter(filter) {
  return { jql: String(filter?.jql || "").trim(), free: filter?.free === true };
}

function normalizeConnection(connection, index) {
  const base = defaultConnection(index);
  const merged = { ...base, ...(connection || {}) };
  return {
    ...merged,
    id: String(merged.id || base.id),
    name: String(merged.name || "").trim() || base.name,
    baseUrl: String(merged.baseUrl || "").trim().replace(/\/+$/, ""),
    apiVersion: String(merged.apiVersion) === "3" ? "3" : "2",
    authType: merged.authType === "bearer" ? "bearer" : "basic",
    email: String(merged.email || "").trim(),
    extraJql: String(merged.extraJql || "").trim(),
    enabled: merged.enabled !== false
  };
}

function clampFontSize(value) {
  const size = Math.round(Number(value));
  return Number.isFinite(size) && size >= 10 && size <= 24 ? size : 12;
}

function mergeDefaults(data) {
  const defaults = defaultData();
  const settings = { ...defaults.settings, ...(data?.settings || {}) };
  // Older versions had a different default look; switch their settings files to the current one once.
  if (data && Number(data.version) < DATA_VERSION) Object.assign(settings, DEFAULT_APPEARANCE);
  const norm = Number(settings.dailyNormHours);
  return {
    version: DATA_VERSION,
    settings: {
      worklogStartTime: normalizeStartTime(settings.worklogStartTime),
      dailyNormHours: Number.isFinite(norm) && norm > 0 && norm <= 24 ? norm : 8,
      showWeekends: Boolean(settings.showWeekends),
      displayFormat: settings.displayFormat === "jira" ? "jira" : "decimal",
      theme: ["classic", "light", "dark", "system"].includes(settings.theme) ? settings.theme : "classic",
      tableFont: /^[a-z0-9-]{1,32}$/.test(String(settings.tableFont)) ? String(settings.tableFont) : "system",
      tableFontSize: clampFontSize(settings.tableFontSize),
      backgroundColor: /^#[0-9a-f]{6}$/i.test(String(settings.backgroundColor)) ? String(settings.backgroundColor).toLowerCase() : "",
      allFilter: normalizeAllFilter(settings.allFilter),
      filters: Array.isArray(settings.filters) ? settings.filters.map(normalizeFilter) : [],
      jiraConnections:
        Array.isArray(settings.jiraConnections) && settings.jiraConnections.length
          ? settings.jiraConnections.map(normalizeConnection)
          : defaults.settings.jiraConnections
    }
  };
}

function encryptToken(token, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error("Encrypted credential storage is not available on this machine; the token was not saved.");
  }
  return safeStorage.encryptString(token).toString("base64");
}

function decryptToken(connection, safeStorage) {
  if (!connection?.tokenCipher) return "";
  try {
    return safeStorage?.decryptString(Buffer.from(connection.tokenCipher, "base64")) || "";
  } catch (_error) {
    return "";
  }
}

// What the renderer sees: never the secret, only whether one is stored.
function sanitizeData(data) {
  return {
    ...data,
    settings: {
      ...data.settings,
      jiraConnections: data.settings.jiraConnections.map(({ tokenCipher, token, ...rest }) => ({
        ...rest,
        tokenPresent: Boolean(tokenCipher)
      }))
    }
  };
}

// Merge settings coming from the renderer with what is stored on disk.
// A connection keeps its stored secret unless a new `token` is supplied;
// `clearToken: true` removes it.
function normalizeIncomingData(incoming, existing, safeStorage) {
  const merged = mergeDefaults(incoming);
  const existingById = new Map((existing?.settings?.jiraConnections || []).map((item) => [item.id, item]));
  const incomingById = new Map((incoming?.settings?.jiraConnections || []).map((item) => [String(item.id), item]));

  merged.settings.jiraConnections = merged.settings.jiraConnections.map((connection) => {
    const raw = incomingById.get(connection.id) || {};
    const { token, tokenPresent, clearToken, tokenCipher, ...clean } = connection;
    const previous = existingById.get(connection.id);
    if (raw.clearToken) {
      return clean;
    }
    if (typeof raw.token === "string" && raw.token.trim()) {
      return { ...clean, tokenCipher: encryptToken(raw.token.trim(), safeStorage) };
    }
    return previous?.tokenCipher ? { ...clean, tokenCipher: previous.tokenCipher } : clean;
  });

  return merged;
}

module.exports = {
  decryptToken,
  defaultConnection,
  defaultData,
  encryptToken,
  mergeDefaults,
  normalizeIncomingData,
  normalizeKeys,
  normalizeStartTime,
  sanitizeData
};
