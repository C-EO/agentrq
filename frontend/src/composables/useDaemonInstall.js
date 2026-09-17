// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * How to install `agentrqd` on a machine.
 *
 * The enrolment panel used to show only the enrol command — which you can only
 * run once the daemon is already there. That left the one question somebody
 * asks at exactly that moment unanswered: where do I get this?
 *
 * The important thing here is what the detected platform is *for*. You are
 * usually setting up a machine other than the one you are browsing from — a
 * build box, a server, a spare laptop — so the browser's OS picks the tab that
 * opens, and never which instructions exist. All three stay reachable.
 */

/** Where the daemon's releases live. */
export const RELEASES_URL = 'https://github.com/agentrq/agentrq/releases/latest'

/** The hosted installer, for the platforms that can run a shell script. */
export const INSTALLER_URL = 'https://agentrq.com/install-agentrqd.sh'

/** The user-facing guide, which carries the trust model. */
export const DAEMON_DOCS_URL = 'https://agentrq.com/docs/daemon'

/** The platforms the daemon ships for. */
export const PLATFORMS = ['linux', 'macos', 'windows']

/**
 * Which platform's instructions to open with.
 *
 * A guess, and treated as one: it selects a tab and nothing more. Unknown
 * agents fall back to Linux, because a machine somebody runs agents on
 * unattended is more often Linux than anything else.
 */
export function detectPlatform(userAgent = '') {
  const ua = String(userAgent).toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  return 'linux'
}

/** The label a tab shows. */
export function platformLabel(platform) {
  return { linux: 'Linux', macos: 'macOS', windows: 'Windows' }[platform] ?? 'Linux'
}

/**
 * The command that puts the binary on a machine's PATH.
 *
 * One line on Linux and macOS, matching the desktop app's installer. It works
 * out the right build, checks it against the SHA-256 checksums published with
 * the release — mandatorily, with no flag to skip — and installs to
 * `~/.local/bin` or `/usr/local/bin`. It installs only: it does not enrol,
 * start anything, or run as root.
 *
 * This panel used to refuse the pipe and print `tar` and `install` instead, on
 * the grounds that piping unseen code into a shell is worst on the machine you
 * are about to grant command access to. That argument is still worth knowing,
 * and it lost to two things: the manual steps verified nothing at all, and an
 * install nobody completes protects nobody. The script is the shortest path
 * *and* the only one that checks what it downloaded. Somebody who wants to
 * read it first is a step away — `docs/DAEMON.md`, linked from this step,
 * shows the fetch-read-run form.
 *
 * Windows has no `sh`, so it keeps the manual route. It also has no user
 * directory that is already on PATH, so the step that claims to put it on PATH
 * has to actually do that — unpacking into %LOCALAPPDATA% and saying nothing
 * more would leave somebody with a binary they cannot run by name and a step
 * that lied about what it did.
 */
export function installSteps(platform) {
  switch (platform) {
    case 'windows':
      return [
        'Expand-Archive agentrqd_*_windows_*.zip -DestinationPath $env:LOCALAPPDATA\\agentrqd',
        '# add it to PATH for future shells:',
        '[Environment]::SetEnvironmentVariable("Path",',
        '  "$env:Path;$env:LOCALAPPDATA\\agentrqd", "User")',
      ]
    default:
      return [`curl -fsSL ${INSTALLER_URL} | sh`]
  }
}

/** Whether this platform installs with the script rather than by hand. */
export function usesInstaller(platform) {
  return platform !== 'windows'
}

/**
 * Running it, and keeping it running.
 *
 * `agentrqd serve` is the same everywhere, so it is the first line everywhere.
 * What differs is how you make it survive a logout, and that is worth saying
 * because nothing otherwise tells you the unit files exist.
 *
 * Where they are depends on how it was installed: the script saves them beside
 * the daemon's own config, and a manual install leaves them in the archive.
 * Naming the archive on a platform that installs with the script would point
 * somebody at a file they never downloaded.
 *
 * Both are user-level: a systemd **user** unit and a **LaunchAgent**, not a
 * system service and not a LaunchDaemon. The daemon refuses to run as root, so
 * an instruction that reached for sudo here would be telling somebody to work
 * around the only thing keeping an agent to what they can do themselves.
 */
export function runSteps(platform) {
  switch (platform) {
    case 'macos':
      return [
        'agentrqd serve',
        '# or, to keep it running: copy com.agentrq.agentrqd.plist from',
        '# ~/Library/Application Support/agentrqd into ~/Library/LaunchAgents',
        '# and load it',
      ]
    case 'windows':
      return ['agentrqd serve']
    default:
      return [
        'agentrqd serve',
        '# or, to keep it running: copy agentrqd.service from ~/.config/agentrqd',
        '# into ~/.config/systemd/user and enable it',
      ]
  }
}

/**
 * The whole panel's content for one platform.
 *
 * Assembled here rather than in the template so the ordering — install, enrol,
 * run — is a decision with a test on it rather than the order somebody
 * happened to write the markup in. Getting it wrong prints an enrol command
 * for a binary that is not there yet, which is the bug this replaces.
 */
export function installGuide(platform, enrolCommand) {
  // The installer collapses "download" and "put it on your PATH" into one
  // step, because it does both. Windows has no `sh`, so it keeps the two.
  const install = usesInstaller(platform)
    ? [{ title: 'Install it', lines: installSteps(platform), link: DAEMON_DOCS_URL }]
    : [
        { title: 'Download it', lines: [], link: RELEASES_URL },
        { title: 'Put it on your PATH', lines: installSteps(platform) },
      ]

  return {
    platform,
    label: platformLabel(platform),
    steps: [
      ...install,
      { title: 'Enrol this machine', lines: enrolCommand ? [enrolCommand] : [] },
      { title: 'Run it', lines: runSteps(platform) },
    ],
  }
}
