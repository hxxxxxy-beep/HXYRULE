# AGENTS.md — Deploy HXYRULE on a new Mac

You are an AI given only this repository. Deploy the latest HXYRULE without prior chat history.

**Repo:** https://github.com/hxxxxxy-beep/HXYRULE  
**Product version:** extension `0.1.59`  
**Language:** English only in docs and UI strings you add.

## What to install

| Piece | Path | Notes |
|-------|------|--------|
| Chrome MV3 extension | `extension/` | Load unpacked |
| macOS Helper | `mac-helper/` | LaunchAgent on `127.0.0.1:17934` |
| Optional font helper | `source-han-force/` | Separate unpacked extension; not required for HXYRULE |

Do **not** touch `.ref-*`, `.tools/`, `.ssh-deploy/`, or `.proxyenv` if present locally. They are not part of the product.

## Defaults

| Item | Value |
|------|--------|
| Video root | `/Volumes/External/HXYRULE` (must exist and be writable) |
| Helper | `com.hxyrule.mac-helper` @ `127.0.0.1:17934` |
| Player | IINA (`iina`) |
| Download concurrency | **6** (never raise) |
| Pairing file | `~/Library/Application Support/HXYRULE/extension-config.json` |

## Deploy (exact order)

1. Clone (if needed) and enter the repo:

```bash
git clone https://github.com/hxxxxxy-beep/HXYRULE.git
cd HXYRULE
git pull --ff-only
```

2. Ensure the video volume is mounted, then:

```bash
mkdir -p /Volumes/External/HXYRULE
```

3. Load `extension/` in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`. Copy the **Extension ID** (32 chars, `a–p` only).

4. Install Helper + run tests (replace `EXTENSION_ID`):

```bash
chmod +x scripts/deploy-mac.sh mac-helper/install.sh mac-helper/uninstall.sh
./scripts/deploy-mac.sh --extension-id EXTENSION_ID
```

Or call install directly:

```bash
./mac-helper/install.sh --extension-id EXTENSION_ID \
  --video-dir /Volumes/External/HXYRULE \
  --player iina
python3 -m unittest discover -s tests -v
```

5. Extension Options → import `~/Library/Application Support/HXYRULE/extension-config.json` → **Check Helper**.

6. If Scan returns `0` while files exist: System Settings → Privacy & Security → Files and Folders → allow Python **Removable Volumes**.

7. Smoke: open Favorites and a playlist page; disable Pagetual infinite scroll on those pages. See [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

## After code edits

- Extension: Reload at `chrome://extensions`, then hard-refresh the site tab.
- Helper:

```bash
cp mac-helper/hxyrule_mac_helper.py "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
chmod 755 "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
launchctl kickstart -k "gui/$(id -u)/com.hxyrule.mac-helper"
```

## Hard rules

- Personal enhancer only; do not change Rule34Video servers.
- Never send cookies or absolute paths off-machine.
- Path operations stay realpath-locked under the video root.
- No secrets in git (tokens, `.ssh-deploy`, credentials).
- Commit / push only when the owner explicitly asks.
- Prefer [docs/SETUP.md](docs/SETUP.md) and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) over inventing new install flows.
