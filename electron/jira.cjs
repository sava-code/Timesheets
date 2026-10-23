const { decryptToken } = require("./storage.cjs");
const core = require("./jira-core.cjs");

const ISSUE_FIELDS = ["summary", "project", "status"];
const REQUEST_TIMEOUT_MS = 30000;

async function jiraRequest(connection, path, options = {}) {
  const baseUrl = core.normalizeBaseUrl(connection.baseUrl);
  if (!baseUrl) {
    throw new Error(`Base URL is not configured for "${connection.name}".`);
  }

  const headers = {
    Accept: "application/json",
    // `token` is only set on an unsaved draft passed to "Test"; stored sources use the encrypted secret.
    Authorization: core.buildAuthHeader(connection, connection.token || decryptToken(connection)),
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

async function searchAllIssues(connection, jql) {
  const version = core.apiVersion(connection);
  const issues = [];

  if (version === "3") {
    try {
      let nextPageToken;
      do {
        const payload = await jiraRequest(connection, "/rest/api/3/search/jql", {
          method: "POST",
          body: { jql, fields: ISSUE_FIELDS, maxResults: 100, ...(nextPageToken ? { nextPageToken } : {}) }
        });
        issues.push(...(payload?.issues || []));
        nextPageToken = payload?.isLast ? undefined : payload?.nextPageToken;
      } while (nextPageToken && issues.length < 5000);
      return issues;
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
    }
  }

  let startAt = 0;
  for (;;) {
    const payload = await jiraRequest(connection, `/rest/api/${version}/search`, {
      method: "POST",
      body: { jql, fields: ISSUE_FIELDS, startAt, maxResults: 100 }
    });
    const page = payload?.issues || [];
    issues.push(...page);
    startAt += page.length;
    if (!page.length || startAt >= (payload?.total ?? 0) || issues.length >= 5000) break;
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
async function fetchSourceMonth(connection, month) {
  const range = core.monthRange(month);
  const myself = await getMyself(connection);

  const logged = await searchAllIssues(connection, core.monthWorklogJql(month));
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
    issues: [...issues.values()],
    worklogs,
    user: myself?.displayName || myself?.name || "",
    warning: extraError
  };
}

async function lookupIssue(connection, issueKey) {
  const key = String(issueKey || "").trim().toUpperCase();
  if (!key) throw new Error("Issue key is required.");
  const raw = await jiraRequest(
    connection,
    `/rest/api/${core.apiVersion(connection)}/issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS.join(",")}`,
    { method: "GET" }
  );
  return core.toIssue(connection, raw);
}

async function createWorklog(connection, { issueKey, date, seconds, startTime }) {
  const value = core.validateSeconds(seconds);
  const raw = await jiraRequest(
    connection,
    `/rest/api/${core.apiVersion(connection)}/issue/${encodeURIComponent(issueKey)}/worklog?adjustEstimate=leave&notifyUsers=false`,
    { method: "POST", body: { started: core.jiraStarted(date, startTime), timeSpentSeconds: value } }
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
  await jiraRequest(
    connection,
    `/rest/api/${core.apiVersion(connection)}/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(worklogId)}?adjustEstimate=leave&notifyUsers=false`,
    { method: "DELETE" }
  );
  return { ok: true };
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
  lookupIssue,
  testConnection,
  updateWorklog
};
