// describe, it and expect are Vitest globals (see vite.config.ts).
const core = require("./jira-core.cjs");

describe("jira-core", () => {
  it("builds a month JQL with explicit dates", () => {
    expect(core.monthWorklogJql("2026-02")).toBe(
      'worklogAuthor = currentUser() AND worklogDate >= "2026-02-01" AND worklogDate <= "2026-02-28" ORDER BY key ASC'
    );
    expect(() => core.monthRange("2026-2")).toThrow();
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
