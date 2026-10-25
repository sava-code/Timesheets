const { decryptToken } = require("./storage.cjs");
const core = require("./jira-core.cjs");

const ISSUE_FIELDS = ["summary", "project", "status", "issuetype"];
const REQUEST_TIMEOUT_MS = 30000;

async function jiraRequest(connection, path, options = {}) {
  const baseUrl = core.normalizeBaseUrl(connection.baseUrl);
  if (!baseUrl) {
    throw new Error(`Base URL is not configured for "${connection.name}".`);
  }

  // `token` is only set on an unsaved draft passed to "Test"; stored sources use the encrypted secret.
  const token = connection.token || decryptToken(connection);
  if (!token && connection.tokenCipher) {
    throw new Error(
      `The saved password for "${connection.name}" can't be read on this computer (for example after the app was renamed). Enter it again in Settings.`
    );
  }
  const headers = {
    Accept: "application/json",
    Authorization: core.buildAuthHeader(connection, token),
    // Jira Server rejects some write calls without this header (XSRF check).
    "X-Atlassian-Token": "no-check",
    ...(options.headers || {})
  };

  let body = options.body;
  if (body && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, { ...options, headers, body, signal: controller.signal });
    } catch (error) {
      const reason = error.name === "AbortError" ? "request timed out" : error.cause?.code || error.message;
      throw new Error(`Cannot reach ${baseUrl}: ${reason}`);
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      const error = new Error(core.errorMessage(response.status, response.statusText, payload));
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function getMyself(connection) {
  return jiraRequest(connection, `/rest/api/${core.apiVersion(connection)}/myself`, { method: "GET" });
}

async function searchAllIssues(connection, jql, fields = ISSUE_FIELDS, limit = 5000) {
  const version = core.apiVersion(connection);
  const issues = [];

  if (version === "3") {
    try {
      let nextPageToken;
      do {
        const payload = await jiraRequest(connection, "/rest/api/3/search/jql", {
          method: "POST",
          body: { jql, fields, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }
        });
        issues.push(...(payload?.issues || []));
        nextPageToken = payload?.isLast ? undefined : payload?.nextPageToken;
      } while (nextPageToken && issues.length < limit);
      return issues;
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
    }
  }

  let startAt = 0;
  for (;;) {
    const payload = await jiraRequest(connection, `/rest/api/${version}/search`, {
      method: "POST",
      body: { jql, fields, startAt, maxResults: 100 }
    });
    const page = payload?.issues || [];
    issues.push(...page);
    startAt += page.length;
    if (!page.length || startAt >= (payload?.total ?? 0) || issues.length >= limit) break;
  }
  return issues;
}

async function issueWorklogs(connection, issueKey, range) {
  const version = core.apiVersion(connection);
  const all = [];
  let startAt = 0;
  // Cloud can filter by start time server-side; Server/DC ignores unknown params.
  const after = new Date(`${range.from}T00:00:00`).getTime() - 2 * 86400000;
  const before = new Date(`${range.to}T23:59:59`).getTime() + 2 * 86400000;
  for (;;) {
    const params = new URLSearchParams({ startAt: String(startAt), maxResults: "1000" });
    if (version === "3") {
      params.set("startedAfter", String(after));
      params.set("startedBefore", String(before));
    }
    const payload = await jiraRequest(
      connection,
      `/rest/api/${version}/issue/${encodeURIComponent(issueKey)}/worklog?${params}`,
      { method: "GET" }
    );
    const page = payload?.worklogs || [];
    all.push(...page);
    startAt += page.length;
    if (!page.length || payload?.total === undefined || startAt >= payload.total) break;
  }
  return all;
}

// Everything the timesheet needs from one Jira source for one month.
async function fetchSourceMonth(connection, month, baseJql) {
  const range = core.monthRange(month);
  const myself = await getMyself(connection);

  const logged = await searchAllIssues(connection, core.monthWorklogJql(month, baseJql));
  let extra = [];
  let extraError = "";
  if (connection.extraJql) {
    try {
      extra = await searchAllIssues(connection, connection.extraJql);
    } catch (error) {
      extraError = `Extra issues JQL failed: ${error.message}`;
    }
  }

  const issues = new Map();
  for (const raw of [...logged, ...extra]) {
    if (!issues.has(raw.key)) issues.set(raw.key, core.toIssue(connection, raw));
  }

  const worklogs = [];
  await core.mapLimit(logged, 6, async (raw) => {
    const list = await issueWorklogs(connection, raw.key, range);
    for (const item of list) {
      const worklog = core.toWorklog(raw.key, item);
      if (core.isOwnWorklog(item, myself) && worklog.date >= range.from && worklog.date <= range.to) {
        worklogs.push(worklog);
      }
    }
  });

  return {
    issues: await withTypeIcons(connection, [...issues.values()]),
    worklogs,
    user: myself?.displayName || myself?.name || "",
    warning: extraError
  };
}

// Issue type icons need the Jira login, so they are downloaded here once per URL and handed to
// the window as data: URLs (also allowed by the window's content security policy).
const ICON_MAX_BYTES = 200 * 1024;
const iconCache = new Map();

async function fetchIconDataUrl(connection, url) {
  if (iconCache.has(url)) return iconCache.get(url);
  const pending = (async () => {
    if (!core.isTrustedIconUrl(connection, url)) return "";
    const token = connection.token || decryptToken(connection);
    const headers = { Accept: "image/svg+xml,image/png,image/*" };
    const sameHost = new URL(url).host === new URL(core.normalizeBaseUrl(connection.baseUrl)).host;
    if (token && sameHost) headers.Authorization = core.buildAuthHeader(connection, token);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const type = (response.headers.get("content-type") || "").split(";")[0].trim();
      if (!response.ok || !/^image\/(svg\+xml|png|gif|jpeg|webp)$/.test(type)) return "";
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > ICON_MAX_BYTES) return "";
      return `data:${type};base64,${bytes.toString("base64")}`;
    } catch (_error) {
      return "";
    } finally {
      clearTimeout(timeout);
    }
  })();
  iconCache.set(url, pending);
  const result = await pending;
  if (!result) iconCache.delete(url); // try again on the next load
  return result;
}

/** Replaces each issue's typeIcon URL with a data: URL ("" when it can't be loaded). */
async function withTypeIcons(connection, issues) {
  const urls = [...new Set(issues.map((issue) => issue.typeIcon).filter(Boolean))];
  const icons = new Map();
  await core.mapLimit(urls, 4, async (url) => icons.set(url, await fetchIconDataUrl(connection, url)));
  return issues.map((issue) => ({ ...issue, typeIcon: icons.get(issue.typeIcon) || "" }));
}

async function createWorklog(connection, { issueKey, date, seconds, startTime, comment }) {
  const raw = await jiraRequest(
    connection,
    `/rest/api/${core.apiVersion(connection)}/issue/${encodeURIComponent(issueKey)}/worklog?adjustEstimate=leave&notifyUsers=false`,
    { method: "POST", body: core.newWorklogBody(connection, { date, startTime, seconds, comment }) }
  );
  return core.toWorklog(issueKey, raw);
}

async function updateWorklog(connection, { issueKey, worklogId, seconds, started }) {
  const value = core.validateSeconds(seconds);
  const body = { timeSpentSeconds: value };
  // Send the original start back so Jira Cloud never moves the worklog.
  if (started) body.started = started;
  const raw = await jiraRequest(
    connection,
    `/rest/api/${core.apiVersion(connection)}/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}?adjustEstimate=leave&notifyUsers=false`,
    { method: "PUT", body }
  );
  return core.toWorklog(issueKey, raw);
}

async function deleteWorklog(connection, { issueKey, worklogId }) {
  try {
    await jiraRequest(
      connection,
      `/rest/api/${core.apiVersion(connection)}/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}?adjustEstimate=leave&notifyUsers=false`,
      { method: "DELETE" }
    );
  } catch (error) {
    if (error.status === 403 || /permission to delete/i.test(error.message)) {
      throw new Error(
        "Jira does not let your account delete worklogs in this project (missing \"Delete Own Worklogs\" permission). " +
          "Lower the time to at least 1m instead, or ask your Jira admin."
      );
    }
    throw error;
  }
  return { ok: true };
}

const FREE_SEARCH_LIMIT = 1000;

/** Issues for a free JQL (search box or free filter). Capped so a broad query stays usable. */
async function searchIssues(connection, jql) {
  const raw = await searchAllIssues(connection, jql, ISSUE_FIELDS, FREE_SEARCH_LIMIT);
  return {
    issues: await withTypeIcons(connection, raw.slice(0, FREE_SEARCH_LIMIT).map((issue) => core.toIssue(connection, issue))),
    truncated: raw.length >= FREE_SEARCH_LIMIT
  };
}

/** Your registered absences (e.g. project = calendar AND Employee = currentUser()). */
async function fetchAbsences(connection, { jql, fromField, toField }) {
  const raw = await searchAllIssues(connection, jql, ["summary", "status", fromField, toField], 1000);
  return raw.map((issue) => core.toAbsence(connection, issue, fromField, toField)).filter(Boolean);
}

/** Which of `keys` match a filter JQL. Keys are sent in batches to keep each query short. */
async function matchFilter(connection, jql, keys) {
  const matched = [];
  for (const batch of core.chunk([...new Set(keys)], 100)) {
    const issues = await searchAllIssues(connection, core.restrictJqlToKeys(jql, batch), ["summary"]);
    matched.push(...issues.map((issue) => issue.key));
  }
  return matched;
}

async function testConnection(connection) {
  const myself = await getMyself(connection);
  return {
    ok: true,
    displayName: myself?.displayName || myself?.name || "Connected",
    emailAddress: myself?.emailAddress || ""
  };
}

module.exports = {
  createWorklog,
  deleteWorklog,
  fetchSourceMonth,
  fetchAbsences,
  matchFilter,
  searchIssues,
  testConnection,
  updateWorklog
};
