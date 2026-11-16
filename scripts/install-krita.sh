#!/usr/bin/env bash
# Install Krita for scripted brushwork (the krita-brushwork skill) into /opt/krita, with the script runner
# plugin enabled. A cloud session runs this on demand (about a minute, 380 MB download), not at session start.
# The AppImage is extracted, not mounted: a container has no FUSE.
#
# Usage: scripts/install-krita.sh   (prints the runner's path, tools/krita/run.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
KRITA_VERSION="5.3.4.1"   # pinned (Fleet Command build.config)

BIN=/opt/krita/usr/bin/krita
if [[ ! -x "$BIN" ]] || ! grep -qx "$KRITA_VERSION" /opt/krita/.version 2>/dev/null; then
  tmp="$(mktemp -d)"
  curl -sSL --fail --retry 3 -o "$tmp/krita.AppImage" \
    "https://download.kde.org/stable/krita/$KRITA_VERSION/krita-$KRITA_VERSION-x86_64.AppImage"
  chmod +x "$tmp/krita.AppImage"
  (cd "$tmp" && ./krita.AppImage --appimage-extract >/dev/null)
  rm -rf /opt/krita
  mv "$tmp/squashfs-root" /opt/krita
  echo "$KRITA_VERSION" > /opt/krita/.version
  rm -rf "$tmp"
fi
if ! command -v xvfb-run >/dev/null 2>&1; then
  (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb) >/dev/null 2>&1 || true
fi

# The runner plugin, enabled in kritarc's [python] section.
plugins="$HOME/.local/share/krita/pykrita"
mkdir -p "$plugins" "$HOME/.config"
rm -rf "$plugins/fc_runner"
cp -r tools/krita/pykrita/fc_runner tools/krita/pykrita/fc_runner.desktop "$plugins/"
if ! grep -q '^enable_fc_runner=true' "$HOME/.config/kritarc" 2>/dev/null; then
  printf '\n[python]\nenable_fc_runner=true\n' >> "$HOME/.config/kritarc"
fi
cat /opt/krita/.version >&2
echo "$PWD/tools/krita/run.sh"
