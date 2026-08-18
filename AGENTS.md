# AGENTS.md — Deploy HXYRULE on a new Mac

You are an AI given **only** this repository URL. No prior chat history is required: clone (or `git pull --ff-only`), follow this file top to bottom, and deliver a working HXYRULE (extension loaded, Helper paired, smoke green).

**Repo:** https://github.com/hxxxxxy-beep/HXYRULE  
**Product version:** extension `0.1.85`  
**Language:** English only in source, names, comments, docs, and UI strings you add.

## Mission (success criteria)

1. Clone / update the repo.
2. Load `extension/` unpacked in Chrome and capture the Extension ID.
3. Install the macOS Helper via `scripts/deploy-mac.sh` (or `mac-helper/install.sh`).
4. Pair Options with `extension-config.json` and confirm Helper health.
5. Smoke Favorites + one playlist page per [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

Humans may also use [docs/SETUP.md](docs/SETUP.md). Prefer this file when the owner only sends the repo URL.

## Repo layout (product only)

| Path | Role |
|------|------|
| `extension/` | Chrome MV3 unpacked extension (load this folder) |
| `mac-helper/` | LaunchAgent Helper on `127.0.0.1:17934` |
| `scripts/deploy-mac.sh` | Helper install + unit tests |
| `tests/` | Helper security / ordinals / queue tests (44) |
| `docs/` | SETUP, SECURITY, TROUBLESHOOTING, ACCEPTANCE |
| `source-han-force/` | Optional separate font extension (not required) |

Do **not** touch or commit local-only trees if present: `.ref-*`, `.tools/`, `.ssh-deploy/`, `.proxyenv`. They are not part of the product.

## Prerequisites

| Need | Notes |
|------|--------|
| macOS + Chrome | Developer mode for unpacked extensions |
| `python3` | stdlib only; no `pip install` for Helper |
| GitHub auth | Repo may be private — use signed-in `gh` / git credentials |
| Video volume | Default `/Volumes/External/HXYRULE` mounted and writable |
| IINA (recommended) | `brew install --cask iina` or rely on system player |
| Outbound proxy (optional) | If GitHub is blocked, use `http://127.0.0.1:7897` for git/`gh` only — never for Helper loopback |

**Human-required steps:** Chrome “Load unpacked”, Options import / Check Helper, site login, and granting Python **Removable Volumes** if Scan is blocked. Everything else is scriptable.

## Defaults

| Item | Value |
|------|--------|
| Video root | `/Volumes/External/HXYRULE` |
| Helper | `com.hxyrule.mac-helper` @ `127.0.0.1:17934` |
| Player | IINA (`iina`) |
| Download concurrency | **6** (never raise) |
| Pairing file | `~/Library/Application Support/HXYRULE/extension-config.json` |
| Filename | `{seq}——{sanitizedTitle}——{videoId}.mp4` (legacy `{id}__…` still scans) |

## Deploy (exact order)

1. Clone (or pull) and enter the repo:

```bash
git clone https://github.com/hxxxxxy-beep/HXYRULE.git
cd HXYRULE
git pull --ff-only
```

If clone fails and a local proxy listens on `7897`:

```bash
export https_proxy=http://127.0.0.1:7897 http_proxy=http://127.0.0.1:7897
export ALL_PROXY=socks5://127.0.0.1:7897
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

Expect **44** tests OK.

5. Extension Options → import `~/Library/Application Support/HXYRULE/extension-config.json` → **Check Helper**.

6. If Scan returns `0` while files exist: System Settings → Privacy & Security → Files and Folders → allow Python **Removable Volumes**.

7. Owner must be logged into Rule34Video. Smoke: open Favorites and a playlist page; disable Pagetual infinite scroll on those pages. See [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

## After code edits

- Extension: Reload at `chrome://extensions`, then hard-refresh the site tab.
- Helper:

```bash
cp mac-helper/hxyrule_mac_helper.py "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
chmod 755 "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
launchctl kickstart -k "gui/$(id -u)/com.hxyrule.mac-helper"
```

Unload Helper (keeps video files): `./mac-helper/uninstall.sh`

## Hard rules

- Personal enhancer only; do not change Rule34Video servers.
- Never send cookies or absolute paths off-machine.
- Path operations stay realpath-locked under the video root.
- No secrets in git (tokens, `.ssh-deploy`, credentials).
- Commit / push only when the owner explicitly asks.
- Prefer [docs/SETUP.md](docs/SETUP.md) and [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) over inventing new install flows.
- Keep the tree English-only and free of dead code / local-only junk.
