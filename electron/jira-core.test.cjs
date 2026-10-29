// describe, it and expect are Vitest globals (see vite.config.ts).
const core = require("./jira-core.cjs");

describe("jira-core", () => {
  it("builds the base JQL for a month from the template", () => {
    expect(core.monthWorklogJql("2026-02")).toBe('worklogAuthor = currentUser() AND worklogDate >= "2026-02-01" AND worklogDate <= "2026-02-28"');
    expect(core.monthWorklogJql("2026-10", "worklogAuthor = currentUser() AND worklogDate >= {monthStart} AND project = SUP")).toBe(
      "worklogAuthor = currentUser() AND worklogDate >= 2026-10-01 AND project = SUP"
    );
    expect(core.monthWorklogJql("2026-10", "")).toBe(core.monthWorklogJql("2026-10"));
    expect(() => core.monthRange("2026-2")).toThrow();
  });

  it("restricts a filter JQL to the timesheet's issue keys", () => {
    expect(core.restrictJqlToKeys("project = SUP ORDER BY created DESC", ["SUP-1", "SUP-2"])).toBe(
      '(project = SUP) AND key in ("SUP-1","SUP-2")'
    );
    expect(core.restrictJqlToKeys("labels = a OR labels = b", ["X-1"])).toBe('(labels = a OR labels = b) AND key in ("X-1")');
    expect(() => core.restrictJqlToKeys("  ", ["X-1"])).toThrow(/empty/);
    expect(core.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("reads absence dates from date and datetime fields", () => {
    const connection = { baseUrl: "https://jira.example.com/" };
    const raw = (fields) => ({ key: "CAL-1", fields: { summary: "Vacation", status: { name: "Approved" }, ...fields } });
    expect(core.toAbsence(connection, raw({ customfield_10800: "2026-10-08", customfield_10801: "2026-10-09" }), "customfield_10800", "customfield_10801")).toEqual({
      key: "CAL-1",
      summary: "Vacation",
      status: "Approved",
      from: "2026-10-08",
      to: "2026-10-09",
      url: "https://jira.example.com/browse/CAL-1"
    });
    // Datetime values, a missing end date (one day) and reversed dates.
    const datetime = core.toAbsence(connection, raw({ customfield_10800: "2026-10-08T00:00:00.000+0200" }), "customfield_10800", "customfield_10801");
    expect([datetime.from, datetime.to]).toEqual(["2026-10-08", "2026-10-08"]);
    const reversed = core.toAbsence(connection, raw({ customfield_10800: "2026-10-09", customfield_10801: "2026-10-07" }), "customfield_10800", "customfield_10801");
    expect([reversed.from, reversed.to]).toEqual(["2026-10-07", "2026-10-09"]);
    // No start date: ignored.
    expect(core.toAbsence(connection, raw({}), "customfield_10800", "customfield_10801")).toBeNull();
  });

  it("keeps the issue type and only trusts icon URLs from the Jira itself", () => {
    const connection = { id: "s", name: "S", baseUrl: "https://jira.example.com" };
    const issue = core.toIssue(connection, {
      key: "SUP-1",
      fields: { summary: "x", issuetype: { name: "Bug", iconUrl: "https://jira.example.com/secure/viewavatar?avatarId=10303&avatarType=issuetype" } }
    });
    expect(issue).toMatchObject({ issueType: "Bug", typeIcon: "https://jira.example.com/secure/viewavatar?avatarId=10303&avatarType=issuetype" });
    expect(core.isTrustedIconUrl(connection, issue.typeIcon)).toBe(true);
    expect(core.isTrustedIconUrl({ baseUrl: "https://acme.atlassian.net" }, "https://acme.atlassian.net/rest/api/2/universal_avatar/view/type/issuetype/avatar/10318")).toBe(true);
    expect(core.isTrustedIconUrl(connection, "https://evil.example.org/icon.svg")).toBe(false);
    expect(core.isTrustedIconUrl(connection, "file:///etc/passwd")).toBe(false);
    expect(core.isTrustedIconUrl(connection, "not a url")).toBe(false);
  });

  it("reads the client from the source's client field and asks Jira for it", () => {
    const connection = { id: "s", name: "S", baseUrl: "https://jira.example.com", clientField: "customfield_10703" };
    const client = (value) => core.toIssue(connection, { key: "SUP-1", fields: { summary: "x", customfield_10703: value } }).client;
    expect(client("Acme Bank ")).toBe("Acme Bank");
    expect(client({ value: "Acme Bank", id: "1" })).toBe("Acme Bank");
    expect(client({ value: "Acme", child: { value: "Retail" } })).toBe("Acme / Retail");
    expect(client([{ value: "Acme" }, { name: "Globex" }])).toBe("Acme, Globex");
    expect(client(null)).toBe("");
    expect(core.toIssue({ ...connection, clientField: "" }, { key: "SUP-1", fields: { customfield_10703: "Acme" } }).client).toBe("");
    expect(core.issueFields(connection)).toEqual(["summary", "project", "status", "issuetype", "customfield_10703"]);
    expect(core.issueFields({ clientField: " " })).toEqual(["summary", "project", "status", "issuetype"]);
  });

  it("adds the comment to a new worklog: plain text on Server, ADF on Cloud", () => {
    const server = core.newWorklogBody({ apiVersion: "2" }, { date: "2026-10-05", startTime: "09:00", seconds: 5400, comment: " Call with client " });
    expect(server).toMatchObject({ timeSpentSeconds: 5400, comment: "Call with client" });
    const cloud = core.newWorklogBody({ apiVersion: "3" }, { date: "2026-10-05", startTime: "09:00", seconds: 5400, comment: "Line 1\nLine 2" });
    expect(cloud.comment.content.map((p) => p.content[0].text)).toEqual(["Line 1", "Line 2"]);
    expect(core.newWorklogBody({ apiVersion: "2" }, { date: "2026-10-05", startTime: "09:00", seconds: 5400, comment: "  " })).not.toHaveProperty("comment");
  });

  it("builds auth headers", () => {
    expect(core.buildAuthHeader({ authType: "bearer" }, "abc")).toBe("Bearer abc");
    expect(core.buildAuthHeader({ authType: "basic", email: "u" }, "p")).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    expect(() => core.buildAuthHeader({ authType: "basic", email: "" }, "p")).toThrow(/User name/);
    expect(() => core.buildAuthHeader({ authType: "bearer" }, "")).toThrow(/token/);
  });

  it("recognises the current user's worklogs on Cloud and Server", () => {
    expect(core.isOwnWorklog({ author: { accountId: "x1" } }, { accountId: "x1" })).toBe(true);
    expect(core.isOwnWorklog({ author: { accountId: "x2" } }, { accountId: "x1" })).toBe(false);
    expect(core.isOwnWorklog({ author: { name: "mike", key: "JIRAUSER1" } }, { name: "mike", key: "JIRAUSER1" })).toBe(true);
    expect(core.isOwnWorklog({ author: { name: "ann" } }, { name: "mike" })).toBe(false);
  });

  it("maps worklogs and reads ADF comments", () => {
    const worklog = core.toWorklog("SUP-1", {
      id: 42,
      started: "2026-10-05T23:30:00.000+0200",
      timeSpentSeconds: 1800,
      comment: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Call" }] }] }
    });
    expect(worklog).toEqual({
      created: "",
      id: "42",
      issueKey: "SUP-1",
      date: "2026-10-05",
      started: "2026-10-05T23:30:00.000+0200",
      seconds: 1800,
      comment: "Call"
    });
  });

  it("formats the started timestamp in local time with offset", () => {
    expect(core.jiraStarted("2026-10-05", "09:00")).toMatch(/^2026-10-05T09:00:00\.000[+-]\d{4}$/);
  });

  it("validates worklog length", () => {
    expect(core.validateSeconds(5400)).toBe(5400);
    expect(() => core.validateSeconds(30)).toThrow();
    expect(() => core.validateSeconds(25 * 3600)).toThrow();
  });

  it("collects Jira error messages", () => {
    expect(core.errorMessage(400, "Bad Request", { errorMessages: [], errors: { timeLogged: "Invalid time" } })).toBe("Invalid time");
    expect(core.errorMessage(401, "Unauthorized", null)).toBe("401 Unauthorized");
  });

  it("limits concurrency", async () => {
    let running = 0;
    let peak = 0;
    const out = await core.mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
