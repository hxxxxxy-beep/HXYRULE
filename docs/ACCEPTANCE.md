# Acceptance

## Core

- [ ] Download of 2–3 videos (up to **6** concurrent): files named `{seq}——{title}——{videoId}.mp4` under `/Volumes/External/HXYRULE`, Chrome download history kept.
- [ ] Mid-queue **Stop** cancels active Chrome downloads and remaining jobs; progress `(a/b)` stays on **Download** / **+ Download** (not Stop); **+ Download** grows the same session total (e.g. `0/3` then `+1` → `0/4`); no false interrupted failure toast.
- [ ] **Select pages** over a 3–8 range; selection survives pagination inside the same list, but clears when entering Favorites, entering a playlist, or switching playlists. Mid-range **Clear** stops collection (label drops; selection stays empty).
- [ ] Local file: click → IINA; ⌘-click → web; path click → Finder. Path color sage green, not error-red.
- [ ] Refresh/pagination does not flash native round checkboxes.
- [ ] Favorites card vertical spacing stays tight (~4px bottom padding override); do not regress favorites row gaps.
- [ ] Up to six active downloads at a time; seventh waits until a slot frees after import completes.
- [ ] Reload the extension background (or let MV3 suspend it) mid-download: in-progress jobs reconnect, completed jobs import, and pending jobs continue automatically.
- [ ] With a long queue, leave fewer than 6 active downloads while pending/failed rows remain: after about 12 seconds the page watchdog wakes/retries the queue without reloading the page (30-second cooldown; max three failure recoveries per page load).
- [ ] **Wake queue** repairs/retries/refills immediately without a page reload and without using Chrome Resume; the resulting filename retains its ordinal.
- [ ] **Tasks** opens a download-queue dialog: lists active items, Select all / Clear / Delete, Pause / Resume; Pause/Resume require a selection and only affect selected downloading/paused rows (queued selection keeps Pause disabled; other in-flight rows keep running; freed slots stay claimable); drag-reorder pending behind in-flight/paused; deleting a live item cancels only that Chrome download.
- [ ] Force a network/proxy failure, switch to a working node, then reload Favorites/playlist: failed items return to pending once and downloads resume without reselecting.
- [ ] Download does **not** clear the current selection.
- [ ] **Select pages** end page matches real pagination (no next-arrow off-by-one, e.g. 218 not 219).
- [ ] Helper rejects wrong Origin/token; path escape tests pass (`python3 -m unittest discover -s tests -v`).

## Filters & indexes (0.1.66)

- [ ] **Local / Not local** dual toggles after Scan (both on = all; Local only / Not local only work).
- [ ] **Show matches** with Local/Not local auto-Scans only when never scanned or disk dirty; list index auto-refreshes when empty, dirty, or count drifts (no per-favorite background sync).
- [ ] **Compact matches** hides non-matches and shows only matches in favorites/index order as full selectable cards (same pick-rail fields as Favorites: title, views, rating, added time, local path; thumb + duration; stable thumb size across pages), paged like the native list size; match pager under the grid has Prev/Next only (no “Matches X–Y of Z”; toolbar native pager dimmed/inert); **Show all** / **Reset match** restores the native list; toolbar This page / All matches / download still work on compact cards. Refresh index once so views/rating/added are stored for off-page cards.
- [ ] Playlist page: **Favorited / Unfavorited** builds the Favorites index automatically on Show matches if missing or dirty (or use Build/Refresh on My Favorites).
- [ ] After Show matches, changing Match chips clears View; Edit/download store changes also clear View; **All matches** follows the frozen View when active (not stale chip edits).
- [ ] Unfavorite / Remove / Add to Favorites / Add to playlist patch indexes (or mark dirty so the next Show matches refreshes).
- [ ] SPA switch Favorites ↔ playlist (or playlist A → B) resets Match rules / View.
- [ ] Favorites page: **In playlist / Not in playlist** requires **every** playlist indexed; missing ones are listed and the filter refuses to run.
- [ ] **Prune local** appears on Favorites only (not on playlist pages) and refreshes Favorites index when dirty/drifted before orphan compare.
- [ ] Apply without index shows a clear English error asking to Build/Refresh first.
- [ ] Index/Renumber buttons show progress (`Indexing 3/100`) and keep final counts (`Refresh index (100/100)`).
- [ ] **Build/Refresh index** and **Renumber** keep running across page refresh (background jobs); only their own **Stop** cancels; after reload UI stays grey with `(a/b)`; Stop labels have no counts; after Stop the action button drops `(a/b)`.
- [ ] Build/Refresh index and Renumber soft-mutex each other (the idle button greys out while the other runs): both crawl site lists / Favorites; Renumber also renames library files — run one after the other.
- [ ] **Renumber** appears on Favorites only (global ordinals). Playlist pages show Build/Refresh index without Renumber.

## Playlist page layout & moves

- [ ] Native title `My Playlist NAME (n)` is clickable and sits above Match (~1px gap) inside the fixed toolbar.
- [ ] Toolbar stays compact: Match/View/Select → Sync/Queue/Index/Edit → Jump/Pages/status; row gaps ≈ 4px (not ~20px).
- [ ] Collection chip (Act row left): `NAME (id) : N videos`.
- [ ] Modal options: `TITLE (id): N videos`; buttons **Move (keep favorites)** and **Move (remove from favorites)** work; reject id `0`.
- [ ] Playlist page shows **Add to Favorites** between Add to playlist and **Remove from list** (not Unfavorite) in **Edit**.
