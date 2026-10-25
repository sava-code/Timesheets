// Pure settings logic (no Electron imports) so it can be unit-tested.

const { DEFAULT_BASE_JQL } = require("./jira-core.cjs");

const DATA_VERSION = 6;

// Absences (vacation, sick leave...) registered as Jira issues; their days are left out of the norm.
const DEFAULT_ABSENCES = {
  enabled: true,
  sourceId: "", // "" = the first enabled Jira source
  jql: 'project = calendar AND Employee = currentUser() and type = "Absence Request"',
  fromField: "customfield_10800", // "Leave from date"
  toField: "customfield_10801" // "Leave to date"
};

// The default absences JQL before version 6; settings still holding it get the new default once.
const PREVIOUS_ABSENCES_JQL = "project = calendar AND Employee = currentUser()";

// Filters every installation starts with. Free: they list issues even without time logged this month.
const DEFAULT_FILTERS = [
  {
    id: "viewed-recently",
    label: "Viewed recently",
    jql: "issuekey in issueHistory() order by lastViewed DESC",
    free: true
  },
  {
    id: "my-open-tickets",
    label: "My open tickets",
    jql: "assignee = currentUser() AND resolution = Unresolved order by updated DESC",
    free: true
  }
];

// Default look. Settings files from older versions are switched to it once (see mergeDefaults).
const DEFAULT_APPEARANCE = {
  theme: "classic",
  tableFont: "system",
  tableFontSize: 12,
  // "" = the theme's own background (white in Classic). A custom colour applies to every theme.
  backgroundColor: ""
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
      baseJql: DEFAULT_BASE_JQL,
      allFilter: { jql: "", free: false },
      askComment: false,
      absences: { ...DEFAULT_ABSENCES },
      filters: DEFAULT_FILTERS.map((filter) => ({ ...filter })),
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

function normalizeAbsences(value) {
  const merged = { ...DEFAULT_ABSENCES, ...(value || {}) };
  const field = (id, fallback) => (/^(customfield_\d+|[a-z][a-zA-Z0-9]*)$/.test(String(id || "").trim()) ? String(id).trim() : fallback);
  return {
    enabled: merged.enabled !== false,
    sourceId: String(merged.sourceId || ""),
    jql: String(merged.jql || "").trim() || DEFAULT_ABSENCES.jql,
    fromField: field(merged.fromField, DEFAULT_ABSENCES.fromField),
    toField: field(merged.toField, DEFAULT_ABSENCES.toField)
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

// Settings from before version 4 get the default filters once, unless a filter with the same JQL exists.
function withDefaultFilters(filters, version) {
  if (version >= 4) return filters;
  const sameJql = (a, b) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
  const missing = DEFAULT_FILTERS.filter(
    (preset) => !filters.some((filter) => filter.id === preset.id || sameJql(filter.jql, preset.jql))
  );
  return [...filters, ...missing.map((filter) => ({ ...filter }))];
}

function clampFontSize(value) {
  const size = Math.round(Number(value));
  return Number.isFinite(size) && size >= 10 && size <= 24 ? size : 12;
}

function mergeDefaults(data) {
  const defaults = defaultData();
  const settings = { ...defaults.settings, ...(data?.settings || {}) };
  // Older versions had a different default look; switch their settings files to the current one once.
  const version = Number(data?.version) || 0;
  if (data && version < 3) Object.assign(settings, DEFAULT_APPEARANCE);
  // Up to version 4 the default white was stored as a custom colour, which also forced it on the dark theme.
  if (data && version < 5 && String(settings.backgroundColor).toLowerCase() === "#ffffff") settings.backgroundColor = "";
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
      baseJql: String(settings.baseJql || "").trim() || DEFAULT_BASE_JQL,
      allFilter: normalizeAllFilter(settings.allFilter),
      askComment: settings.askComment === true,
      absences: normalizeAbsences(
        data && version < 6 && String(settings.absences?.jql || "").trim() === PREVIOUS_ABSENCES_JQL
          ? { ...settings.absences, jql: DEFAULT_ABSENCES.jql }
          : settings.absences
      ),
      filters: withDefaultFilters(
        Array.isArray(settings.filters) ? settings.filters.map(normalizeFilter) : [],
        data ? version : DATA_VERSION
      ),
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
