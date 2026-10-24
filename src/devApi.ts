// In-browser stand-in for the Electron bridge, used by `npm run dev:web` and tests.
import type { Absence, AppData, Issue, MonthResult, TimesheetsApi, Worklog } from "./types";
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

// Issues with no time logged by you: only reachable through a JQL search or free filter.
const UNLOGGED_ISSUES: Array<[string, string, string]> = [
  ["main", "SUP-1101", "Statement export times out for large accounts"],
  ["main", "IMPL-330", "Card scheme certification test plan"],
  ["client", "OPS-512", "Weekend deployment window"]
];

// Demo issue type icons (simple shapes, like Jira's): Task, Bug, Story, Sub-task.
const svgIcon = (body: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`)}`;
const DEMO_TYPES: Record<string, [string, string]> = {
  Task: ["Task", svgIcon('<rect width="16" height="16" rx="3" fill="#4bade8"/><path d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')],
  Bug: ["Bug", svgIcon('<rect width="16" height="16" rx="3" fill="#e5493a"/><circle cx="8" cy="8" r="3.5" fill="#fff"/>')],
  Story: ["Story", svgIcon('<rect width="16" height="16" rx="3" fill="#63ba3c"/><path d="M5 3.5h6v9l-3-2.2-3 2.2z" fill="#fff"/>')],
  Subtask: ["Sub-task", svgIcon('<rect width="16" height="16" rx="3" fill="#4bade8"/><rect x="4" y="4" width="5" height="5" rx="1" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="7" y="7" width="5" height="5" rx="1" fill="#fff"/>')]
};
const demoType = (key: string) => {
  const project = key.split("-")[0];
  if (project === "SUP" || project === "OPS") return DEMO_TYPES.Bug;
  if (project === "IMPL" || project === "BA") return DEMO_TYPES.Story;
  if (project === "ARCH") return DEMO_TYPES.Subtask;
  return DEMO_TYPES.Task;
};

function issue(sourceId: string, key: string, summary: string): Issue {
  const [issueType, typeIcon] = demoType(key);
  return {
    sourceId,
    sourceName: sourceId === "main" ? "Delivery Jira" : "Client Jira",
    key,
    summary,
    projectKey: key.split("-")[0],
    status: "In Progress",
    url: `https://jira.example.com/browse/${key}`,
    issueType,
    typeIcon
  };
}

/** Demo absences: a two-day vacation in the 2nd week and a sick day in the 3rd week of the month. */
export function demoAbsences(month: string): Absence[] {
  const workdays = monthDays(month).filter((day) => !day.isWeekend);
  const absence = (key: string, summary: string, from: string, to: string): Absence => ({
    key,
    summary,
    status: "Approved",
    from,
    to,
    url: `https://jira.example.com/browse/${key}`
  });
  return [
    absence("CAL-101", "Vacation", workdays[6].key, workdays[7].key),
    absence("CAL-102", "Sick leave", workdays[14].key, workdays[14].key)
  ];
}

function seededData(month: string): Map<string, Worklog[]> {
  const off = new Set(
    demoAbsences(month).flatMap((item) => monthDays(month).filter((d) => d.key >= item.from && d.key <= item.to).map((d) => d.key))
  );
  const bySource = new Map<string, Worklog[]>([["main", []], ["client", []]]);
  let id = 10000;
  let seed = month.split("-").reduce((sum, part) => sum + Number(part), 7);
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const today = new Date().toISOString().slice(0, 10);
  for (const day of monthDays(month)) {
    if (day.isWeekend || day.key > today || off.has(day.key)) continue;
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
      theme: "classic",
      tableFont: "system",
      tableFontSize: 12,
      backgroundColor: "",
      baseJql: 'worklogAuthor = currentUser() AND worklogDate >= "{monthStart}" AND worklogDate <= "{monthEnd}"',
      allFilter: { jql: "", free: false },
      absences: {
        enabled: true,
        sourceId: "",
        jql: 'project = calendar AND Employee = currentUser() and type = "Absence Request"',
        fromField: "customfield_10800",
        toField: "customfield_10801"
      },
      filters: [
        { id: "f1", label: "Support", jql: "project = SUP", free: false },
        { id: "f2", label: "Implementation", jql: "project = IMPL", free: false },
        { id: "f3", label: "SME", jql: "project in (ARCH, BA)", free: false },
        { id: "f4", label: "All support", jql: "project = SUP AND resolution = Unresolved", free: true }
      ],
      jiraConnections: [
        { id: "main", name: "Delivery Jira", baseUrl: "https://jira.example.com", apiVersion: "2", authType: "bearer", email: "", extraJql: "filter = worklogs", enabled: true, tokenPresent: true },
        { id: "client", name: "Client Jira", baseUrl: "https://client.atlassian.net", apiVersion: "3", authType: "basic", email: "me@example.com", extraJql: "", enabled: true, tokenPresent: true }
      ]
    }
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
          const keys = new Set(worklogs.map((item) => item.issueKey));
          if (connection.id === "main") keys.add("INT-15");
          const issues = [...keys].map((key) => {
            const known = ISSUES.find(([, issueKey]) => issueKey === key);
            return issue(connection.id, key, known?.[2] || `Issue ${key}`);
          });
          return { sourceId: connection.id, sourceName: connection.name, user: "Demo User", issues, worklogs: structuredClone(worklogs) };
        });
      return {
        month,
        sources,
        errors: [],
        configured: sources.length,
        absences: data.settings.absences.enabled ? demoAbsences(month) : [],
        absenceErrors: []
      };
    },
    // Demo only: explicit keys (SUP-1, IMPL-2) or project names in the JQL; "!!" is a JQL error.
    searchIssues: async (jql) => {
      await delay(400);
      if (/!!/.test(jql)) {
        return {
          sources: [],
          errors: data.settings.jiraConnections.map((c) => ({ sourceId: c.id, sourceName: c.name, message: "Error in the JQL Query" }))
        };
      }
      const upper = jql.toUpperCase();
      const keys = upper.match(/\b[A-Z][A-Z0-9_]+-\d+\b/g) || [];
      const words = new Set(upper.match(/[A-Z][A-Z0-9_]+/g) || []);
      const pool = [...ISSUES, ...UNLOGGED_ISSUES];
      const picked = keys.length
        ? keys.map((key) => pool.find(([, k]) => k === key) || (["main", key, `Issue ${key}`] as [string, string, string]))
        : pool.filter(([, key]) => words.has(key.split("-")[0]));
      const sources = data.settings.jiraConnections
        .filter((connection) => connection.enabled)
        .map((connection) => ({
          sourceId: connection.id,
          sourceName: connection.name,
          truncated: false,
          issues: picked.filter(([sourceId]) => sourceId === connection.id).map(([sourceId, key, summary]) => issue(sourceId, key, summary))
        }));
      return { sources, errors: [] };
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
