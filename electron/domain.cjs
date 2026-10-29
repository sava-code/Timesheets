const os = require("node:os");
const { execFileSync } = require("node:child_process");

function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
  } catch (_error) {
    return "";
  }
}

// What tells a company computer apart, read locally (no network call), only on first launch:
// on Windows the logon domain (USERDNSDOMAIN, set for domain accounts);
// on macOS the DNS search domains, the MDM enrolment and, as a backup, the device name.
function computerIdentity() {
  const platform = process.platform;
  if (platform === "darwin") {
    return {
      platform,
      dnsSearchDomains: run("/usr/sbin/scutil", ["--dns"]),
      mdmEnrollment: run("/usr/bin/profiles", ["status", "-type", "enrollment"]),
      computerNames: [run("/usr/sbin/scutil", ["--get", "ComputerName"]).trim(), run("/usr/sbin/scutil", ["--get", "LocalHostName"]).trim(), os.hostname()].filter(Boolean)
    };
  }
  return { platform, dnsDomain: process.env.USERDNSDOMAIN || "" };
}

module.exports = { computerIdentity };
