# Troubleshooting

## Helper offline

```bash
tail -f ~/Library/Logs/HXYRULEHelper.log
launchctl print "gui/$(id -u)/com.hxyrule.mac-helper"
./mac-helper/uninstall.sh && ./mac-helper/install.sh --extension-id YOUR_ID \
  --video-dir /Volumes/External/HXYRULE --player iina
```

Re-import `~/Library/Application Support/HXYRULE/extension-config.json`.

## Scan is 0

- Mount `/Volumes/External/HXYRULE`.
- System Settings → Privacy & Security → Files and Folders: allow Python access to Removable Volumes.
- Filenames must include the video ID: preferred `{seq}——{title}——{videoId}.mp4`; legacy `{videoId}__title.mp4` still matches.

## Download fails

- Stay logged in. On CAPTCHA/rate-limit, stop; do not retry in a loop.
- Chrome stages to `~/Downloads/HXYRULE/`; Helper moves into the video root.
- Queue pauses on failure. Reload Favorites/playlist after fixing the network to retry failed items once; ordinary four-second status refreshes do not retry immediately.
- While a Favorites/playlist page remains open, the refill watchdog heals a stalled queue when fewer than 6 downloads remain active and pending/failed work still exists. It waits for three polls (about 12 seconds), uses a 30-second cooldown, and retries failures at most three times per page load.
- **Wake queue** performs the same repair/retry/refill flow immediately without reloading the webpage. HXYRULE creates a fresh Chrome download and filename; do not use Chrome's manual Resume for interrupted rows.
- If Chrome suspends/restarts the MV3 background, the queue reconciles persisted `downloading` rows on the completion event, status refresh, startup, or the one-minute alarm.

## Local play silent

- Install IINA or rely on system default. Scan first; path must show. ⌘-click always opens the web page.

## Select pages interrupted

- Login loss, CAPTCHA, or DOM change pauses collection. Selection is kept. Disable Pagetual infinite scroll on favorites / playlist pages.

## Filters empty or wrong

- **Show matches** refreshes disk/index only when missing, dirty after Edit, or list count drifts — native hearts and extension Edit patch indexes without Rebuild. Use **Scan local** if you changed files outside Download/Prune.
- On a playlist page, **Favorited / Unfavorited** builds/refreshes the Favorites index on Show matches if missing or dirty (or Build/Rebuild on My Favorites). Playlist **Build index** only indexes that playlist.
- Changing Match chips or Reset after Compact / Show matches refreshes that View in place. Edit/download that changes stores still clears View — click Compact / Show matches again.
- Run **Build index** on **every** site playlist before In playlist / Not in playlist on Favorites — incomplete indexes block the filter and list the missing playlists. After Edit or native heart, indexes are patched when possible; if a playlist was never indexed, Build it then retry. Use **Rebuild index** only when the snapshot drifted from another device or a missed hook.
- **Prune local** is Favorites-only (compares disk to the Favorites index) and refreshes that index first when dirty or drifted.

## Playlist spacing / toolbar height

- Confirm topstack child order: native title (playlist) → controls → jumprow (Jump · Pages · status).
- Row gaps stay ~4px; do not reintroduce tall spacers or a separate pagination→Jump gap node.

## Playlist move looks successful but list unchanged

- KVS `get_block` can report false success. Open the target playlist page to verify.
- Ensure `delete[]` is present for move-out; never target playlist id `0`.
