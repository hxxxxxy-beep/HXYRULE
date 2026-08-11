# Acceptance

## Core

- [ ] Download of 2–3 videos (up to **6** concurrent): files named `{seq}——{title}——{videoId}.mp4` under `/Volumes/External/HXYRULE`, Chrome download history kept.
- [ ] Mid-queue **Stop** cancels active Chrome downloads and remaining jobs; progress `(a/b)` stays on **Download** / **+ Download** (not Stop); **+ Download** grows the same session total (e.g. `0/3` then `+1` → `0/4`); no false interrupted failure toast.
- [ ] **Select pages** over a 3–8 range; selection survives pagination and page refresh inside the same list, but clears when entering a different Favorites/playlist entry (Favorites ↔ playlist, or playlist ↔ playlist). Mid-range **Clear** stops collection (label drops; selection stays empty).
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

## Filters & indexes (0.1.75)

- [ ] Toolbar rails: **Command** (brand / Scan / Queue / Index / Edit / status) → **Match** → **View** (with Compact sort) → **Select** (with **Reset all**) → **Nav** (Pages / Jump). Brand or **F** collapses Match/View/Select. Match / View / Select / collapse / Compact sort persist across refresh (per Favorites or playlist entry).
- [ ] **Reset all** restores Match + View + Select defaults (Compact View) and clears selection.
- [ ] Index idle label is **Build index** when empty, **Rebuild index** when the list already has an index (confirm dialog; full crawl escape hatch). No Refresh from–to inputs.
- [ ] Native site heart (add/remove favourite AJAX) patches the Favorites or playlist index automatically (same as extension Edit). After a sex baseline exists, small adds auto-tag Futa/Straight via filtered page 1; larger batches start a visible sex-delta job (or status says incomplete → **Retag sex**).

- [ ] **Local / Not local** dual toggles after Scan (both on = all; Local only / Not local only work).
- [ ] **Futa / Straight** dual toggles align with the site top sex filter (`category_group_id` 15 / 2109). Both on = no sex restriction; Futa only / Straight only need **Build index** then one **Tag sex** baseline (later membership changes auto-sync sex; **Retag sex** remains the escape hatch). Progress may show `Tagging (Futa · pN)` or delta.
- [ ] **Show matches** with Local/Not local auto-Scans only when never scanned or disk dirty; list index auto page-1 merges when empty, dirty, or count drifts (no per-favorite background sync; no manual Refresh).
- [ ] **Compact matches** is the default View on load / **Reset all**. With default Match (all chips on) it lists the full index as full selectable cards (sortable: Favorites default Favorited↓; playlist default Seq↓; fields Favorites = Favorited / Uploaded / Duration / Views / Rating; playlist = Seq / Uploaded / Duration / Views / Rating — Seq = Favorites renumber ordinal; no Favorited; active sort button shows ↓/↑ and toggles on re-click; Uploaded = site post_date via video id, not list-import time), paged like the native list size; match pager replaces native controls in toolbar **Pages** (Prev / numbers / Next); Jump page targets compact pages while Compact is on; **Show all** restores the native list with the native pager in toolbar **Pages** (not under the card grid); toolbar This page / All matches / download still work on compact cards. Build index once so views/rating/upload time and Futa/Straight groups are stored for off-page cards. Rebuild with Compact selected keeps Compact highlighted immediately (View buttons disabled while Compacting…); does not flash Show all behind a long Scan, then jump.
- [ ] Playlist page: **Favorited / Unfavorited** builds the Favorites index automatically on Show matches if missing or dirty (or use Build/Rebuild on My Favorites).
- [ ] After Compact / Show matches, changing Match chips or Reset refreshes that View in place (does not drop to Show all); Edit/download store changes still clear View; **All matches** follows the active View.
- [ ] Unfavorite / Remove / Add to Favorites / Add to playlist / native heart patch indexes (or mark dirty so the next Show matches merges).
- [ ] SPA switch Favorites ↔ playlist (or playlist A → B) resets Match rules / View.
- [ ] Favorites page: **In playlist / Not in playlist** requires **every** playlist indexed; missing ones are listed and the filter refuses to run.
- [ ] **Prune local** appears on Favorites only (not on playlist pages) and refreshes Favorites index when dirty/drifted before orphan compare.
- [ ] Apply without index shows a clear English error asking to Build first; Futa/Straight without sex groups asks to click **Tag sex**; incomplete untagged rows ask to click **Retag sex**.
- [ ] Index/Renumber/Tag buttons show progress (`Indexing 3/100` or `Tagging (Futa · pN)`) and keep final counts (`Rebuild index (100/100)` or `Build index (100/100)`). Sex idle label is **Tag sex** with no baseline, **Retag sex** once any sex labels exist.
- [ ] **Build/Rebuild index** and **Renumber** keep running across page refresh (background jobs); only their own **Stop** cancels; after reload UI stays grey with `(a/b)`; Stop labels have no counts; after Stop the action button drops `(a/b)`.
- [ ] Build/Rebuild index and Renumber soft-mutex each other (the idle button greys out while the other runs): both crawl site lists / Favorites; Renumber also renames library files — run one after the other.
- [ ] **Renumber** appears on Favorites only (global ordinals). Playlist pages show Build/Rebuild index without Renumber.

## Playlist page layout & moves

- [ ] Native title shows centered `NAME` (no `My Playlist` prefix, no video count) as a clickable pill with **8px** inset above and below; brand count chip sits on the **left** of that row (`NAME : N videos` or `My Favorites (N)` — no playlist id in parentheses); **Libraries** sits on the **right** and opens the library switcher; only the center `NAME` pill follows the native playlist-name link (padded row outside the pill does not navigate).
- [ ] Favorites page: the same chrome row above Command with brand `My Favorites (N)` on the **left** and **Libraries** on the **right** (no centered `NAME`); native header My Favorites stays hidden.
- [ ] Toolbar rails: Command → Match → View → Select → Nav; brand/**F** collapses Command (Scan local) + Match/View/Select.
- [ ] Modal options: `TITLE: N videos` (no playlist id); buttons **Move (keep favorites)** and **Move (remove from favorites)** work; reject id `0`.
- [ ] Playlist page shows **Add to Favorites** between Add to playlist and **Remove from list** (not Unfavorite) in **Edit**.
