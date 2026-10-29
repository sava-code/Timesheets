// Pure settings logic (no Electron imports) so it can be unit-tested.

const { DEFAULT_BASE_JQL } = require("./jira-core.cjs");

const DATA_VERSION = 10;

// Worklogs allocation chart: categories checked in order, the first match wins, the rest is "Other".
// A category matches an issue by type, by project (name or key) or by text in the summary.
// Each list is comma-separated and case-insensitive.
const DEFAULT_ALLOCATION_RULES = [
  { id: "support", name: "Support", types: "Support Request", projects: "Support Infrastructure, Customer Upgrade", summary: "" },
  {
    id: "implementation",
    name: "Implementation",
    types: "",
    projects:
      "Project Handover, BKNN, Custom Development, Customer Projects, MRJ, Nativa Core Team, RPC Core Team, NETS Core Team, Sberbank",
    summary: ""
  },
  { id: "sme", name: "SME", types: "", projects: "Business Analysis, Worklogs from OWS JIRA, OpenWay Vendor Support", summary: "SME" },
  { id: "academy", name: "Academy", types: "", projects: "OW ACADEMY", summary: "" },
  { id: "apollo", name: "Apollo", types: "", projects: "Apollo", summary: "" }
];

// Absences (vacation, sick leave...) registered as Jira issues; their days are left out of the norm.
// They are used whenever the JQL and both date fields are filled in.
const DEFAULT_ABSENCES = {
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
    free: true,
    sourceId: ""
  },
  {
    id: "my-open-tickets",
    label: "My open tickets",
    jql: "assignee = currentUser() AND resolution = Unresolved order by updated DESC",
    free: true,
    sourceId: ""
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

/** The Jira field holding the client: customfield_11000 on ows-jira.spb, customfield_10703 elsewhere. */
function defaultClientField(baseUrl) {
  return String(baseUrl || "").toLowerCase().includes("ows-jira.spb.") ? "customfield_11000" : "customfield_10703";
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
    clientField: defaultClientField(""),
    enabled: true
  };
}

// Jira sources pre-set on first launch for users of the openwaygroup.com domain.
const COMPANY_DOMAIN = "openwaygroup.com";
const COMPANY_CONNECTIONS = [
  { id: "jira-delivery", name: "Delivery", baseUrl: "https://jira.spb.openwaygroup.com", clientField: "customfield_10703" },
  { id: "jira-rnd", name: "RnD", baseUrl: "https://ows-jira.spb.openwaygroup.com", clientField: "customfield_11000" }
];

/** True when the domain name is openwaygroup.com or a subdomain of it (case-insensitive). */
function isCompanyDomain(name) {
  const domain = String(name || "").trim().toLowerCase().replace(/\.+$/, "");
  return domain === COMPANY_DOMAIN || domain.endsWith(`.${COMPANY_DOMAIN}`);
}

/** Search domains from `scutil --dns` output ("search domain[0] : spb.openwaygroup.com"). */
function parseSearchDomains(output) {
  return [...String(output || "").matchAll(/search domain\[\d+\]\s*:\s*(\S+)/gi)].map((match) => match[1]);
}

/**
 * A company computer. Windows: the user is logged on to the openwaygroup.com domain.
 * macOS: an openwaygroup.com DNS search domain; as a backup, a device name starting with "OW".
 */
function isCompanyComputer({ platform, dnsDomain = "", dnsSearchDomains = "", computerNames = [] } = {}) {
  if (platform === "win32") return isCompanyDomain(dnsDomain);
  if (platform !== "darwin") return false;
  if (parseSearchDomains(dnsSearchDomains).some(isCompanyDomain)) return true;
  return computerNames.some((name) => String(name || "").trim().startsWith("OW"));
}

/** Settings for a first launch; company users get the Delivery and RnD Jira sources and the allocation categories. */
function initialData({ companyDomain = false } = {}) {
  const data = defaultData();
  if (companyDomain) {
    data.settings.jiraConnections = COMPANY_CONNECTIONS.map((preset) => ({ ...defaultConnection(0), ...preset }));
    // Absence requests live in the Delivery Jira.
    data.settings.absences.sourceId = COMPANY_CONNECTIONS[0].id;
  } else {
    // The default allocation categories are OpenWay's projects; others start without categories.
    data.settings.allocationRules = [];
  }
  return data;
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
      askComment: true,
      showTypeIcons: false,
      allocationRules: DEFAULT_ALLOCATION_RULES.map((rule) => ({ ...rule })),
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
    free: filter?.free === true,
    // The Jira source the filter runs on; "" = every source.
    sourceId: String(filter?.sourceId || "").trim()
  };
}

/** Absences are fetched when the JQL and both date fields are set. */
function absencesConfigured(absences) {
  return Boolean(absences && absences.jql && absences.fromField && absences.toField);
}

function normalizeAbsences(value) {
  const merged = { ...DEFAULT_ABSENCES, ...(value || {}) };
  // Empty means "not set"; anything that isn't a field id falls back to the default.
  const field = (id, fallback) => {
    const text = String(id ?? "").trim();
    if (!text) return "";
    return /^(customfield_\d+|[a-z][a-zA-Z0-9]*)$/.test(text) ? text : fallback;
  };
  return {
    sourceId: String(merged.sourceId || ""),
    jql: String(merged.jql ?? "").trim(),
    fromField: field(merged.fromField, DEFAULT_ABSENCES.fromField),
    toField: field(merged.toField, DEFAULT_ABSENCES.toField)
  };
}

function normalizeAllocationRules(rules) {
  if (!Array.isArray(rules)) return DEFAULT_ALLOCATION_RULES.map((rule) => ({ ...rule }));
  const list = (value) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");
  // Categories without a name are dropped.
  return rules
    .filter((rule) => rule && typeof rule === "object" && String(rule.name || "").trim())
    .map((rule) => ({
      id: String(rule.id || makeId("category")),
      name: String(rule.name).trim(),
      types: list(rule.types),
      projects: list(rule.projects),
      summary: list(rule.summary)
    }));
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
    // Saved before the client field existed: the default for its URL.
    clientField:
      connection && typeof connection.clientField === "string"
        ? connection.clientField.trim()
        : defaultClientField(merged.baseUrl),
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
  // Version 7: comment window on and Segoe UI as the table font by default; applied once.
  if (data && version < 7) {
    settings.askComment = true;
  }
  // Version 8: back to the system font by default (1.1–1.2 had switched it to Segoe UI); applied once.
  if (data && version < 8 && settings.tableFont === "segoe") settings.tableFont = "system";
  // Up to version 4 the default white was stored as a custom colour, which also forced it on the dark theme.
  if (data && version < 5 && String(settings.backgroundColor).toLowerCase() === "#ffffff") settings.backgroundColor = "";
  // Version 9: the "Use absences" switch is gone; absences switched off keep being off via an empty JQL.
  if (data && version < 9 && settings.absences && settings.absences.enabled === false) {
    settings.absences = { ...settings.absences, jql: "" };
  }
  // Version 10: issue type icons are off by default; switched off once for existing settings.
  if (data && version < 10) settings.showTypeIcons = false;
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
      askComment: settings.askComment !== false,
      showTypeIcons: settings.showTypeIcons === true,
      allocationRules: normalizeAllocationRules(settings.allocationRules),
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
  absencesConfigured,
  defaultClientField,
  decryptToken,
  defaultConnection,
  defaultData,
  encryptToken,
  initialData,
  isCompanyComputer,
  isCompanyDomain,
  parseSearchDomains,
  mergeDefaults,
  normalizeIncomingData,
  normalizeKeys,
  normalizeStartTime,
  sanitizeData
};
