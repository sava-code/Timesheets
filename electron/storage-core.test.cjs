// describe, it and expect are Vitest globals (see vite.config.ts).
const core = require("./storage-core.cjs");

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`enc:${text}`),
  decryptString: (buffer) => buffer.toString().replace(/^enc:/, "")
};

describe("storage-core", () => {
  it("fills defaults and normalises values", () => {
    const data = core.mergeDefaults({
      settings: {
        worklogStartTime: "9:5",
        dailyNormHours: 99,
        filters: [{ label: "SME", projectKeys: "arch, ba ba" }, { label: "Mine", jql: " assignee = currentUser() " }],
        jiraConnections: [{ id: "x", baseUrl: "https://jira.example.com///", apiVersion: "v3", authType: "weird" }]
      },
      pinnedIssues: [{ sourceId: "x", key: "SUP-1" }]
    });
    expect(data.settings.worklogStartTime).toBe("09:00");
    expect(data.settings.dailyNormHours).toBe(8);
    // Old project-key filters become JQL.
    expect(data.settings.filters[0]).toMatchObject({ label: "SME", jql: "project in (ARCH, BA)" });
    expect(data.settings.filters[0]).not.toHaveProperty("projectKeys");
    expect(data.settings.filters[1].jql).toBe("assignee = currentUser()");
    expect(data.settings.jiraConnections[0]).toMatchObject({
      id: "x",
      baseUrl: "https://jira.example.com",
      apiVersion: "2",
      authType: "basic"
    });
    // "Add issue" was removed; its saved list is dropped.
    expect(data).not.toHaveProperty("pinnedIssues");
    expect(data.settings.filters[0].free).toBe(false);
    expect(data.settings.allFilter).toEqual({ jql: "", free: false });
  });

  const DEFAULT_LOOK = { theme: "classic", tableFont: "system", tableFontSize: 12, backgroundColor: "" };

  it("defaults to the current look and moves files from older versions to it once", () => {
    expect(core.defaultData().settings).toMatchObject(DEFAULT_LOOK);
    for (const version of [1, 2]) {
      const old = core.mergeDefaults({ version, settings: { theme: "dark", tableFont: "segoe", tableFontSize: 14, backgroundColor: "" } });
      expect(old.settings).toMatchObject(DEFAULT_LOOK);
      expect(old.version).toBe(8);
    }
    // From version 3 on, the user's choice is kept.
    const chosen = core.mergeDefaults({ version: 3, settings: { theme: "dark", tableFont: "mono", tableFontSize: 16, backgroundColor: "" } });
    expect(chosen.settings).toMatchObject({ theme: "dark", tableFont: "mono", tableFontSize: 16, backgroundColor: "" });
    // Version 7 moves the old default system font to Segoe UI once; later choices stay.
    // Version 8 moves Segoe UI (the 1.1–1.2 default) back to the system font once; later choices stay.
    expect(core.mergeDefaults({ version: 6, settings: { tableFont: "system" } }).settings.tableFont).toBe("system");
    expect(core.mergeDefaults({ version: 7, settings: { tableFont: "segoe" } }).settings.tableFont).toBe("system");
    expect(core.mergeDefaults({ version: 7, settings: { tableFont: "inter" } }).settings.tableFont).toBe("inter");
    expect(core.mergeDefaults({ version: 8, settings: { tableFont: "segoe" } }).settings.tableFont).toBe("segoe");
  });

  it("starts with the default free filters and adds them once to older settings", () => {
    const presets = core.defaultData().settings.filters;
    expect(presets).toEqual([
      { id: "viewed-recently", label: "Viewed recently", jql: "issuekey in issueHistory() order by lastViewed DESC", free: true, sourceId: "" },
      {
        id: "my-open-tickets",
        label: "My open tickets",
        jql: "assignee = currentUser() AND resolution = Unresolved order by updated DESC",
        free: true,
        sourceId: ""
      }
    ]);
    // Version 3 user with their own filters, one of them already the same JQL: only the missing one is added, at the end.
    const old = core.mergeDefaults({
      version: 3,
      settings: {
        filters: [
          { id: "s", label: "Support", jql: "project = SUP" },
          { id: "mine", label: "Mine", jql: "assignee = currentUser()  AND resolution = Unresolved ORDER BY updated DESC", free: false }
        ]
      }
    });
    expect(old.settings.filters.map((filter) => filter.label)).toEqual(["Support", "Mine", "Viewed recently"]);
    // Version 3 keeps its appearance (only versions before 3 were reset).
    expect(core.mergeDefaults({ version: 3, settings: { theme: "dark" } }).settings.theme).toBe("dark");
    // From version 4 on, deleted presets stay deleted.
    expect(core.mergeDefaults({ version: 4, settings: { filters: [] } }).settings.filters).toEqual([]);
  });

  it("turns the stored default white into the theme background, keeping other colours", () => {
    expect(core.mergeDefaults({ version: 4, settings: { backgroundColor: "#FFFFFF" } }).settings.backgroundColor).toBe("");
    expect(core.mergeDefaults({ version: 4, settings: { backgroundColor: "#fdf6e3" } }).settings.backgroundColor).toBe("#fdf6e3");
    expect(core.mergeDefaults({ version: 5, settings: { backgroundColor: "#ffffff" } }).settings.backgroundColor).toBe("#ffffff");
  });

  it("defaults and validates the absence settings", () => {
    expect(core.defaultData().settings.absences).toEqual({
      enabled: true,
      sourceId: "",
      jql: 'project = calendar AND Employee = currentUser() and type = "Absence Request"',
      fromField: "customfield_10800",
      toField: "customfield_10801"
    });
    // The previous default is updated once; an edited JQL is kept.
    const previous = (jql, version = 5) => core.mergeDefaults({ version, settings: { absences: { jql } } }).settings.absences.jql;
    expect(previous("project = calendar AND Employee = currentUser()")).toBe('project = calendar AND Employee = currentUser() and type = "Absence Request"');
    expect(previous("project = calendar AND Employee = currentUser() AND status = Approved")).toBe(
      "project = calendar AND Employee = currentUser() AND status = Approved"
    );
    expect(previous("project = calendar AND Employee = currentUser()", 6)).toBe("project = calendar AND Employee = currentUser()");
    const custom = core.mergeDefaults({
      version: 4,
      settings: { absences: { enabled: false, sourceId: "b", jql: " ", fromField: "customfield_1", toField: "bad field; drop" } }
    }).settings.absences;
    expect(custom).toEqual({
      enabled: false,
      sourceId: "b",
      jql: 'project = calendar AND Employee = currentUser() and type = "Absence Request"',
      fromField: "customfield_1",
      toField: "customfield_10801"
    });
  });

  it("asks for comments by default, switched on once for older settings", () => {
    expect(core.defaultData().settings.askComment).toBe(true);
    expect(core.mergeDefaults({ version: 6, settings: { askComment: false } }).settings.askComment).toBe(true);
    expect(core.mergeDefaults({ version: 7, settings: { askComment: false } }).settings.askComment).toBe(false);
    expect(core.mergeDefaults({ version: 7, settings: {} }).settings.askComment).toBe(true);
  });

  it("defaults the client field by Jira URL and keeps the user's choice", () => {
    expect(core.defaultClientField("https://ows-jira.spb.openwaygroup.com")).toBe("customfield_11000");
    expect(core.defaultClientField("https://jira.example.com")).toBe("customfield_10703");
    const merged = core.mergeDefaults({
      version: 7,
      settings: {
        jiraConnections: [
          { id: "a", baseUrl: "https://ows-jira.spb.openwaygroup.com" },
          { id: "b", baseUrl: "https://acme.atlassian.net" },
          { id: "c", baseUrl: "https://acme.atlassian.net", clientField: " customfield_12345 " },
          { id: "d", baseUrl: "https://acme.atlassian.net", clientField: "" }
        ]
      }
    });
    expect(merged.settings.jiraConnections.map((item) => item.clientField)).toEqual([
      "customfield_11000",
      "customfield_10703",
      "customfield_12345",
      ""
    ]);
    expect(core.defaultData().settings.jiraConnections[0].clientField).toBe("customfield_10703");
  });

  it("shows issue type icons unless switched off", () => {
    expect(core.defaultData().settings.showTypeIcons).toBe(true);
    expect(core.mergeDefaults({ version: 7, settings: {} }).settings.showTypeIcons).toBe(true);
    expect(core.mergeDefaults({ version: 7, settings: { showTypeIcons: false } }).settings.showTypeIcons).toBe(false);
  });

  it("keeps each filter's Jira source, every source by default", () => {
    const filters = core.mergeDefaults({
      version: 9,
      settings: { filters: [{ id: "a", label: "A", jql: "x = 1", sourceId: " jira-2 " }, { id: "b", label: "B", jql: "y = 2" }] }
    }).settings.filters;
    expect(filters.map((filter) => filter.sourceId)).toEqual(["jira-2", ""]);
  });

  it("has the default allocation categories and cleans edited ones", () => {
    const rules = core.defaultData().settings.allocationRules;
    expect(rules.map((rule) => rule.name)).toEqual(["Support", "Implementation", "SME", "Academy", "Apollo"]);
    expect(rules[0]).toEqual({ id: "support", name: "Support", types: "Support Request", projects: "Support Infrastructure, Customer Upgrade", summary: "" });
    const edited = core.mergeDefaults({
      version: 7,
      settings: { allocationRules: [{ id: "x", name: " Ops ", projects: "OPS", extra: 1 }, { id: "y", name: "", projects: "Z" }, "junk"] }
    }).settings.allocationRules;
    expect(edited).toEqual([{ id: "x", name: "Ops", types: "", projects: "OPS", summary: "" }]);
    expect(core.mergeDefaults({ version: 7, settings: { allocationRules: [] } }).settings.allocationRules).toEqual([]);
  });

  it("defaults the base JQL and falls back to it when cleared", () => {
    const base = 'worklogAuthor = currentUser() AND worklogDate >= "{monthStart}" AND worklogDate <= "{monthEnd}"';
    expect(core.defaultData().settings.baseJql).toBe(base);
    expect(core.mergeDefaults({ version: 6, settings: { baseJql: "  " } }).settings.baseJql).toBe(base);
    expect(core.mergeDefaults({ version: 6, settings: { baseJql: " project = SUP " } }).settings.baseJql).toBe("project = SUP");
  });

  it("validates the background colour and the All/free filter settings", () => {
    const good = core.mergeDefaults({
      version: 3,
      settings: { backgroundColor: "#FDF6E3", allFilter: { jql: " project = X ", free: true }, filters: [{ label: "F", jql: "a = b", free: true }] }
    });
    expect(good.settings).toMatchObject({ backgroundColor: "#fdf6e3", allFilter: { jql: "project = X", free: true } });
    expect(good.settings.filters[0].free).toBe(true);
    const bad = core.mergeDefaults({ version: 3, settings: { backgroundColor: "red; background: url(x)" } });
    expect(bad.settings.backgroundColor).toBe("");
  });

  it("encrypts new secrets, keeps old ones and never exposes them", () => {
    const existing = core.mergeDefaults({ settings: { jiraConnections: [{ id: "a" }, { id: "b" }] } });
    existing.settings.jiraConnections[1].tokenCipher = "old";

    const incoming = {
      settings: {
        jiraConnections: [
          { id: "a", token: " secret ", tokenPresent: false },
          { id: "b", tokenPresent: true, tokenCipher: "forged" }
        ]
      }
    };
    const next = core.normalizeIncomingData(incoming, existing, fakeSafeStorage);
    expect(core.decryptToken(next.settings.jiraConnections[0], fakeSafeStorage)).toBe("secret");
    expect(next.settings.jiraConnections[1].tokenCipher).toBe("old");

    const visible = core.sanitizeData(next);
    expect(visible.settings.jiraConnections[0]).not.toHaveProperty("tokenCipher");
    expect(visible.settings.jiraConnections[0].tokenPresent).toBe(true);
  });

  it("clears a secret on request", () => {
    const existing = core.mergeDefaults({ settings: { jiraConnections: [{ id: "a" }] } });
    existing.settings.jiraConnections[0].tokenCipher = "old";
    const next = core.normalizeIncomingData({ settings: { jiraConnections: [{ id: "a", clearToken: true }] } }, existing, fakeSafeStorage);
    expect(next.settings.jiraConnections[0].tokenCipher).toBeUndefined();
  });

  it("refuses to store secrets without OS encryption", () => {
    const unavailable = { isEncryptionAvailable: () => false };
    expect(() =>
      core.normalizeIncomingData({ settings: { jiraConnections: [{ id: "a", token: "x" }] } }, core.defaultData(), unavailable)
    ).toThrow(/Encrypted credential storage/);
  });
});
