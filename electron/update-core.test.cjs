// describe, it and expect are Vitest globals (see vite.config.ts).
const core = require("./update-core.cjs");

const release = (overrides = {}) => ({
  tag_name: "v0.9.0",
  name: "Timesheets 0.9.0",
  body: "- New things",
  published_at: "2026-10-25T10:00:00Z",
  html_url: "https://github.com/sava-code/Timesheets/releases/tag/v0.9.0",
  draft: false,
  prerelease: false,
  assets: [
    { name: "Timesheets-0.9.0-portable.exe", browser_download_url: "https://github.com/sava-code/Timesheets/releases/download/v0.9.0/Timesheets-0.9.0-portable.exe" },
    { name: "Timesheets-0.9.0-mac-universal.dmg", browser_download_url: "https://github.com/sava-code/Timesheets/releases/download/v0.9.0/Timesheets-0.9.0-mac-universal.dmg" },
    { name: "Timesheets-0.9.0-mac-universal.zip", browser_download_url: "https://github.com/sava-code/Timesheets/releases/download/v0.9.0/Timesheets-0.9.0-mac-universal.zip" }
  ],
  ...overrides
});

describe("update-core", () => {
  it("compares semantic versions", () => {
    expect(core.isNewerVersion("0.9.0", "0.8.0")).toBe(true);
    expect(core.isNewerVersion("v0.10.0", "0.9.9")).toBe(true);
    expect(core.isNewerVersion("0.8.0", "0.8.0")).toBe(false);
    expect(core.isNewerVersion("0.7.9", "0.8.0")).toBe(false);
    expect(core.isNewerVersion("1.0.0", "1.0.0-beta")).toBe(true);
    expect(core.isNewerVersion("garbage", "0.8.0")).toBe(false);
  });

  it("reports a newer release with the file for this computer", () => {
    const mac = core.releaseStatusFromGitHub(release(), "0.8.0", "darwin");
    expect(mac).toMatchObject({
      stage: "available",
      version: "0.9.0",
      releaseNotes: "- New things",
      releaseDate: "2026-10-25",
      releaseUrl: "https://github.com/sava-code/Timesheets/releases/tag/v0.9.0",
      downloadName: "Timesheets-0.9.0-mac-universal.dmg"
    });
    expect(core.releaseStatusFromGitHub(release(), "0.8.0", "win32").downloadName).toBe("Timesheets-0.9.0-portable.exe");
    expect(core.releaseStatusFromGitHub(release(), "0.8.0", "linux").downloadUrl).toBe("");
  });

  it("is up to date when the release is not newer, a draft or a prerelease", () => {
    expect(core.releaseStatusFromGitHub(release(), "0.9.0", "darwin").stage).toBe("up-to-date");
    expect(core.releaseStatusFromGitHub(release({ prerelease: true }), "0.8.0", "darwin").stage).toBe("up-to-date");
    expect(core.releaseStatusFromGitHub(release({ draft: true }), "0.8.0", "darwin").stage).toBe("up-to-date");
  });

  it("never links outside this repository's releases", () => {
    const evil = release({
      html_url: "https://evil.example.com/download",
      assets: [{ name: "Timesheets-0.9.0-mac-universal.dmg", browser_download_url: "https://evil.example.com/x.dmg" }]
    });
    const status = core.releaseStatusFromGitHub(evil, "0.8.0", "darwin");
    expect(status.releaseUrl).toBe(core.GITHUB_RELEASES_URL);
    expect(status.downloadUrl).toBe("");
  });

  it("explains a missing or private repository and network errors", async () => {
    const reply = (status, body = {}) => async () => ({ status, ok: status < 400, json: async () => body });
    await expect(core.checkGitHubLatestRelease("0.8.0", "darwin", reply(404))).rejects.toThrow(/No public Timesheets release/);
    await expect(core.checkGitHubLatestRelease("0.8.0", "darwin", reply(500))).rejects.toThrow(/HTTP 500/);
    await expect(
      core.checkGitHubLatestRelease("0.8.0", "darwin", async () => {
        throw new Error("offline");
      })
    ).rejects.toThrow(/Could not reach GitHub: offline/);
    const ok = await core.checkGitHubLatestRelease("0.8.0", "darwin", reply(200, release()));
    expect(ok.stage).toBe("available");
  });
});
