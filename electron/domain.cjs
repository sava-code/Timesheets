const os = require("node:os");
const { execFileSync } = require("node:child_process");

function scutil(key) {
  try {
    return execFileSync("/usr/sbin/scutil", ["--get", key], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_error) {
    return "";
  }
}

// What tells a company computer apart, read locally without a network call:
// on Windows the logon domain (USERDNSDOMAIN, set for domain accounts),
// on macOS the device name (Settings → General → About → Name) and its host names.
function computerIdentity() {
  const platform = process.platform;
  if (platform === "darwin") {
    return { platform, computerNames: [scutil("ComputerName"), scutil("LocalHostName"), os.hostname()].filter(Boolean) };
  }
  return { platform, dnsDomain: process.env.USERDNSDOMAIN || "" };
}

module.exports = { computerIdentity };
