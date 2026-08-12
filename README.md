# HXYRULE

Personal Chrome MV3 extension + macOS Helper for [Rule34Video](https://rule34video.com/) favorites and playlists: local scan, local-first playback (IINA), queued downloads (concurrency 6), cross-page selection, filters, indexes, and site playlist moves. Does not change the site server. Cookies and local paths never leave your machine.

**Version:** extension `0.1.80`

## New Mac / new AI

Give the agent **only** this URL and tell it to follow **[AGENTS.md](AGENTS.md)** end-to-end (clone → load extension → deploy Helper → pair → smoke):

```text
https://github.com/hxxxxxy-beep/HXYRULE
```

That file is the full autonomous deploy brief. Humans can also follow [docs/SETUP.md](docs/SETUP.md). If GitHub needs a local proxy, use `127.0.0.1:7897` as described in `AGENTS.md`.

```bash
git clone https://github.com/hxxxxxy-beep/HXYRULE.git
cd HXYRULE
# Load extension/ unpacked in Chrome, copy Extension ID, then:
chmod +x scripts/deploy-mac.sh
./scripts/deploy-mac.sh --extension-id YOUR_EXTENSION_ID
```

Then Options → import `~/Library/Application Support/HXYRULE/extension-config.json` → **Check Helper**.

Unload Helper: `./mac-helper/uninstall.sh` (video files kept).

## Defaults

| Item | Value |
|------|--------|
| Video root | `/Volumes/External/HXYRULE` |
| Helper | `127.0.0.1:17934` (`com.hxyrule.mac-helper`) |
| Player | IINA (else system default) |
| Quality | 1080 → 720 → 480 → 360 |
| Filename | `{seq}——{sanitizedTitle}——{videoId}.mp4` |
| Staging | `~/Downloads/HXYRULE/` → Helper `/downloads/import` |
| Pairing file | `~/Library/Application Support/HXYRULE/extension-config.json` |

Disable Pagetual infinite scroll on favorites / playlist pages.

## Architecture

| Piece | Path | Role |
|-------|------|------|
| Extension | `extension/` | Content UI + background queue, indexes, site fetches, Helper RPC |
| Content UI | `extension/content/favorites.js` + `favorites.css` | Favorites + playlist pages |
| Background | `extension/background.js` | Downloads, indexes, `SITE_*` / `FETCH_*` / `PLAYLIST_MEMBERSHIP_GET` |
| Helper | `mac-helper/hxyrule_mac_helper.py` | Scan / import / IINA / ordinals (path-locked to video root) |
| Deploy script | `scripts/deploy-mac.sh` | Helper install + unit tests |
| Optional | `source-han-force/` | Force Source Han Serif on all pages (separate extension) |
| Tests | `tests/test_helper_core.py` | Helper security + ordinals + download queue |

## UI (favorites and playlist share a 3-row control bar)

1. **Match · View · Select** — dual toggles · Duration · Show matches / Show all · This page · Page range · All matches · Clear
2. **Sync** Scan local · **Queue** Download / Stop / Wake queue / Tasks · **Index** Build / Rebuild · **Renumber** (Favorites only) · **Edit** Add to playlist · Unfavorite / Remove from list · Prune local (Favorites only). Playlist pages also show **Add to Favorites**. **Tasks** opens a live download-queue manager (select / clear, delete, pause/resume selected in-flight or paused rows so the next pending takes freed slots, drag-reorder).

Progress labels keep final counts: `Renumber (100/100)`, `Rebuild index (100/100)`, `Indexing 3/100`.

### Filters (dual toggles; both on = All)

**Local / Not local** (needs Scan): both on = all; Local only = on disk; Not local only = in library, missing on disk; both off = empty. **Show matches** scans only if disk data is missing or dirty.

**Collection filter:**

| Page | Labels | Compared against |
|------|--------|------------------|
| Playlist | **Favorited / Unfavorited** | Favorites index (`hxyruleFavIndex`) |
| Favorites | **In playlist / Not in playlist** | Union of all playlist indexes (`PLAYLIST_MEMBERSHIP_GET`) |

**Match → View → Select:** Show matches freezes View (grays non-matches). **Compact** is the default View: with default Match it lists the full index as full cards (paged; match pager replaces the native bar in toolbar Pages; needs Build index once for thumbnails). Compact sort on Favorites includes **Favorited** (collection order); playlist pages omit it and keep Uploaded / Duration / Views / Rating. Chip edits or Reset refresh Compact / Show matches in place; Edit/download store changes clear View. Native hearts and extension Edit patch indexes automatically; **Rebuild index** is an escape hatch. **All matches** uses the active View; with default Match (both dual-toggles on, no Duration) it selects the full list index. Match / View / Select / collapse / Compact sort are remembered per Favorites or playlist entry across refresh.

### Card behavior

- Thumbnail click → IINA if local; ⌘-click → web.
- Info area click → toggle select (teal border). Native checkboxes / Select all / Delete / Move to playlist are hidden.
- Local path shown only when file exists (sage `#b4e6c8`); click opens Finder.

### Site playlist modal

Option format: `TITLE: N videos` (no playlist id). **Move (keep favorites)** vs **Move (remove from favorites)**. Reject playlist id `0`.

## Site facts

- Video ID: `/video/{id}/{slug}/`; checkbox `input[name="delete[]"]` value.
- Cards: `.item.thumb`; Favorites: `/my/favourites/videos/`; Playlists: `/my/playlists/{id}/`.
- Download URL on detail page is short-lived; resolve immediately. Queue concurrency = **6**.

## Indexes

- Favorites: `hxyruleFavIndex`
- Playlist: `hxyruleIndex:playlist:{id}`
- Membership union: `PLAYLIST_MEMBERSHIP_GET`

## Tests & ops

```bash
python3 -m unittest discover -s tests -v
```

Helper hot-reload:

```bash
cp mac-helper/hxyrule_mac_helper.py "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
chmod 755 "$HOME/Library/Application Support/HXYRULE/hxyrule_mac_helper.py"
launchctl kickstart -k "gui/$(id -u)/com.hxyrule.mac-helper"
```

Log: `~/Library/Logs/HXYRULEHelper.log`

## Docs

- [AGENTS.md](AGENTS.md) — paste-ready deploy brief for a new AI
- [SETUP](docs/SETUP.md)
- [SECURITY](docs/SECURITY.md)
- [TROUBLESHOOTING](docs/TROUBLESHOOTING.md)
- [ACCEPTANCE](docs/ACCEPTANCE.md)

## Principles

- Personal enhancement only; no secrets in git; download concurrency = 6; paths locked to video root.
- Commit / push only when the owner asks.
