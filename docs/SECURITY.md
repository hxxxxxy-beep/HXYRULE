# Security

- Helper binds `127.0.0.1:17934` only. Requires paired `chrome-extension://<id>` Origin and `X-HXYRULE-Token`.
- Cookies stay in the browser. Helper never receives site cookies.
- Downloads use `chrome.downloads`; Helper imports only from `~/Downloads` (or already under the video root) after realpath checks.
- `open` / `reveal` accept `videoId` only; path comes from SQLite index.
- Default root: `/Volumes/External/HXYRULE`. Symlinks escaping the root are not indexed. `videoDir` changes limited to home or `/Volumes/*`.
- No DRM/login/CAPTCHA bypass. No Full Disk Access required; grant removable-volume access if the external disk is blocked.
