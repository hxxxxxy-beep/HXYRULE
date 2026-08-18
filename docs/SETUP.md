# HXYRULE — New Mac setup (for AI)

**Repo:** https://github.com/hxxxxxy-beep/HXYRULE (private)  
**Primary brief:** [AGENTS.md](../AGENTS.md) (prefer that file when the owner only sends the repo URL).  
**Goal:** Install and pair HXYRULE so Rule34Video favorites and playlists match this machine's behavior: local scan, queued download (concurrency 6), IINA local-first play, filters, indexes, playlist moves.

This document is enough to deploy without prior chat history. Read `README.md` for product details; follow this file (or `AGENTS.md`) for install order.

## What this is

- Chrome MV3 unpacked extension (`extension/`, version **0.1.85**)
- macOS LaunchAgent Helper (`mac-helper/`, `127.0.0.1:17934`)
- Optional: `source-han-force/` (Source Han Serif on all pages; not required — see its README)
- Personal enhancer only — does **not** change Rule34Video servers
- Cookies stay in Chrome; absolute paths never leave the machine
- Do **not** modify any local `.ref-*`, `.tools/`, or `.ssh-deploy/` trees if present

## Required config (typical)

| Item | Value |
|------|--------|
| Video root | `/Volumes/External/HXYRULE` (must be mounted & writable) |
| Helper | `com.hxyrule.mac-helper` on `127.0.0.1:17934` |
| Player | `iina` (install via `brew install --cask iina` if missing) |
| Pairing file | `~/Library/Application Support/HXYRULE/extension-config.json` |
| GitHub / outbound proxy (if needed) | `http://127.0.0.1:7897` for git/`gh` only — never point Helper at it |

Extension ID is assigned when you load the unpacked extension (32 chars, `a–p` only). Always use the ID from `chrome://extensions` on **this** Mac — do not reuse an ID from another machine.

## Deploy steps (do in order)

1. Clone the repo to a local path (example: `~/Desktop/HXYRULE` or `~/Desktop/A`).

```bash
git clone https://github.com/hxxxxxy-beep/HXYRULE.git
cd HXYRULE
```

2. Ensure the video volume exists:

```bash
mkdir -p /Volumes/External/HXYRULE
# If External is a real disk, mount it first in Finder / Disk Utility.
```

3. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - **Load unpacked** → select the `extension/` folder
   - Copy the **Extension ID**

4. Install the Helper and run tests (replace `EXTENSION_ID`):

```bash
chmod +x scripts/deploy-mac.sh mac-helper/install.sh mac-helper/uninstall.sh
./scripts/deploy-mac.sh --extension-id EXTENSION_ID
```

Expect all unit tests OK (currently 44).

5. Pair the extension:
   - Open the extension **Options** page
   - Import `~/Library/Application Support/HXYRULE/extension-config.json`
   - Click **Check Helper** — expect healthy / OK

6. macOS permissions: if Scan returns `0` while files exist, grant Python access to **Removable Volumes** (System Settings → Privacy & Security → Files and Folders).

7. Smoke-test in Chrome (hard-refresh after load):
   - Favorites: `https://rule34video.com/my/favourites/videos/`
   - Playlist: `https://rule34video.com/my/playlists/{id}/`
   - Disable Pagetual infinite scroll on these pages

### Smoke checklist

1. **Select pages** across a page range; selection survives pagination and page refresh in that list, and clears when switching Favorites ↔ playlist or playlist ↔ playlist.
2. **Scan local** (or Show matches with Local — auto-scans if needed) → **Local / Not local** filter works. After **Build index** and one **Tag sex** (detail-page `futanari` tag → Futa, else Straight), Match chips **Futa / Straight** work; later hearts / Edit adds auto-tag sex when a baseline exists.
3. Collection filters: playlist page **Unfavorited** only; favorites page **Not in playlist** only (Build indexes first; Show matches merges dirty/drifted list indexes).
4. **Download** several videos (concurrency up to 6); **Stop** mid-queue.
5. Local thumb → IINA; ⌘-click → web; path → Finder.
6. Playlist: clickable native title above Match (~1px); compact ~4px row gaps; Sync · Queue · Index · Edit groups.
7. Collection chip looks like `NAME : N videos` (no playlist id).
8. **Add to playlist** modal: `TITLE: N videos` (no playlist id); **Move (keep favorites)** / **Move (remove from favorites)**.

## Daily ops

Reload extension after code changes: `chrome://extensions` → Reload → hard-refresh the site tab.

Helper hot-reload after editing `mac-helper/hxyrule_mac_helper.py`:

```bash
cp mac-helper/hxyrule_mac_helper.py "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
chmod 755 "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
launchctl kickstart -k "gui/$(id -u)/com.hxyrule.mac-helper"
```

Log: `~/Library/Logs/HXYRULEHelper.log`

Uninstall Helper (keeps video files):

```bash
./mac-helper/uninstall.sh
```

## Key symbols (when debugging)

| Area | Symbols / files |
|------|-----------------|
| UI / filters / playlist | `extension/content/favorites.js` — `ensureControls`, `collectionFilterLabels`, `videoMatchesFilters`, `applyLibraryFilter`, `ensurePlaylistMembershipSet`, `placePlaylistNativeTitle`, `formatPlaylistJumpLabel`, `formatPlaylistOptionLabel`, `showPlaylistModal`, `layoutTopControls` |
| Styles | `extension/content/favorites.css` — `.hxyrule-topstack--playlist`, `.hxyrule-playlist-native-title`, `.hxyrule-act-pipeline`, `.hxyrule-jumprow`, `.hxyrule-msgbar` |
| Background | `PLAYLIST_MEMBERSHIP_GET`, `getPlaylistMembership`, `SITE_PLAYLIST_*`, `FETCH_PLAYLIST_PAGE` |
| Helper | `mac-helper/hxyrule_mac_helper.py` — scan, import, open, ordinals |

## Hard rules (do not violate)

- Do not raise download concurrency above **6**.
- Do not allow open / reveal / import outside the realpath-locked video root.
- Do not send cookies or absolute paths to third parties.
- Do not bypass login / CAPTCHA / DRM.
- Do not commit secrets (pairing tokens, `.env`, credentials).
- Do not change site favorites via undocumented hacks beyond the documented Move flows.
- Commit / push only when the owner explicitly asks.

## If something fails

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Common fixes: remount volume, re-import pairing JSON, `launchctl kickstart` the Helper, reload the extension, stay logged in on the site.
