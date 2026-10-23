export type AuthType = "basic" | "bearer";
export type ApiVersion = "2" | "3";
export type DisplayFormat = "decimal" | "jira";
export type Theme = "system" | "light" | "dark";

export interface JiraConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiVersion: ApiVersion;
  authType: AuthType;
  email: string;
  extraJql: string;
  enabled: boolean;
  tokenPresent?: boolean;
  /** Only sent to the main process when the user typed a new secret. */
  token?: string;
  clearToken?: boolean;
}

export interface FilterGroup {
  id: string;
  label: string;
  projectKeys: string[];
}

export interface Settings {
  worklogStartTime: string;
  dailyNormHours: number;
  showWeekends: boolean;
  displayFormat: DisplayFormat;
  theme: Theme;
  filters: FilterGroup[];
  jiraConnections: JiraConnection[];
}

export interface PinnedIssue {
  sourceId: string;
  key: string;
}

export interface AppData {
  version: number;
  settings: Settings;
  pinnedIssues: PinnedIssue[];
}

export interface Issue {
  sourceId: string;
  sourceName: string;
  key: string;
  summary: string;
  projectKey: string;
  status: string;
  url: string;
}

export interface Worklog {
  id: string;
  issueKey: string;
  /** YYYY-MM-DD */
  date: string;
  started: string;
  seconds: number;
  comment: string;
}

export interface SourceMonth {
  sourceId: string;
  sourceName: string;
  user: string;
  issues: Issue[];
  worklogs: Worklog[];
}

export interface SourceError {
  sourceId: string;
  sourceName?: string;
  message: string;
}

export interface MonthResult {
  month: string;
  sources: SourceMonth[];
  errors: SourceError[];
  configured: number;
}

export interface AppInfo {
  version: string;
  dataFilePath: string;
}

export interface TimesheetsApi {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData) => Promise<AppData>;
  fetchMonth: (month: string) => Promise<MonthResult>;
  addIssue: (sourceId: string, issueKey: string) => Promise<{ data: AppData; issue: Issue }>;
  createWorklog: (sourceId: string, payload: { issueKey: string; date: string; seconds: number }) => Promise<Worklog>;
  updateWorklog: (
    sourceId: string,
    payload: { issueKey: string; worklogId: string; seconds: number; started?: string }
  ) => Promise<Worklog>;
  deleteWorklog: (sourceId: string, payload: { issueKey: string; worklogId: string }) => Promise<{ ok: boolean }>;
  testConnection: (connection: JiraConnection) => Promise<{ ok: boolean; displayName: string; emailAddress?: string }>;
  openExternal: (url: string) => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
}

declare global {
  interface Window {
    timesheets: TimesheetsApi;
  }
}
