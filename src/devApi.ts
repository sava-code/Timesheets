// In-browser stand-in for the Electron bridge, used by `npm run dev:web` and tests.
import type { AppData, Issue, MonthResult, TimesheetsApi, Worklog } from "./types";
import { monthDays } from "./time";

const ISSUES: Array<[string, string, string]> = [
  ["main", "SUP-1042", "Customer cannot export monthly statement"],
  ["main", "SUP-1077", "Card authorisation timeouts on night batch"],
  ["main", "IMPL-310", "Onboard new issuer: interface specification"],
  ["main", "IMPL-322", "Settlement file mapping for acquirer"],
  ["main", "INT-15", "Team meetings"],
  ["main", "ARCH-88", "Review event streaming architecture"],
  ["client", "OPS-501", "Release support"],
  ["client", "BA-27", "Requirements workshop with client"]
];

function issue(sourceId: string, key: string, summary: string): Issue {
  return {
    sourceId,
    sourceName: sourceId === "main" ? "Delivery Jira" : "Client Jira",
    key,
    summary,
    projectKey: key.split("-")[0],
    status: "In Progress",
    url: `https://jira.example.com/browse/${key}`
  };
}

function seededData(month: string): Map<string, Worklog[]> {
  const bySource = new Map<string, Worklog[]>([["main", []], ["client", []]]);
  let id = 10000;
  let seed = month.split("-").reduce((sum, part) => sum + Number(part), 7);
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const today = new Date().toISOString().slice(0, 10);
  for (const day of monthDays(month)) {
    if (day.isWeekend || day.key > today) continue;
    let left = 8 * 3600;
    const picks = [...ISSUES].sort(() => random() - 0.5).slice(0, 2 + Math.floor(random() * 2));
    picks.forEach(([sourceId, key], index) => {
      const seconds = index === picks.length - 1 ? left : Math.min(left, (1 + Math.floor(random() * 6)) * 1800);
      left -= seconds;
      if (seconds > 0 && random() > 0.08) {
        bySource.get(sourceId)!.push({
          id: String(id++),
          issueKey: key,
          date: day.key,
          started: `${day.key}T09:00:00.000+0200`,
          seconds,
          comment: ""
        });
      }
    });
  }
  return bySource;
}

export function createDevApi(options: { canDeleteWorklogs?: boolean } = {}): TimesheetsApi {
  const canDelete = options.canDeleteWorklogs !== false;
  let data: AppData = {
    version: 1,
    settings: {
      worklogStartTime: "09:00",
      dailyNormHours: 8,
      showWeekends: false,
      displayFormat: "decimal",
      theme: "system",
      filters: [
        { id: "f1", label: "Support", jql: "project = SUP" },
        { id: "f2", label: "Implementation", jql: "project = IMPL" },
        { id: "f3", label: "SME", jql: "project in (ARCH, BA)" }
      ],
      jiraConnections: [
        { id: "main", name: "Delivery Jira", baseUrl: "https://jira.example.com", apiVersion: "2", authType: "bearer", email: "", extraJql: "filter = worklogs", enabled: true, tokenPresent: true },
        { id: "client", name: "Client Jira", baseUrl: "https://client.atlassian.net", apiVersion: "3", authType: "basic", email: "me@example.com", extraJql: "", enabled: true, tokenPresent: true }
      ]
    },
    pinnedIssues: []
  };
  const months = new Map<string, Map<string, Worklog[]>>();
  let nextId = 50000;
  const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));
  const store = (month: string) => {
    if (!months.has(month)) months.set(month, seededData(month));
    return months.get(month)!;
  };
  const find = (sourceId: string, worklogId: string) => {
    for (const bySource of months.values()) {
      const list = bySource.get(sourceId) || [];
      const index = list.findIndex((item) => item.id === worklogId);
      if (index >= 0) return { list, index };
    }
    throw new Error("Worklog not found");
  };

  return {
    loadData: async () => structuredClone(data),
    saveData: async (incoming) => {
      data = structuredClone({
        ...incoming,
        settings: {
          ...incoming.settings,
          jiraConnections: incoming.settings.jiraConnections.map(({ token, clearToken, ...rest }) => ({
            ...rest,
            tokenPresent: clearToken ? false : Boolean(token) || Boolean(rest.tokenPresent)
          }))
        }
      });
      return structuredClone(data);
    },
    fetchMonth: async (month): Promise<MonthResult> => {
      await delay(500);
      const bySource = store(month);
      const sources = data.settings.jiraConnections
        .filter((connection) => connection.enabled)
        .map((connection) => {
          const worklogs = bySource.get(connection.id) || [];
          const keys = new Set([
            ...worklogs.map((item) => item.issueKey),
            ...data.pinnedIssues.filter((item) => item.sourceId === connection.id).map((item) => item.key)
          ]);
          if (connection.id === "main") keys.add("INT-15");
          const issues = [...keys].map((key) => {
            const known = ISSUES.find(([, issueKey]) => issueKey === key);
            return issue(connection.id, key, known?.[2] || `Issue ${key}`);
          });
          return { sourceId: connection.id, sourceName: connection.name, user: "Demo User", issues, worklogs: structuredClone(worklogs) };
        });
      return { month, sources, errors: [], configured: sources.length };
    },
    addIssue: async (sourceId, issueKey) => {
      await delay();
      const key = issueKey.trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) throw new Error(`Issue does not exist: ${key}`);
      if (!data.pinnedIssues.some((item) => item.sourceId === sourceId && item.key === key)) {
        data.pinnedIssues.push({ sourceId, key });
      }
      return { data: structuredClone(data), issue: issue(sourceId, key, `Issue ${key}`) };
    },
    // Demo only: understands project names in the JQL (project = X / project in (X, Y)).
    matchFilter: async (jql, keys) => {
      await delay(300);
      if (/!!/.test(jql)) {
        return { matches: {}, errors: [{ sourceId: "main", sourceName: "Delivery Jira", message: "Error in the JQL Query" }] };
      }
      const words = new Set(jql.toUpperCase().match(/[A-Z][A-Z0-9_]+/g) || []);
      const matches = Object.fromEntries(
        Object.entries(keys).map(([sourceId, list]) => [sourceId, list.filter((key) => words.has(key.split("-")[0]))])
      );
      return { matches, errors: [] };
    },
    createWorklog: async (sourceId, payload) => {
      await delay();
      const worklog: Worklog = {
        id: String(nextId++),
        issueKey: payload.issueKey,
        date: payload.date,
        started: `${payload.date}T09:00:00.000+0200`,
        seconds: payload.seconds,
        comment: ""
      };
      const bySource = store(payload.date.slice(0, 7));
      if (!bySource.has(sourceId)) bySource.set(sourceId, []);
      bySource.get(sourceId)!.push(worklog);
      return structuredClone(worklog);
    },
    updateWorklog: async (sourceId, payload) => {
      await delay();
      const { list, index } = find(sourceId, payload.worklogId);
      list[index] = { ...list[index], seconds: payload.seconds };
      return structuredClone(list[index]);
    },
    deleteWorklog: async (sourceId, payload) => {
      await delay();
      if (!canDelete) {
        throw new Error(
          'Jira does not let your account delete worklogs in this project (missing "Delete Own Worklogs" permission). Lower the time to at least 1m instead, or ask your Jira admin.'
        );
      }
      const { list, index } = find(sourceId, payload.worklogId);
      list.splice(index, 1);
      return { ok: true };
    },
    testConnection: async (connection) => {
      await delay(400);
      if (!connection.baseUrl) throw new Error("Base URL is not configured.");
      return { ok: true, displayName: "Demo User" };
    },
    openExternal: async (url) => {
      window.open(url, "_blank");
    },
    getAppInfo: async () => ({ version: "dev", dataFilePath: "(browser preview: nothing is saved)" })
  };
}

export function installDevApi() {
  if (!window.timesheets) {
    window.timesheets = createDevApi();
  }
}
