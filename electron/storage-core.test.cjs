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
        filters: [{ label: "SME", projectKeys: "arch, ba ba" }],
        jiraConnections: [{ id: "x", baseUrl: "https://jira.example.com///", apiVersion: "v3", authType: "weird" }]
      },
      pinnedIssues: [{ sourceId: "x", key: "sup-1" }, { sourceId: "x", key: "SUP-1" }, { key: "NOPE-1" }]
    });
    expect(data.settings.worklogStartTime).toBe("09:00");
    expect(data.settings.dailyNormHours).toBe(8);
    expect(data.settings.filters[0].projectKeys).toEqual(["ARCH", "BA"]);
    expect(data.settings.jiraConnections[0]).toMatchObject({
      id: "x",
      baseUrl: "https://jira.example.com",
      apiVersion: "2",
      authType: "basic"
    });
    expect(data.pinnedIssues).toEqual([{ sourceId: "x", key: "SUP-1" }]);
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
