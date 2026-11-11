#!/usr/bin/env bash
# Installs a macOS LaunchAgent that refreshes and publishes the profile every Monday at 09:00.
# If the Mac is asleep then, launchd runs it at the next wake. Logs go to ~/Library/Logs/flexchar-profile.log.
#   scripts/install-launchd.sh             install or reinstall
#   scripts/install-launchd.sh --uninstall remove it
set -euo pipefail

label="com.flexchar.profile"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"

launchctl bootout "$domain/$label" 2>/dev/null || true
if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$plist"
  echo "Removed $label"
  exit 0
fi

repo="$(cd "$(dirname "$0")/.." && pwd)"
bun="$(command -v bun)" || { echo "bun not found on PATH" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh not found on PATH" >&2; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# launchd starts jobs with a bare PATH, so keep the current one to find gh and git.
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$bun</string><string>run</string><string>scripts/profile.ts</string><string>--publish</string>
  </array>
  <key>WorkingDirectory</key><string>$repo</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/flexchar-profile.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/flexchar-profile.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "$domain" "$plist"
echo "Installed $label. Run it now with: launchctl kickstart $domain/$label"
