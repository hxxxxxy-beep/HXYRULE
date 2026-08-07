#!/bin/sh
set -eu

usage() {
    cat <<'EOF'
Usage:
  ./mac-helper/install.sh --extension-id ID [--video-dir DIR] [--player iina|vlc|system] [--port PORT]

Examples:
  ./mac-helper/install.sh --extension-id abcdefghijklmnopabcdefghijklmnop
  ./mac-helper/install.sh --extension-id abcdefghijklmnopabcdefghijklmnop --video-dir /Volumes/External/HXYRULE
EOF
}

EXTENSION_ID=""
VIDEO_DIR="/Volumes/External/HXYRULE"
PLAYER="iina"
PORT="17934"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --extension-id)
            EXTENSION_ID="${2:-}"
            shift 2
            ;;
        --video-dir)
            VIDEO_DIR="${2:-}"
            shift 2
            ;;
        --player)
            PLAYER="${2:-}"
            shift 2
            ;;
        --port)
            PORT="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf 'Unknown argument: %s\n' "$1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

case "$EXTENSION_ID" in
    [a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p])
        ;;
    *)
        printf '%s\n' '--extension-id must be a 32-char Chrome extension id (a-p only)' >&2
        exit 2
        ;;
esac

case "$PLAYER" in
    iina|vlc|system) ;;
    *)
        printf '%s\n' '--player must be iina, vlc, or system' >&2
        exit 2
        ;;
esac

PYTHON_BIN="$(command -v python3 || true)"
if [ -z "$PYTHON_BIN" ]; then
    printf '%s\n' 'Python 3 is required.' >&2
    exit 1
fi

ORIGIN="chrome-extension://${EXTENSION_ID}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
APP_DIR="$HOME/Library/Application Support/HXYRULE"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"
HELPER_PATH="$APP_DIR/hxyrule_mac_helper.py"
TOKEN_PATH="$APP_DIR/pairing.token"
PLIST_PATH="$LAUNCH_AGENTS_DIR/com.hxyrule.mac-helper.plist"
LOG_PATH="$LOG_DIR/HXYRULEHelper.log"
EXT_CONFIG_PATH="$APP_DIR/extension-config.json"
LABEL="com.hxyrule.mac-helper"
GUI_DOMAIN="gui/$(id -u)"

mkdir -p "$APP_DIR" "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
# Video dir may be on an unmounted volume; do not fail install.
mkdir -p "$VIDEO_DIR" 2>/dev/null || true

install -m 755 "$SCRIPT_DIR/hxyrule_mac_helper.py" "$HELPER_PATH"

if [ ! -f "$TOKEN_PATH" ]; then
    "$PYTHON_BIN" - <<PY
import secrets
from pathlib import Path
p = Path("$TOKEN_PATH")
p.write_text(secrets.token_urlsafe(32) + "\n", encoding="utf-8")
p.chmod(0o600)
PY
fi

TOKEN="$(tr -d '\n' < "$TOKEN_PATH")"

"$PYTHON_BIN" - "$EXT_CONFIG_PATH" "$ORIGIN" "$TOKEN" "$PORT" "$VIDEO_DIR" "$PLAYER" <<'PY'
import json, sys
path, origin, token, port, video_dir, player = sys.argv[1:]
payload = {
    "origin": origin,
    "token": token,
    "port": int(port),
    "helperBase": f"http://127.0.0.1:{port}",
    "videoDir": video_dir,
    "player": player,
}
with open(path, "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2)
    fh.write("\n")
PY

"$PYTHON_BIN" - "$PLIST_PATH" "$PYTHON_BIN" "$HELPER_PATH" "$VIDEO_DIR" "$ORIGIN" "$PORT" "$PLAYER" "$APP_DIR" "$TOKEN_PATH" "$LOG_PATH" <<'PY'
import plistlib, sys
(
    plist_path, python_bin, helper_path, video_dir, origin, port, player,
    support_dir, token_file, log_path,
) = sys.argv[1:]
payload = {
    "Label": "com.hxyrule.mac-helper",
    "ProgramArguments": [
        python_bin, "-u", helper_path,
        "--video-dir", video_dir,
        "--origin", origin,
        "--port", port,
        "--player", player,
        "--support-dir", support_dir,
        "--token-file", token_file,
    ],
    "RunAtLoad": True,
    "KeepAlive": True,
    "StandardOutPath": log_path,
    "StandardErrorPath": log_path,
}
with open(plist_path, "wb") as handle:
    plistlib.dump(payload, handle, sort_keys=False)
PY

plutil -lint "$PLIST_PATH" >/dev/null
launchctl bootout "$GUI_DOMAIN" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "$GUI_DOMAIN" "$PLIST_PATH"

sleep 1
# Health requires Origin+token; just check TCP listen via python
"$PYTHON_BIN" - <<PY
import socket, sys
s = socket.socket()
s.settimeout(2)
try:
    s.connect(("127.0.0.1", int("$PORT")))
except OSError:
    print("HXYRULE Mac Helper did not open port $PORT. Check $LOG_PATH", file=sys.stderr)
    sys.exit(1)
finally:
    s.close()
PY

printf 'HXYRULE Mac Helper installed and running.\n'
printf 'Port: %s\n' "$PORT"
printf 'Video directory: %s\n' "$VIDEO_DIR"
printf 'Allowed origin: %s\n' "$ORIGIN"
printf 'Pairing config: %s\n' "$EXT_CONFIG_PATH"
printf 'Log: %s\n' "$LOG_PATH"
printf '\nNext:\n'
printf '1. Chrome → Extensions → Load unpacked → select the extension/ folder\n'
printf '2. Copy the extension ID into this installer if you reinstall\n'
printf '3. Open the extension Options page and Import Helper pairing config\n'
printf '   (or paste token from %s)\n' "$EXT_CONFIG_PATH"
