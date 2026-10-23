// Pure Jira helpers (no network, no Electron) so they can be unit-tested.

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function apiVersion(connection) {
  return String(connection?.apiVersion || "2").replace(/^v/, "") === "3" ? "3" : "2";
}

function buildAuthHeader(connection, token) {
  if (!token) {
    throw new Error(
      connection.authType === "bearer"
        ? "Jira token/PAT is not configured."
        : "Jira password/API token is not configured."
    );
  }
  if (connection.authType === "bearer") {
    return `Bearer ${token}`;
  }
  if (!connection.email) {
    throw new Error("User name/email is required for basic auth.");
  }
  return `Basic ${Buffer.from(`${connection.email}:${token}`).toString("base64")}`;
}

function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!match) {
    throw new Error(`Invalid month: ${month}`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function monthWorklogJql(month) {
  const { from, to } = monthRange(month);
  return `worklogAuthor = currentUser() AND worklogDate >= "${from}" AND worklogDate <= "${to}" ORDER BY key ASC`;
}

// "ORDER BY" can't be wrapped in parentheses, and order doesn't matter for matching.
function stripOrderBy(jql) {
  return String(jql || "").replace(/\s+order\s+by\s+[\s\S]*$/i, "").trim();
}

/** Restricts a user's JQL to the given issue keys, e.g. (assignee = currentUser()) AND key in ("A-1","B-2"). */
function restrictJqlToKeys(jql, keys) {
  const base = stripOrderBy(jql);
  if (!base) throw new Error("Filter JQL is empty.");
  const list = keys.map((key) => `"${String(key).replace(/"/g, "")}"`).join(",");
  return `(${base}) AND key in (${list})`;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/** A date or datetime custom field value as YYYY-MM-DD ("" if empty). */
function fieldDate(value) {
  const text = typeof value === "string" ? value : value?.value || "";
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

/** An absence issue -> { key, summary, from, to }; null when it has no start date. */
function toAbsence(connection, raw, fromField, toField) {
  const fields = raw.fields || {};
  const from = fieldDate(fields[fromField]);
  if (!from) return null;
  const to = fieldDate(fields[toField]) || from;
  return {
    key: raw.key,
    summary: fields.summary || raw.key,
    status: fields.status?.name || "",
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    url: `${normalizeBaseUrl(connection.baseUrl)}/browse/${raw.key}`
  };
}

// The date part of Jira's "started" timestamp, as recorded by Jira for the author.
function worklogDateKey(started) {
  return String(started || "").slice(0, 10);
}

function isOwnWorklog(worklog, myself) {
  const author = worklog?.author || {};
  if (myself?.accountId && author.accountId) {
    return author.accountId === myself.accountId;
  }
  if (myself?.key && author.key) {
    return author.key === myself.key;
  }
  return Boolean(myself?.name) && author.name === myself.name;
}

function commentText(comment) {
  if (!comment) return "";
  if (typeof comment === "string") return comment;
  // Atlassian Document Format (Cloud v3): collect text nodes.
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === "text" && node.text) parts.push(node.text);
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      if (node.type === "paragraph") parts.push("\n");
    }
  };
  walk(comment);
  return parts.join("").trim();
}

function toWorklog(issueKey, raw) {
  return {
    id: String(raw.id),
    issueKey,
    date: worklogDateKey(raw.started),
    started: raw.started,
    seconds: Number(raw.timeSpentSeconds) || 0,
    comment: commentText(raw.comment)
  };
}

function toIssue(connection, raw) {
  const fields = raw.fields || {};
  return {
    sourceId: connection.id,
    sourceName: connection.name || connection.id,
    key: raw.key,
    summary: fields.summary || raw.key,
    projectKey: fields.project?.key || String(raw.key).split("-")[0],
    status: fields.status?.name || "",
    url: `${normalizeBaseUrl(connection.baseUrl)}/browse/${raw.key}`
  };
}

// Jira expects e.g. 2026-10-05T09:00:00.000+0200, in the user's local offset.
function jiraStarted(dateKey, startTime = "09:00") {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const [hours, minutes] = String(startTime).split(":").map(Number);
  const date = new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00.000` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

function validateSeconds(seconds) {
  const value = Math.round(Number(seconds));
  if (!Number.isFinite(value) || value < 60) {
    throw new Error("A worklog must be at least 1 minute.");
  }
  if (value > 24 * 3600) {
    throw new Error("A worklog cannot be longer than 24 hours.");
  }
  return value;
}

function errorMessage(status, statusText, payload) {
  const fieldErrors = payload?.errors && typeof payload.errors === "object" ? Object.values(payload.errors) : [];
  return (
    [...(payload?.errorMessages || []), ...fieldErrors].filter(Boolean).join("; ") ||
    payload?.message ||
    (typeof payload?.raw === "string" && payload.raw.length < 300 ? payload.raw : "") ||
    `${status} ${statusText}`.trim()
  );
}

// Runs async work for each item with at most `limit` in flight.
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

module.exports = {
  apiVersion,
  fieldDate,
  toAbsence,
  chunk,
  restrictJqlToKeys,
  stripOrderBy,
  buildAuthHeader,
  commentText,
  errorMessage,
  isOwnWorklog,
  jiraStarted,
  mapLimit,
  monthRange,
  monthWorklogJql,
  normalizeBaseUrl,
  toIssue,
  toWorklog,
  validateSeconds,
  worklogDateKey
};
