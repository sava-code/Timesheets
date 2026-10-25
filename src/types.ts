export type AuthType = "basic" | "bearer";
export type ApiVersion = "2" | "3";
export type DisplayFormat = "decimal" | "jira";
/** "classic" is the look of the original Python app. */
export type Theme = "classic" | "system" | "light" | "dark";

export interface JiraConnection {
  id: string;
  name: string;
  baseUrl: string;
  apiVersion: ApiVersion;
  authType: AuthType;
  email: string;
  extraJql: string;
  /** Jira field with the issue's client, e.g. customfield_10703 ("" = none) */
  clientField: string;
  enabled: boolean;
  tokenPresent?: boolean;
  /** Only sent to the main process when the user typed a new secret. */
  token?: string;
  clearToken?: boolean;
}

/** A worklogs allocation category. Lists are comma-separated; any match puts the issue in it. */
export interface AllocationRule {
  id: string;
  name: string;
  /** Issue type names, e.g. "Support Request" */
  types: string;
  /** Project names or keys */
  projects: string;
  /** Text anywhere in the summary */
  summary: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  jql: string;
  /** Free: the JQL alone decides which issues are shown. Otherwise it narrows the base list. */
  free: boolean;
}

/** The "All" chip. Empty JQL shows the base list. */
export interface AllFilter {
  jql: string;
  free: boolean;
}

export interface SearchResult {
  sources: Array<{ sourceId: string; sourceName: string; issues: Issue[]; truncated: boolean }>;
  errors: SourceError[];
}

export interface FilterMatch {
  matches: Record<string, string[]>;
  errors: SourceError[];
}

export interface Settings {
  worklogStartTime: string;
  dailyNormHours: number;
  showWeekends: boolean;
  displayFormat: DisplayFormat;
  theme: Theme;
  /** Id from TABLE_FONTS. */
  tableFont: string;
  /** Pixels. */
  tableFontSize: number;
  /** "#rrggbb" for the window and table background, or "" for the theme default. */
  backgroundColor: string;
  /** JQL for the base list; {monthStart} and {monthEnd} are replaced with the month's dates. */
  baseJql: string;
  allFilter: AllFilter;
  /** Ask for a comment in a window when a new worklog is entered */
  askComment: boolean;
  /** Jira issue type icons before the summaries */
  showTypeIcons: boolean;
  /** Worklogs allocation categories, checked in order */
  allocationRules: AllocationRule[];
  absences: AbsenceSettings;
  filters: FilterGroup[];
  jiraConnections: JiraConnection[];
}

export interface AppData {
  version: number;
  settings: Settings;
}

export interface Issue {
  sourceId: string;
  sourceName: string;
  key: string;
  summary: string;
  projectKey: string;
  /** Jira project name, e.g. "Custom Development" (for the allocation categories) */
  projectName?: string;
  status: string;
  /** Client from the source's client field ("" when not set) */
  client?: string;
  url: string;
  /** Issue type name, e.g. "Bug" */
  issueType?: string;
  /** Issue type icon as a data: URL ("" when unavailable) */
  typeIcon?: string;
}

export interface Worklog {
  id: string;
  issueKey: string;
  /** YYYY-MM-DD */
  date: string;
  started: string;
  seconds: number;
  comment: string;
  /** When the worklog was entered in Jira (ISO timestamp); "" if unknown */
  created?: string;
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
  /** Your registered absences (all of them; the app picks the days of the shown month). */
  absences: Absence[];
  absenceErrors: SourceError[];
}

export interface Absence {
  key: string;
  summary: string;
  status: string;
  /** YYYY-MM-DD, inclusive */
  from: string;
  to: string;
  url: string;
}

export interface AbsenceSettings {
  enabled: boolean;
  /** Jira source holding the absences; "" = the first enabled one. */
  sourceId: string;
  jql: string;
  /** Field ids, e.g. customfield_10800 ("Leave from date") */
  fromField: string;
  toField: string;
}

export type UpdateStage = "idle" | "checking" | "up-to-date" | "available" | "error";

export interface UpdateStatus {
  stage: UpdateStage;
  currentVersion: string;
  version?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  releaseUrl: string;
  /** Direct link to the file for this computer (dmg / portable exe), when the release has one. */
  downloadName?: string;
  downloadUrl?: string;
  message: string;
}

export interface AppInfo {
  version: string;
  author?: string;
  releasesUrl?: string;
  dataFilePath: string;
}

export interface TimesheetsApi {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData) => Promise<AppData>;
  fetchMonth: (month: string) => Promise<MonthResult>;
  /** Issues returned by a free JQL on every enabled source. */
  searchIssues: (jql: string) => Promise<SearchResult>;
  /** Which of the given issue keys (per source) match the JQL. */
  matchFilter: (jql: string, keysBySource: Record<string, string[]>) => Promise<FilterMatch>;
  createWorklog: (sourceId: string, payload: { issueKey: string; date: string; seconds: number; comment?: string }) => Promise<Worklog>;
  updateWorklog: (
    sourceId: string,
    payload: { issueKey: string; worklogId: string; seconds: number; started?: string }
  ) => Promise<Worklog>;
  deleteWorklog: (sourceId: string, payload: { issueKey: string; worklogId: string }) => Promise<{ ok: boolean }>;
  testConnection: (connection: JiraConnection) => Promise<{ ok: boolean; displayName: string; emailAddress?: string }>;
  openExternal: (url: string) => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  checkForUpdates: () => Promise<UpdateStatus>;
}

declare global {
  interface Window {
    timesheets: TimesheetsApi;
  }
}
