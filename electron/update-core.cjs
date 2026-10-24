// Update check against GitHub Releases (adapted from TimeCollector_Next's update-core).
// Timesheets ships a portable Windows exe and a macOS dmg, neither of which can update itself,
// so the check reports the new version and links to its download; it never installs anything.

const GITHUB_OWNER = "sava-code";
const GITHUB_REPOSITORY = "Timesheets";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases`;
const GITHUB_LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/releases/latest`;

function parseVersion(value) {
  const match = String(value || "")
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || ""
  };
}

function normalizeVersion(value) {
  const parsed = parseVersion(value);
  if (!parsed) return "";
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease ? `-${parsed.prerelease}` : ""}`;
}

function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (const key of ["major", "minor", "patch"]) {
    if (next[key] !== installed[key]) return next[key] > installed[key];
  }
  return Boolean(installed.prerelease && !next.prerelease);
}

/** Only links inside this repository's releases are opened. */
function trustedReleaseUrl(value) {
  const prefix = `${GITHUB_RELEASES_URL}/`;
  return typeof value === "string" && value.startsWith(prefix) ? value : GITHUB_RELEASES_URL;
}

/** The release file for this computer: the dmg on macOS, the portable exe on Windows. */
function assetForPlatform(assets, platform) {
  const suffix = platform === "darwin" ? "-mac-universal.dmg" : platform === "win32" ? "-portable.exe" : "";
  if (!suffix || !Array.isArray(assets)) return null;
  const asset = assets.find((item) => typeof item?.name === "string" && item.name.endsWith(suffix));
  if (!asset) return null;
  const url = trustedReleaseUrl(asset.browser_download_url);
  return url === GITHUB_RELEASES_URL ? null : { name: asset.name, url };
}

function releaseStatusFromGitHub(payload, currentVersion, platform) {
  const version = normalizeVersion(payload?.tag_name);
  if (!version) {
    throw new Error("The latest GitHub release has an invalid version tag.");
  }
  const available = !payload.draft && !payload.prerelease && isNewerVersion(version, currentVersion);
  const asset = available ? assetForPlatform(payload.assets, platform) : null;
  return {
    stage: available ? "available" : "up-to-date",
    currentVersion,
    version,
    releaseName: typeof payload.name === "string" ? payload.name : "",
    releaseNotes: typeof payload.body === "string" ? payload.body : "",
    releaseDate: typeof payload.published_at === "string" ? payload.published_at.slice(0, 10) : "",
    releaseUrl: trustedReleaseUrl(payload.html_url),
    downloadName: asset?.name || "",
    downloadUrl: asset?.url || "",
    message: available ? `Version ${version} is available.` : `Timesheets ${currentVersion} is up to date.`
  };
}

async function checkGitHubLatestRelease(currentVersion, platform, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new Error("Update checks are not supported by this Electron runtime.");
  }
  let response;
  try {
    response = await fetchImpl(GITHUB_LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Timesheets/${currentVersion}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    throw new Error(`Could not reach GitHub: ${error.message}`);
  }
  if (response.status === 404) {
    throw new Error("No public Timesheets release was found (the repository may be private, or nothing is released yet).");
  }
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }
  return releaseStatusFromGitHub(await response.json(), currentVersion, platform);
}

module.exports = {
  GITHUB_LATEST_RELEASE_API,
  GITHUB_RELEASES_URL,
  assetForPlatform,
  checkGitHubLatestRelease,
  isNewerVersion,
  normalizeVersion,
  releaseStatusFromGitHub,
  trustedReleaseUrl
};
