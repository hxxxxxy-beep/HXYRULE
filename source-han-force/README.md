# HXY Source Han Serif Force

Standalone Chrome MV3 extension that forces the locally installed **Source Han Serif** on all `http` / `https` / `file` pages.

Optional companion to HXYRULE. Not required for downloads, scan, or Helper pairing.

## Install

1. Install Source Han Serif on the Mac (or Noto Serif CJK SC; falls back to Songti SC).
2. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `source-han-force/`.

## Notes

- Cannot inject into `chrome://`, the Chrome Web Store, or other protected pages.
- Skips icon fonts (Font Awesome / Material Icons, etc.) and common video player chrome to avoid tofu glyphs.
- HXYRULE still injects the same stack on Rule34Video; both extensions may run together.
