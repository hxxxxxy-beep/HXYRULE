#!/bin/sh
# Automate Helper install + unit tests on a new Mac.
# Chrome "Load unpacked" still needs a one-time manual step to obtain EXTENSION_ID.
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

EXTENSION_ID=""
VIDEO_DIR="/Volumes/External/HXYRULE"
PLAYER="iina"
SKIP_TESTS=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/deploy-mac.sh --extension-id ID [--video-dir DIR] [--player iina|vlc|system] [--skip-tests]

Prereq: load extension/ unpacked in Chrome and copy its Extension ID.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --extension-id) EXTENSION_ID="${2:-}"; shift 2 ;;
    --video-dir) VIDEO_DIR="${2:-}"; shift 2 ;;
    --player) PLAYER="${2:-}"; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$EXTENSION_ID" ]; then
  printf '%s\n' 'Missing --extension-id. Load extension/ in Chrome first.' >&2
  usage >&2
  exit 2
fi

mkdir -p "$VIDEO_DIR" 2>/dev/null || true

chmod +x "$ROOT/mac-helper/install.sh" "$ROOT/mac-helper/uninstall.sh"
"$ROOT/mac-helper/install.sh" \
  --extension-id "$EXTENSION_ID" \
  --video-dir "$VIDEO_DIR" \
  --player "$PLAYER"

if [ "$SKIP_TESTS" -eq 0 ]; then
  python3 -m unittest discover -s tests -v
fi

printf '\nDeploy finished.\n'
printf '1. Options → Import %s\n' "$HOME/Library/Application Support/HXYRULE/extension-config.json"
printf '2. Click Check Helper\n'
printf '3. Open https://rule34video.com/my/favourites/videos/\n'
