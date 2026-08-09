#!/usr/bin/env python3
"""Local-only Helper for the personal Rule34Video favorites Chrome extension."""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".m4v", ".ts"}
INCOMPLETE_SUFFIXES = (".crdownload", ".download", ".part", ".tmp")
# Chrome's fallback name when it cannot commit the suggested basename.
UNCONFIRMED_INCOMPLETE_RE = re.compile(
    r"^Unconfirmed\s+\d+.*\.(crdownload|download|part|tmp)$",
    re.IGNORECASE,
)
# Suggested names: `{seq}——{title}——{videoId}.mp4` and Chrome uniquify
# `{seq}——{title}——{videoId} (N).mp4`. Zero-byte copies are failed leftovers.
HXYRULE_NAMED_VIDEO_RE = re.compile(
    r"\u2014\u2014(\d{1,12})(?: \(\d+\))?\.(?:mp4|mkv|webm|mov|m4v|ts)$",
    re.IGNORECASE,
)
VIDEO_ID_RE = re.compile(r"^\d{1,12}$")
# Legacy download names: `{videoId}__{title}.mp4`
FILENAME_VIDEO_ID_RE = re.compile(r"^(\d{1,12})(?:__|-|_|\.)")
# Current download names end with distinguisher: `…——{videoId}.mp4`
FILENAME_VIDEO_ID_SUFFIX_RE = re.compile(r"\u2014\u2014(\d{1,12})$")
# Stable favorite ordinal prefix: "123——" (digits + two em dashes).
ORDINAL_PREFIX_RE = re.compile(r"^(\d+)\s*\u2014\u2014\s*")
MAX_BODY_BYTES = 2 * 1024 * 1024
DEFAULT_PORT = 17934
# Parallel download claims allowed for the Chrome extension worker pool.
DOWNLOAD_CONCURRENCY = 6
# Transient network failures get fresh Chrome downloads after these delays.
DOWNLOAD_RETRY_DELAYS = (5, 15, 30)
# Keep head short enough that `{head}——{videoId}{ext}` fits common 255-byte name limits.
FILENAME_HEAD_MAX = 160
PLAYERS = {
    "system": None,
    "iina": "IINA",
    "vlc": "VLC",
}
QUEUE_STATUSES = (
    "pending",
    "waiting",
    "downloading",
    "paused",
    "completed",
    "failed",
    "skipped",
    "exists",
    "cancelled",
)
# Active rows shown in the Tasks dialog (finished statuses are omitted).
QUEUE_TASK_STATUSES = ("pending", "waiting", "downloading", "paused", "failed")


def utc_now() -> int:
    return int(time.time())


def sanitize_title(title: str, max_len: int = 120) -> str:
    text = str(title or "").strip()
    # Illegal / awkward path chars only. Keep ', &, ,, !, etc. so names track the site.
    text = re.sub(r'[\\/:\0\r\n\t*?"<>|]+', "_", text)
    # Keep em dash (——) used for stable favorite ordinal prefixes.
    text = re.sub(r"[^\w\-\.\(\)\[\]'&,!+#@ \u2014]+", "", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip(" ._")
    if not text:
        text = "video"
    return text[:max_len]


def strip_ordinal_prefix(title: str) -> str:
    return ORDINAL_PREFIX_RE.sub("", str(title or "")).strip()


def titled_with_ordinal(seq: int, title: str) -> str:
    bare = strip_ordinal_prefix(title) or "video"
    return f"{int(seq)}\u2014\u2014{bare}"


def media_filename(video_id: str, title: str, seq: Optional[int] = None, ext: str = ".mp4") -> str:
    """Build on-disk name: `{seq}——{title}——{videoId}{ext}` (site label + id tail).

    Without seq: `{title}——{videoId}{ext}` so Scan can still resolve the id.
    """
    if not VIDEO_ID_RE.fullmatch(str(video_id)):
        raise ValueError("invalid videoId")
    if not ext.startswith("."):
        ext = "." + ext
    ext = ext.lower()
    if ext not in VIDEO_EXTENSIONS:
        ext = ".mp4"
    bare = strip_ordinal_prefix(title) or "video"
    if seq is not None:
        head = titled_with_ordinal(int(seq), bare)
    else:
        head = bare
    id_tail = f"\u2014\u2014{video_id}"
    head = sanitize_title(head, max_len=max(20, FILENAME_HEAD_MAX - len(id_tail)))
    return f"{head}{id_tail}{ext}"


def title_from_media_filename(filename: str) -> str:
    """Extract display/title stem from a media filename (legacy or current)."""
    stem = Path(str(filename or "")).name
    if "." in stem:
        stem = Path(stem).stem
    # Current: `{seq}——{title}——{videoId}` or `{title}——{videoId}`
    m_suf = FILENAME_VIDEO_ID_SUFFIX_RE.search(stem)
    if m_suf:
        return stem[: m_suf.start()].rstrip()
    # Legacy: `{videoId}__{title}`
    m = FILENAME_VIDEO_ID_RE.match(stem)
    if not m:
        return stem
    return stem[m.end() :]


class Store:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._migrate()

    def _migrate(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS media (
                    video_id TEXT PRIMARY KEY,
                    relative_path TEXT NOT NULL,
                    absolute_path TEXT NOT NULL,
                    size INTEGER NOT NULL DEFAULT 0,
                    title TEXT,
                    scanned_at INTEGER NOT NULL,
                    downloaded_at INTEGER,
                    UNIQUE(relative_path)
                );
                CREATE TABLE IF NOT EXISTS download_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    video_id TEXT NOT NULL,
                    title TEXT NOT NULL DEFAULT '',
                    detail_url TEXT NOT NULL DEFAULT '',
                    favorite_page INTEGER NOT NULL DEFAULT 0,
                    card_index INTEGER NOT NULL DEFAULT 0,
                    sort_key INTEGER NOT NULL DEFAULT 0,
                    quality TEXT NOT NULL DEFAULT '',
                    filename TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    error TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    started_at INTEGER,
                    finished_at INTEGER,
                    chrome_download_id INTEGER
                );
                CREATE TABLE IF NOT EXISTS ordinals (
                    video_id TEXT PRIMARY KEY,
                    seq INTEGER NOT NULL UNIQUE,
                    assigned_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_queue_status ON download_queue(status);
                CREATE INDEX IF NOT EXISTS idx_queue_sort ON download_queue(sort_key);
                CREATE INDEX IF NOT EXISTS idx_ordinals_seq ON ordinals(seq);
                """
            )
            queue_columns = {
                row["name"]
                for row in self._conn.execute("PRAGMA table_info(download_queue)").fetchall()
            }
            if "retry_count" not in queue_columns:
                self._conn.execute(
                    "ALTER TABLE download_queue ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0"
                )
            if "retry_at" not in queue_columns:
                self._conn.execute("ALTER TABLE download_queue ADD COLUMN retry_at INTEGER")
            self._conn.commit()

    def get_meta(self, key: str, default: Optional[str] = None) -> Optional[str]:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM meta WHERE key = ?", (key,)
            ).fetchone()
        return row["value"] if row else default

    def set_meta(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO meta(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
            self._conn.commit()

    def get_setting(self, key: str, default: Optional[str] = None) -> Optional[str]:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
            self._conn.commit()

    def replace_media(self, rows: list[dict[str, Any]]) -> None:
        now = utc_now()
        with self._lock:
            self._conn.execute("DELETE FROM media")
            for row in rows:
                self._conn.execute(
                    """
                    INSERT INTO media(
                        video_id, relative_path, absolute_path, size, title,
                        scanned_at, downloaded_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["video_id"],
                        row["relative_path"],
                        row["absolute_path"],
                        int(row.get("size") or 0),
                        row.get("title") or "",
                        int(row.get("scanned_at") or now),
                        row.get("downloaded_at"),
                    ),
                )
            self._conn.commit()

    def upsert_media(self, row: dict[str, Any]) -> None:
        now = utc_now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO media(
                    video_id, relative_path, absolute_path, size, title,
                    scanned_at, downloaded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(video_id) DO UPDATE SET
                    relative_path = excluded.relative_path,
                    absolute_path = excluded.absolute_path,
                    size = excluded.size,
                    title = excluded.title,
                    scanned_at = excluded.scanned_at,
                    downloaded_at = COALESCE(excluded.downloaded_at, media.downloaded_at)
                """,
                (
                    row["video_id"],
                    row["relative_path"],
                    row["absolute_path"],
                    int(row.get("size") or 0),
                    row.get("title") or "",
                    int(row.get("scanned_at") or now),
                    row.get("downloaded_at"),
                ),
            )
            self._conn.commit()

    def get_media(self, video_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM media WHERE video_id = ?", (video_id,)
            ).fetchone()
        return dict(row) if row else None

    def list_media(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM media ORDER BY video_id"
            ).fetchall()
        return [dict(r) for r in rows]

    def lookup_ordinals(self, video_ids: list[str]) -> dict[str, int]:
        out: dict[str, int] = {}
        ids = [str(v) for v in video_ids if VIDEO_ID_RE.fullmatch(str(v))]
        if not ids:
            return out
        with self._lock:
            placeholders = ",".join("?" for _ in ids)
            rows = self._conn.execute(
                f"SELECT video_id, seq FROM ordinals WHERE video_id IN ({placeholders})",
                ids,
            ).fetchall()
        for row in rows:
            out[str(row["video_id"])] = int(row["seq"])
        return out

    def ensure_ordinals(self, items: list[dict[str, Any]]) -> dict[str, int]:
        """Assign stable seq per video_id once. Never renumber; deletions leave gaps.

        items: [{videoId, preferredSeq?}]. preferredSeq used only if free; else max+1.
        """
        out: dict[str, int] = {}
        now = utc_now()
        with self._lock:
            max_row = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS m FROM ordinals"
            ).fetchone()
            next_seq = int(max_row["m"] or 0) + 1
            used = {
                int(r["seq"])
                for r in self._conn.execute("SELECT seq FROM ordinals").fetchall()
            }
            for raw in items:
                if not isinstance(raw, dict):
                    continue
                vid = str(raw.get("videoId") or "").strip()
                if not VIDEO_ID_RE.fullmatch(vid):
                    continue
                existing = self._conn.execute(
                    "SELECT seq FROM ordinals WHERE video_id = ?", (vid,)
                ).fetchone()
                if existing:
                    out[vid] = int(existing["seq"])
                    continue
                preferred = raw.get("preferredSeq")
                seq = None
                try:
                    pref = int(preferred) if preferred is not None else 0
                except (TypeError, ValueError):
                    pref = 0
                if pref >= 1 and pref not in used:
                    seq = pref
                else:
                    while next_seq in used:
                        next_seq += 1
                    seq = next_seq
                    next_seq += 1
                self._conn.execute(
                    "INSERT INTO ordinals(video_id, seq, assigned_at) VALUES(?, ?, ?)",
                    (vid, seq, now),
                )
                used.add(seq)
                out[vid] = seq
            self._conn.commit()
        return out

    def lookup_by_seq(self, seq: int) -> Optional[dict[str, Any]]:
        """Resolve a stable ordinal to its video_id. Returns None if missing."""
        try:
            n = int(seq)
        except (TypeError, ValueError):
            return None
        if n < 1:
            return None
        with self._lock:
            row = self._conn.execute(
                "SELECT video_id, seq FROM ordinals WHERE seq = ?", (n,)
            ).fetchone()
            max_row = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS m, COUNT(*) AS c FROM ordinals"
            ).fetchone()
        if not row:
            return {
                "found": False,
                "seq": n,
                "videoId": None,
                "maxSeq": int(max_row["m"] or 0),
                "count": int(max_row["c"] or 0),
            }
        return {
            "found": True,
            "seq": int(row["seq"]),
            "videoId": str(row["video_id"]),
            "maxSeq": int(max_row["m"] or 0),
            "count": int(max_row["c"] or 0),
        }

    def rebuild_ordinals(self, video_ids: list[str]) -> dict[str, int]:
        """Replace all ordinals from a newest-first favorites crawl.

        video_ids[0] = page1 first card (newest) → seq N
        video_ids[-1] = last page last card (oldest) → seq 1
        IDs not in the list are dropped from ordinals.
        """
        ordered: list[str] = []
        seen: set[str] = set()
        for raw in video_ids:
            vid = str(raw or "").strip()
            if not VIDEO_ID_RE.fullmatch(vid) or vid in seen:
                continue
            seen.add(vid)
            ordered.append(vid)
        out: dict[str, int] = {}
        now = utc_now()
        n = len(ordered)
        with self._lock:
            self._conn.execute("DELETE FROM ordinals")
            for i, vid in enumerate(ordered):
                seq = n - i
                self._conn.execute(
                    "INSERT INTO ordinals(video_id, seq, assigned_at) VALUES(?, ?, ?)",
                    (vid, seq, now),
                )
                out[vid] = seq
            self._conn.commit()
        return out

    def clear_stale_media(self) -> int:
        removed = 0
        with self._lock:
            rows = self._conn.execute("SELECT video_id, absolute_path FROM media").fetchall()
            for row in rows:
                if not Path(row["absolute_path"]).is_file():
                    self._conn.execute(
                        "DELETE FROM media WHERE video_id = ?", (row["video_id"],)
                    )
                    removed += 1
            self._conn.commit()
        return removed

    def delete_media_ids(self, video_ids: list[str]) -> int:
        ids = [str(v) for v in video_ids if VIDEO_ID_RE.fullmatch(str(v))]
        if not ids:
            return 0
        removed = 0
        with self._lock:
            for vid in ids:
                cur = self._conn.execute("DELETE FROM media WHERE video_id = ?", (vid,))
                removed += int(cur.rowcount or 0)
            self._conn.commit()
        return removed

    def delete_media_by_relative_paths(self, relative_paths: list[str]) -> int:
        paths = [str(p).replace("\\", "/").strip() for p in relative_paths if str(p).strip()]
        if not paths:
            return 0
        removed = 0
        with self._lock:
            for rel in paths:
                cur = self._conn.execute(
                    "DELETE FROM media WHERE relative_path = ?", (rel,)
                )
                removed += int(cur.rowcount or 0)
            self._conn.commit()
        return removed

    def enqueue(self, items: list[dict[str, Any]]) -> dict[str, Any]:
        now = utc_now()
        added = 0
        skipped_existing = 0
        skipped_queued = 0
        with self._lock:
            active = {
                r["video_id"]
                for r in self._conn.execute(
                    "SELECT video_id FROM download_queue "
                    "WHERE status IN ('pending','waiting','downloading','failed')"
                ).fetchall()
            }
            media_ids = {
                r["video_id"]
                for r in self._conn.execute("SELECT video_id FROM media").fetchall()
            }
            for item in items:
                video_id = str(item.get("videoId") or "").strip()
                if not VIDEO_ID_RE.fullmatch(video_id):
                    continue
                if video_id in media_ids:
                    skipped_existing += 1
                    continue
                if video_id in active:
                    skipped_queued += 1
                    continue
                page = int(item.get("favoritePage") or 0)
                card = int(item.get("cardIndex") or 0)
                # Ascending sort_key downloads first. Caller should pass
                # sortKey = -(page * 100000 + card) so earlier favorites win.
                if item.get("sortKey") is None:
                    sort_key = -(page * 100000 + card)
                else:
                    sort_key = int(item.get("sortKey"))
                self._conn.execute(
                    """
                    INSERT INTO download_queue(
                        video_id, title, detail_url, favorite_page, card_index,
                        sort_key, quality, filename, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        video_id,
                        str(item.get("title") or ""),
                        str(item.get("detailUrl") or ""),
                        page,
                        card,
                        sort_key,
                        str(item.get("quality") or ""),
                        str(item.get("filename") or ""),
                        now,
                    ),
                )
                active.add(video_id)
                added += 1
            self._conn.commit()
        return {
            "added": added,
            "skippedExisting": skipped_existing,
            "skippedQueued": skipped_queued,
        }

    def queue_snapshot(self) -> dict[str, Any]:
        with self._lock:
            rows = [
                dict(r)
                for r in self._conn.execute(
                    "SELECT * FROM download_queue ORDER BY sort_key ASC, id ASC"
                ).fetchall()
            ]
            paused = self.get_meta("queue_paused", "0") == "1"
        counts = {s: 0 for s in QUEUE_STATUSES}
        current = None
        for row in rows:
            status = row["status"]
            counts[status] = counts.get(status, 0) + 1
            if status == "downloading" and current is None:
                current = self._public_queue_item(row)
        pending_like = [
            r
            for r in rows
            if r["status"] in ("pending", "waiting", "downloading", "paused", "failed")
        ]
        total = len(rows)
        completed = counts.get("completed", 0) + counts.get("skipped", 0) + counts.get("exists", 0)
        cancelled = counts.get("cancelled", 0)
        return {
            "paused": paused,
            "total": total,
            "completed": completed,
            "cancelled": cancelled,
            "counts": counts,
            "current": current,
            "items": [self._public_queue_item(r) for r in rows],
            "activeCount": len(pending_like),
        }

    @staticmethod
    def _public_queue_item(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": row["id"],
            "videoId": row["video_id"],
            "title": row["title"],
            "detailUrl": row["detail_url"],
            "favoritePage": row["favorite_page"],
            "cardIndex": row["card_index"],
            "sortKey": row["sort_key"],
            "quality": row["quality"],
            "filename": row["filename"],
            "status": row["status"],
            "error": row["error"],
            "createdAt": row["created_at"],
            "startedAt": row["started_at"],
            "finishedAt": row["finished_at"],
            "chromeDownloadId": row["chrome_download_id"],
            "retryCount": int(row["retry_count"] or 0),
            "retryAt": row["retry_at"],
        }

    def set_paused(self, paused: bool) -> None:
        self.set_meta("queue_paused", "1" if paused else "0")

    def claim_next(self) -> Optional[dict[str, Any]]:
        if self.get_meta("queue_paused", "0") == "1":
            return None
        with self._lock:
            busy = self._conn.execute(
                "SELECT COUNT(*) AS c FROM download_queue WHERE status = 'downloading'"
            ).fetchone()
            if int(busy["c"] or 0) >= DOWNLOAD_CONCURRENCY:
                return None
            row = self._conn.execute(
                "SELECT * FROM download_queue "
                "WHERE (status = 'pending' OR (status = 'waiting' AND COALESCE(retry_at, 0) <= ?)) "
                "AND video_id NOT IN (SELECT video_id FROM download_queue WHERE status = 'downloading') "
                "ORDER BY sort_key ASC, id ASC LIMIT 1",
                (utc_now(),),
            ).fetchone()
            if not row:
                return None
            now = utc_now()
            self._conn.execute(
                "UPDATE download_queue SET status = 'downloading', started_at = ?, "
                "retry_at = NULL, error = '' "
                "WHERE id = ?",
                (now, row["id"]),
            )
            self._conn.commit()
            claimed = dict(row)
            claimed["status"] = "downloading"
            claimed["started_at"] = now
            claimed["retry_at"] = None
            claimed["error"] = ""
            return self._public_queue_item(claimed)

    def update_queue_item(self, item_id: int, **fields: Any) -> Optional[dict[str, Any]]:
        if not fields:
            return None
        cols = []
        vals: list[Any] = []
        mapping = {
            "status": "status",
            "error": "error",
            "filename": "filename",
            "quality": "quality",
            "chromeDownloadId": "chrome_download_id",
            "startedAt": "started_at",
            "finishedAt": "finished_at",
            "retryCount": "retry_count",
            "retryAt": "retry_at",
        }
        for key, col in mapping.items():
            if key in fields:
                cols.append(f"{col} = ?")
                vals.append(fields[key])
        if not cols:
            return None
        vals.append(item_id)
        with self._lock:
            self._conn.execute(
                f"UPDATE download_queue SET {', '.join(cols)} WHERE id = ?",
                vals,
            )
            self._conn.commit()
            row = self._conn.execute(
                "SELECT * FROM download_queue WHERE id = ?", (item_id,)
            ).fetchone()
        return self._public_queue_item(dict(row)) if row else None

    def retry_transient(self, item_id: int, error: str) -> dict[str, Any]:
        """Schedule a fresh download with bounded backoff; isolate exhaustion."""
        item = self.get_queue_item(item_id)
        if not item:
            raise FileNotFoundError("queue item not found")
        retry_count = int(item.get("retryCount") or 0)
        if retry_count >= len(DOWNLOAD_RETRY_DELAYS):
            self.update_queue_item(
                item_id,
                status="failed",
                error=str(error or "download failed")[:500],
                finishedAt=utc_now(),
                retryAt=None,
            )
            return {"scheduled": False, "exhausted": True, "retryCount": retry_count}
        delay = DOWNLOAD_RETRY_DELAYS[retry_count]
        next_count = retry_count + 1
        retry_at = utc_now() + delay
        self.update_queue_item(
            item_id,
            status="waiting",
            error=str(error or "temporary network failure")[:500],
            finishedAt=None,
            chromeDownloadId=None,
            retryCount=next_count,
            retryAt=retry_at,
        )
        return {
            "scheduled": True,
            "exhausted": False,
            "retryCount": next_count,
            "retryAt": retry_at,
            "delaySeconds": delay,
        }

    def get_queue_item(self, item_id: int) -> Optional[dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM download_queue WHERE id = ?", (item_id,)
            ).fetchone()
        return self._public_queue_item(dict(row)) if row else None

    def cancel_remaining(self) -> int:
        with self._lock:
            cur = self._conn.execute(
                "UPDATE download_queue SET status = 'cancelled', finished_at = ?, error = '' "
                "WHERE status IN ('pending','waiting','failed','downloading','paused')",
                (utc_now(),),
            )
            self._conn.commit()
            self.set_meta("queue_paused", "0")
            return cur.rowcount

    def queue_list(self, data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        """Active download-queue items for the Tasks dialog."""
        include_done = bool((data or {}).get("includeDone"))
        snap = self.queue_snapshot()
        items = []
        for item in snap.get("items") or []:
            st = str(item.get("status") or "")
            if st in QUEUE_TASK_STATUSES or (
                include_done and st in ("completed", "skipped", "exists", "cancelled")
            ):
                items.append(item)
        downloading = [i for i in items if i.get("status") == "downloading"]
        paused_items = [i for i in items if i.get("status") == "paused"]
        rest = [i for i in items if i.get("status") not in ("downloading", "paused")]
        return {
            "paused": bool(snap.get("paused")),
            "hasPausedItems": bool(paused_items),
            "hasDownloading": bool(downloading),
            "counts": snap.get("counts") or {},
            "activeCount": int(snap.get("activeCount") or 0),
            "items": downloading + paused_items + rest,
        }

    def _normalize_queue_ids(self, ids: Any, *, action: str) -> list[int]:
        if not isinstance(ids, list):
            raise ValueError("ids must be a list")
        try:
            parsed = [int(x) for x in ids]
        except (TypeError, ValueError) as exc:
            raise ValueError("ids must be integers") from exc
        seen: set[int] = set()
        wanted: list[int] = []
        for item_id in parsed:
            if item_id <= 0 or item_id in seen:
                continue
            seen.add(item_id)
            wanted.append(item_id)
        if not wanted:
            raise ValueError(f"ids required to {action}")
        return wanted

    def queue_pause_live(self, ids: list[Any] | None = None) -> dict[str, Any]:
        """Pause in-flight downloads; queued rows stay claimable so the next item takes the slot.

        When ``ids`` is provided, only those downloading rows pause. When omitted, all
        downloading rows pause (legacy / bulk).
        """
        chrome_ids: list[int] = []
        paused_items: list[dict[str, Any]] = []
        wanted: list[int] | None = None
        if ids is not None:
            wanted = self._normalize_queue_ids(ids, action="pause")
        with self._lock:
            if wanted is None:
                rows = [
                    dict(r)
                    for r in self._conn.execute(
                        "SELECT * FROM download_queue WHERE status = 'downloading' "
                        "ORDER BY sort_key ASC, id ASC"
                    ).fetchall()
                ]
            else:
                placeholders = ",".join("?" for _ in wanted)
                rows = [
                    dict(r)
                    for r in self._conn.execute(
                        f"SELECT * FROM download_queue WHERE status = 'downloading' "
                        f"AND id IN ({placeholders}) ORDER BY sort_key ASC, id ASC",
                        wanted,
                    ).fetchall()
                ]
            if not rows:
                raise ValueError("nothing downloading to pause")
            for row in rows:
                chrome_id = row.get("chrome_download_id")
                if chrome_id:
                    chrome_ids.append(int(chrome_id))
                self._conn.execute(
                    "UPDATE download_queue SET status = 'paused', error = 'paused', "
                    "chrome_download_id = NULL, finished_at = NULL WHERE id = ?",
                    (row["id"],),
                )
                paused_items.append(
                    self._public_queue_item(
                        {
                            **row,
                            "status": "paused",
                            "error": "paused",
                            "chrome_download_id": None,
                            "finished_at": None,
                        }
                    )
                )
            self._conn.commit()
        listed = self.queue_list({})
        return {
            "pausedItems": paused_items,
            "chromeDownloadIds": chrome_ids,
            "items": listed.get("items") or [],
            "hasPausedItems": bool(listed.get("hasPausedItems")),
            "hasDownloading": bool(listed.get("hasDownloading")),
        }

    def queue_resume_paused(self, ids: list[Any] | None = None) -> dict[str, Any]:
        """Return paused rows to pending so the worker can claim them again.

        When ``ids`` is provided, only those paused rows resume. When omitted, all
        paused rows resume (legacy / bulk).
        """
        wanted: list[int] | None = None
        if ids is not None:
            wanted = self._normalize_queue_ids(ids, action="resume")
        with self._lock:
            if wanted is None:
                rows = [
                    dict(r)
                    for r in self._conn.execute(
                        "SELECT * FROM download_queue WHERE status = 'paused' "
                        "ORDER BY sort_key ASC, id ASC"
                    ).fetchall()
                ]
            else:
                placeholders = ",".join("?" for _ in wanted)
                rows = [
                    dict(r)
                    for r in self._conn.execute(
                        f"SELECT * FROM download_queue WHERE status = 'paused' "
                        f"AND id IN ({placeholders}) ORDER BY sort_key ASC, id ASC",
                        wanted,
                    ).fetchall()
                ]
            if not rows:
                raise ValueError("nothing paused to resume")
            # Prefer resumed items ahead of ordinary queued work.
            min_row = self._conn.execute(
                "SELECT MIN(sort_key) AS m FROM download_queue "
                "WHERE status IN ('pending','waiting','downloading','paused','failed')"
            ).fetchone()
            base = int(min_row["m"] if min_row and min_row["m"] is not None else 0) - len(rows)
            for index, row in enumerate(rows):
                self._conn.execute(
                    "UPDATE download_queue SET status = 'pending', error = '', "
                    "chrome_download_id = NULL, finished_at = NULL, started_at = NULL, "
                    "sort_key = ? WHERE id = ?",
                    (base + index, row["id"]),
                )
            self._conn.commit()
        listed = self.queue_list({})
        return {
            "resumed": len(rows),
            "items": listed.get("items") or [],
            "hasPausedItems": bool(listed.get("hasPausedItems")),
            "hasDownloading": bool(listed.get("hasDownloading")),
        }

    def queue_remove(self, item_id: int) -> dict[str, Any]:
        """Cancel one active queue item. Returns chromeDownloadId for the worker to abort."""
        item_id = int(item_id or 0)
        if item_id <= 0:
            raise ValueError("id is required")
        item = self.get_queue_item(item_id)
        if not item:
            raise FileNotFoundError("queue item not found")
        st = str(item.get("status") or "")
        if st not in QUEUE_TASK_STATUSES:
            raise ValueError("queue item is not active")
        chrome_id = item.get("chromeDownloadId")
        updated = self.update_queue_item(
            item_id,
            status="cancelled",
            error="removed",
            finishedAt=utc_now(),
            chromeDownloadId=None,
        )
        listed = self.queue_list({})
        return {
            "item": updated or {**item, "status": "cancelled", "error": "removed"},
            "chromeDownloadId": chrome_id,
            "remaining": len(listed.get("items") or []),
            "paused": bool(listed.get("paused")),
            "hasPausedItems": bool(listed.get("hasPausedItems")),
            "hasDownloading": bool(listed.get("hasDownloading")),
        }

    def queue_reorder(self, ids: list[Any]) -> dict[str, Any]:
        """Reorder active download items. ids must list every task-status item once."""
        if not isinstance(ids, list) or not ids:
            raise ValueError("ids must be a non-empty list")
        try:
            wanted = [int(x) for x in ids]
        except (TypeError, ValueError) as exc:
            raise ValueError("ids must be integers") from exc
        if len(wanted) != len(set(wanted)):
            raise ValueError("ids must be unique")
        with self._lock:
            rows = [
                dict(r)
                for r in self._conn.execute(
                    "SELECT * FROM download_queue WHERE status IN "
                    "('pending','waiting','downloading','paused','failed') "
                    "ORDER BY sort_key ASC, id ASC"
                ).fetchall()
            ]
            active_by_id = {int(r["id"]): r for r in rows}
            if set(wanted) != set(active_by_id):
                raise ValueError("ids must match the active download queue")
            # Keep in-flight + paused downloads pinned at the front.
            live_ids = [
                int(r["id"]) for r in rows if r["status"] in ("downloading", "paused")
            ]
            if live_ids:
                rest = [i for i in wanted if i not in set(live_ids)]
                # Preserve current live/paused order from DB, not the client payload.
                wanted = live_ids + rest
            for index, item_id in enumerate(wanted):
                self._conn.execute(
                    "UPDATE download_queue SET sort_key = ? WHERE id = ?",
                    (index, item_id),
                )
            self._conn.commit()
        listed = self.queue_list({})
        return {
            "items": listed.get("items") or [],
            "paused": bool(listed.get("paused")),
            "hasPausedItems": bool(listed.get("hasPausedItems")),
            "hasDownloading": bool(listed.get("hasDownloading")),
        }

    def clear_finished_queue(self) -> int:
        """Remove finished/cancelled rows so the counter can reset."""
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM download_queue WHERE status IN "
                "('completed','skipped','exists','cancelled')"
            )
            self._conn.commit()
            return cur.rowcount


class Helper:
    def __init__(
        self,
        video_dir: Path,
        allowed_origin: str,
        pairing_token: str,
        support_dir: Path,
        player: str = "iina",
    ):
        self.video_dir_arg = str(video_dir)
        self.video_dir = Path(video_dir).expanduser().resolve()
        self.allowed_origin = allowed_origin.rstrip("/")
        self.pairing_token = pairing_token
        self.support_dir = support_dir
        self.support_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir = Path.home() / "Library" / "Logs"
        self.player = player if player in PLAYERS else "iina"
        self.store = Store(self.support_dir / "hxyrule.sqlite3")
        self.store.set_meta("pairing_token", pairing_token)
        self.store.set_setting("player", self.player)
        self.store.set_setting("video_dir", self.video_dir_arg)
        self.session_id = secrets.token_urlsafe(24)
        self._scan_lock = threading.Lock()
        self._video_root_lock = threading.RLock()
        self.last_scan: dict[str, Any] = {
            "scannedAt": 0,
            "fileCount": 0,
            "matchedCount": 0,
            "directory": str(self.video_dir),
        }

    def _refresh_video_dir(self) -> Path:
        resolved = Path(self.video_dir_arg).expanduser().resolve()
        self.video_dir = resolved
        return resolved

    def _is_incomplete(self, path: Path) -> bool:
        # `Unconfirmed *.mp4` can be a finished Chrome rename; only incomplete
        # suffixes (and zero-byte named leftovers) are discardable failures.
        lower = path.name.lower()
        return any(lower.endswith(suf) for suf in INCOMPLETE_SUFFIXES)

    def _is_empty_named_failure(self, path: Path) -> bool:
        """Zero-byte HXYRULE-named video = failed Chrome commit / uniquify leftover."""
        try:
            if not path.is_file() or path.stat().st_size != 0:
                return False
        except OSError:
            return False
        return bool(HXYRULE_NAMED_VIDEO_RE.search(path.name))

    def _is_discardable_failure_file(self, path: Path) -> bool:
        return self._is_incomplete(path) or self._is_empty_named_failure(path)

    def _extract_video_id(self, name: str) -> Optional[str]:
        stem = Path(name).stem
        # Prefer trailing distinguisher `——{videoId}` (current naming).
        # Do this before legacy prefix match so `138——title——3105205` is not
        # mistaken for ordinal-as-id.
        m_suf = FILENAME_VIDEO_ID_SUFFIX_RE.search(stem)
        if m_suf:
            return m_suf.group(1)
        match = FILENAME_VIDEO_ID_RE.match(name)
        if match:
            return match.group(1)
        if VIDEO_ID_RE.fullmatch(stem):
            return stem
        return None

    def _paths_via_pathlib(self, root: Path):
        try:
            yield from root.rglob("*")
        except OSError as exc:
            print(f"[hxyrule-helper] pathlib scan failed: {exc!r}", flush=True)

    def _paths_via_finder(self, root: Path):
        proc = subprocess.run(
            [
                "/usr/bin/osascript",
                "-e",
                "on run argv",
                "-e",
                "set rootPath to item 1 of argv",
                "-e",
                'tell application "Finder"',
                "-e",
                "set targetFolder to (POSIX file rootPath) as alias",
                "-e",
                'set out to ""',
                "-e",
                "repeat with f in (get every file of entire contents of folder targetFolder)",
                "-e",
                "set out to out & (POSIX path of (f as alias)) & linefeed",
                "-e",
                "end repeat",
                "-e",
                "return out",
                "-e",
                "end tell",
                "-e",
                "end run",
                "--",
                str(root),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(err or "Finder scan failed")
        for line in (proc.stdout or "").replace("\r", "\n").splitlines():
            line = line.strip()
            if line:
                yield Path(line)

    def scan(self) -> dict[str, Any]:
        with self._scan_lock:
            root = self._refresh_video_dir()
            if not root.exists():
                raise FileNotFoundError(f"video root not mounted or missing: {root}")
            if not os.access(root, os.R_OK):
                raise PermissionError(f"no permission to read video root: {root}")

            paths = list(self._paths_via_pathlib(root))
            source = "pathlib"
            if not paths:
                try:
                    paths = list(self._paths_via_finder(root))
                    source = "finder"
                except RuntimeError:
                    pass

            by_id: dict[str, dict[str, Any]] = {}
            duplicates: list[str] = []
            unmatched = 0
            now = utc_now()
            for path in paths:
                try:
                    if not path.is_file():
                        continue
                except OSError:
                    continue
                if self._is_incomplete(path):
                    continue
                if path.suffix.lower() not in VIDEO_EXTENSIONS:
                    continue
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                if size <= 0:
                    continue
                try:
                    rel = path.relative_to(root).as_posix()
                except ValueError:
                    continue
                # Reject symlink escape
                try:
                    real = path.resolve()
                    real.relative_to(root.resolve())
                except Exception:
                    continue
                video_id = self._extract_video_id(path.name)
                if not video_id:
                    unmatched += 1
                    continue
                if video_id in by_id:
                    duplicates.append(video_id)
                    # Keep the larger file.
                    if size <= by_id[video_id]["size"]:
                        continue
                by_id[video_id] = {
                    "video_id": video_id,
                    "relative_path": rel,
                    "absolute_path": str(path),
                    "size": size,
                    "title": "",
                    "scanned_at": now,
                    "downloaded_at": None,
                }

            self.store.replace_media(list(by_id.values()))
            self.last_scan = {
                "scannedAt": now,
                "fileCount": len(by_id) + unmatched,
                "matchedCount": len(by_id),
                "unmatchedCount": unmatched,
                "duplicateIds": sorted(set(duplicates)),
                "directory": str(root),
                "scanSource": source,
            }
            # Omit absolutePath from the wire payload (still stored in SQLite).
            # Extension messaging + options fetch choke on ~1MB full-path maps.
            matches = {
                vid: {
                    "videoId": vid,
                    "relativePath": entry["relative_path"],
                    "displayPath": self._display_path(entry["absolute_path"]),
                    "size": entry["size"],
                }
                for vid, entry in by_id.items()
            }
            return {
                "status": "ok",
                "localSessionId": self.session_id,
                **self.last_scan,
                "matches": matches,
            }

    def _display_path(self, absolute: str) -> str:
        home = str(Path.home())
        if absolute.startswith(home + os.sep):
            return "~" + absolute[len(home) :]
        return absolute

    def lookup(self, video_ids: list[str]) -> dict[str, Any]:
        result = {}
        for raw in video_ids:
            video_id = str(raw or "").strip()
            if not VIDEO_ID_RE.fullmatch(video_id):
                continue
            row = self.store.get_media(video_id)
            if not row:
                result[video_id] = {"exists": False}
                continue
            path = Path(row["absolute_path"])
            if not path.is_file() or self._is_incomplete(path) or path.stat().st_size <= 0:
                result[video_id] = {"exists": False}
                continue
            result[video_id] = {
                "exists": True,
                "relativePath": row["relative_path"],
                "absolutePath": row["absolute_path"],
                "displayPath": self._display_path(row["absolute_path"]),
                "size": row["size"],
            }
        return {"status": "ok", "results": result, "lastScan": self.last_scan}

    def _resolve_media_by_id(self, video_id: str) -> Path:
        if not VIDEO_ID_RE.fullmatch(video_id):
            raise ValueError("invalid videoId")
        row = self.store.get_media(video_id)
        if not row:
            raise FileNotFoundError(f"video not in index: {video_id}")
        root = self._refresh_video_dir().resolve()
        candidate = Path(row["absolute_path"]).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ValueError("path escapes video root") from exc
        if not candidate.is_file():
            raise FileNotFoundError(f"file missing: {video_id}")
        return candidate

    def delete_media(self, video_ids: list[str]) -> dict[str, Any]:
        """Unlink path-locked media files and drop their media rows.

        Ordinals are kept (gaps are intentional). Escaping video root is rejected.
        """
        deleted: list[dict[str, Any]] = []
        missing: list[str] = []
        failed: list[dict[str, str]] = []
        root = self._refresh_video_dir().resolve()
        for raw in video_ids:
            video_id = str(raw or "").strip()
            if not VIDEO_ID_RE.fullmatch(video_id):
                failed.append({"videoId": video_id, "error": "invalid videoId"})
                continue
            row = self.store.get_media(video_id)
            if not row:
                missing.append(video_id)
                continue
            relative_path = str(row.get("relative_path") or "")
            try:
                candidate = Path(row["absolute_path"]).resolve()
                candidate.relative_to(root)
            except (OSError, ValueError):
                failed.append({"videoId": video_id, "error": "path escapes video root"})
                continue
            if candidate.is_file():
                try:
                    candidate.unlink()
                except OSError as exc:
                    failed.append({"videoId": video_id, "error": str(exc)})
                    continue
            self.store.delete_media_ids([video_id])
            deleted.append(
                {
                    "videoId": video_id,
                    "relativePath": relative_path,
                    "fileName": Path(relative_path).name or relative_path,
                }
            )
        return {
            "status": "ok",
            "deleted": deleted,
            "missing": missing,
            "failed": failed,
            "deletedCount": len(deleted),
        }

    def _is_kept_favorite_file(self, path: Path, keep_ids: set[str]) -> bool:
        """True when this file is a complete video whose id is in My Favorites."""
        try:
            if not path.is_file() or path.is_symlink():
                return False
        except OSError:
            return False
        if self._is_incomplete(path):
            return False
        if path.suffix.lower() not in VIDEO_EXTENSIONS:
            return False
        try:
            if path.stat().st_size <= 0:
                return False
        except OSError:
            return False
        video_id = self._extract_video_id(path.name)
        return bool(video_id and video_id in keep_ids)

    def _normalize_rel_path(self, raw: str) -> str:
        rel = str(raw or "").replace("\\", "/").strip().lstrip("/")
        if not rel or rel in {".", ".."} or ".." in rel.split("/"):
            raise ValueError(f"invalid relative path: {raw!r}")
        return rel

    def list_orphans(self, keep_video_ids: list[str]) -> dict[str, Any]:
        """List every file/dir under video root except kept favorites videos.

        Kept = complete video file whose extracted videoId is in keep_video_ids.
        All other files and all folders (including parents of kept videos) are listed.
        """
        root = self._refresh_video_dir().resolve()
        if not root.exists():
            raise FileNotFoundError(f"video root not mounted or missing: {root}")
        if not os.access(root, os.R_OK):
            raise PermissionError(f"no permission to read video root: {root}")

        keep_ids = {
            str(v).strip()
            for v in keep_video_ids
            if VIDEO_ID_RE.fullmatch(str(v).strip())
        }
        kept_files = 0
        orphan_files: list[dict[str, Any]] = []
        all_dirs: list[str] = []

        for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
            base = Path(dirpath)
            try:
                real_base = base.resolve()
                real_base.relative_to(root)
            except (OSError, ValueError):
                dirnames[:] = []
                continue
            # Do not descend through symlinked directories.
            safe_dirs = []
            for name in list(dirnames):
                child = base / name
                try:
                    if child.is_symlink():
                        continue
                    child.resolve().relative_to(root)
                except (OSError, ValueError):
                    continue
                safe_dirs.append(name)
            dirnames[:] = safe_dirs

            if real_base != root:
                rel_dir = real_base.relative_to(root).as_posix()
                all_dirs.append(rel_dir)

            for name in filenames:
                path = base / name
                try:
                    if path.is_symlink():
                        real = path.resolve(strict=False)
                        try:
                            real.relative_to(root)
                        except ValueError:
                            continue
                    elif not path.is_file():
                        continue
                    path.resolve().relative_to(root)
                    rel = path.relative_to(root).as_posix()
                except (OSError, ValueError):
                    continue

                if self._is_kept_favorite_file(path, keep_ids):
                    kept_files += 1
                    continue

                # Finder metadata; regenerates automatically — omit from prune UI.
                if path.name == ".DS_Store" or path.name.lower() == ".ds_store":
                    continue

                video_id = self._extract_video_id(path.name)
                try:
                    size = path.stat().st_size
                except OSError:
                    size = 0
                orphan_files.append(
                    {
                        "relativePath": rel,
                        "kind": "file",
                        "size": size,
                        "videoId": video_id,
                        "label": rel,
                    }
                )

        orphan_dirs = [
            {
                "relativePath": rel,
                "kind": "dir",
                "size": 0,
                "videoId": None,
                "label": rel.rstrip("/") + "/",
            }
            for rel in all_dirs
        ]
        items = orphan_dirs + orphan_files
        items.sort(key=lambda it: str(it["relativePath"]).lower())
        return {
            "status": "ok",
            "directory": str(root),
            "keepCount": len(keep_ids),
            "keptFileCount": kept_files,
            "orphanCount": len(items),
            "items": items,
        }

    def delete_paths(self, relative_paths: list[str]) -> dict[str, Any]:
        """Delete path-locked relative files/dirs under the video root."""
        deleted: list[dict[str, Any]] = []
        missing: list[str] = []
        failed: list[dict[str, str]] = []
        root = self._refresh_video_dir().resolve()
        if not root.exists():
            raise FileNotFoundError(f"video root not mounted or missing: {root}")

        normalized: list[str] = []
        seen: set[str] = set()
        for raw in relative_paths:
            try:
                rel = self._normalize_rel_path(raw)
            except ValueError as exc:
                failed.append({"relativePath": str(raw), "error": str(exc)})
                continue
            if rel in seen:
                continue
            seen.add(rel)
            normalized.append(rel)

        # Deepest paths first so files go before parent dirs.
        normalized.sort(key=lambda p: p.count("/"), reverse=True)

        for rel in normalized:
            path = root.joinpath(*Path(rel).parts)
            try:
                parent = path.parent.resolve()
                parent.relative_to(root)
            except (OSError, ValueError):
                failed.append({"relativePath": rel, "error": "path escapes video root"})
                continue
            if path.resolve() == root or rel == "":
                failed.append({"relativePath": rel, "error": "refusing to delete video root"})
                continue
            try:
                if not path.exists() and not path.is_symlink():
                    missing.append(rel)
                    continue
                is_dir = path.is_dir() and not path.is_symlink()
                kind = "dir" if is_dir else "file"
                video_id = (
                    self._extract_video_id(path.name)
                    if path.is_file() or path.is_symlink()
                    else None
                )
                if is_dir:
                    # Final safety: resolved tree must stay under root.
                    path.resolve().relative_to(root)
                    shutil.rmtree(path)
                else:
                    path.unlink()
            except (OSError, ValueError) as exc:
                failed.append({"relativePath": rel, "error": str(exc)})
                continue
            self.store.delete_media_by_relative_paths([rel])
            if video_id:
                self.store.delete_media_ids([video_id])
            deleted.append(
                {
                    "relativePath": rel,
                    "kind": kind,
                    "videoId": video_id,
                    "label": rel.rstrip("/") + ("/" if kind == "dir" else ""),
                }
            )
        return {
            "status": "ok",
            "deleted": deleted,
            "missing": missing,
            "failed": failed,
            "deletedCount": len(deleted),
        }

    def open_local(self, video_id: str, reveal: bool = False) -> dict[str, Any]:
        path = self._resolve_media_by_id(video_id)
        if reveal:
            subprocess.run(["/usr/bin/open", "-R", str(path)], check=False)
        else:
            player = self.store.get_setting("player", self.player) or self.player
            app = PLAYERS.get(player)
            if app:
                proc = subprocess.run(
                    ["/usr/bin/open", "-a", app, str(path)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if proc.returncode != 0:
                    subprocess.run(["/usr/bin/open", str(path)], check=False)
            else:
                subprocess.run(["/usr/bin/open", str(path)], check=False)
        return {
            "status": "ok",
            "videoId": video_id,
            "relativePath": path.relative_to(self.video_dir.resolve()).as_posix(),
            "displayPath": self._display_path(str(path)),
            "reveal": bool(reveal),
        }

    def reveal_path(self, relative_path: str) -> dict[str, Any]:
        """Reveal a path-locked relative file/dir in Finder (selected/highlighted)."""
        rel = self._normalize_rel_path(relative_path)
        root = self._refresh_video_dir().resolve()
        path = root.joinpath(*Path(rel).parts)
        try:
            parent = path.parent.resolve()
            parent.relative_to(root)
        except (OSError, ValueError) as exc:
            raise ValueError("path escapes video root") from exc
        if not path.exists() and not path.is_symlink():
            raise FileNotFoundError(f"path missing: {rel}")
        if path.is_dir() and not path.is_symlink():
            path.resolve().relative_to(root)
            kind = "dir"
        else:
            kind = "file"
        # -R highlights the item in its parent folder (works for files and dirs).
        subprocess.run(["/usr/bin/open", "-R", str(path)], check=False)
        return {
            "status": "ok",
            "relativePath": rel,
            "kind": kind,
            "displayPath": self._display_path(str(path)),
        }

    def suggested_filename(self, video_id: str, title: str, ext: str = ".mp4") -> str:
        # Site-matching label + trailing videoId distinguisher:
        # `{seq}——{title}——{videoId}.mp4` (or `{title}——{videoId}.mp4` if no seq yet).
        seq_map = self.store.lookup_ordinals([video_id])
        seq = seq_map.get(video_id)
        return media_filename(video_id, title, seq=seq, ext=ext)

    def rename_media_to_ordinals(
        self, titles_by_id: Optional[dict[str, str]] = None
    ) -> dict[str, Any]:
        """Rename on-disk media to `{seq}——{bareTitle}——{videoId}{ext}` using ordinals.

        Prefer webpage titles from titles_by_id when present; otherwise keep the
        title embedded in the current filename / media DB row.

        Does not delete files. Skips rows without a seq or missing file.
        Two-phase rename avoids collisions when swapping names.
        """
        root = self._refresh_video_dir().resolve()
        media_rows = self.store.list_media()
        title_map = {
            str(k): str(v).strip()
            for k, v in (titles_by_id or {}).items()
            if str(k).strip() and str(v).strip()
        }
        if not media_rows:
            return {
                "status": "ok",
                "renamed": 0,
                "skipped": 0,
                "errors": [],
                "changes": [],
            }
        ids = [str(r["video_id"]) for r in media_rows]
        ordinals = self.store.lookup_ordinals(ids)
        planned: list[dict[str, Any]] = []
        errors: list[str] = []
        skipped = 0
        for row in media_rows:
            vid = str(row["video_id"])
            seq = ordinals.get(vid)
            if seq is None:
                skipped += 1
                continue
            abs_path = Path(str(row["absolute_path"]))
            try:
                real = abs_path.resolve()
                real.relative_to(root)
            except Exception:
                errors.append(f"{vid}: path escapes video root")
                continue
            if not real.is_file():
                errors.append(f"{vid}: file missing")
                continue
            ext = real.suffix.lower() or ".mp4"
            if ext not in VIDEO_EXTENSIONS:
                errors.append(f"{vid}: unsupported extension {ext}")
                continue
            web_title = title_map.get(vid) or ""
            if web_title and web_title != vid:
                bare = strip_ordinal_prefix(web_title)
            else:
                bare = strip_ordinal_prefix(
                    title_from_media_filename(real.name) or (row.get("title") or "") or "video"
                )
            if not bare:
                bare = "video"
            new_name = media_filename(vid, bare, seq=seq, ext=ext)
            if real.name == new_name:
                skipped += 1
                continue
            dest = (real.parent / new_name).resolve()
            try:
                dest.relative_to(root)
            except ValueError:
                errors.append(f"{vid}: destination escapes root")
                continue
            planned.append(
                {
                    "videoId": vid,
                    "seq": seq,
                    "from": str(real),
                    "to": str(dest),
                    "fromName": real.name,
                    "toName": new_name,
                    "relativePath": dest.relative_to(root).as_posix(),
                }
            )

        # Detect two media rows targeting the same final path.
        targets: dict[str, str] = {}
        for item in planned:
            key = item["to"]
            if key in targets:
                errors.append(
                    f"{item['videoId']}: target collision with {targets[key]}"
                )
                item["blocked"] = True
            else:
                targets[key] = item["videoId"]
        planned = [p for p in planned if not p.get("blocked")]

        # Phase 1: move to unique temps (skip if dest already is this file).
        temps: list[tuple[dict[str, Any], Path]] = []
        for item in planned:
            src = Path(item["from"])
            dest = Path(item["to"])
            if dest.exists() and dest.resolve() != src.resolve():
                errors.append(f"{item['videoId']}: target exists ({item['toName']})")
                continue
            tmp = src.with_name(f".hxyrule-ren-{item['videoId']}-{int(time.time()*1000)}{src.suffix}")
            try:
                src.rename(tmp)
                temps.append((item, tmp))
            except OSError as exc:
                errors.append(f"{item['videoId']}: temp rename failed ({exc})")

        # Phase 2: temps → final names + DB update.
        changes: list[dict[str, Any]] = []
        for item, tmp in temps:
            dest = Path(item["to"])
            try:
                tmp.rename(dest)
            except OSError as exc:
                # Best-effort restore.
                try:
                    tmp.rename(Path(item["from"]))
                except OSError:
                    pass
                errors.append(f"{item['videoId']}: final rename failed ({exc})")
                continue
            size = 0
            try:
                size = dest.stat().st_size
            except OSError:
                size = int(0)
            self.store.upsert_media(
                {
                    "video_id": item["videoId"],
                    "relative_path": item["relativePath"],
                    "absolute_path": str(dest),
                    "size": size,
                    "title": strip_ordinal_prefix(
                        title_from_media_filename(item["toName"])
                    ),
                }
            )
            changes.append(
                {
                    "videoId": item["videoId"],
                    "seq": item["seq"],
                    "from": item["fromName"],
                    "to": item["toName"],
                }
            )

        return {
            "status": "ok",
            "renamed": len(changes),
            "skipped": skipped,
            "errors": errors[:50],
            "errorCount": len(errors),
            "changes": changes[:100],
        }

    def _allowed_import_roots(self) -> list[Path]:
        roots = [
            (Path.home() / "Downloads").resolve(),
            self._refresh_video_dir().resolve(),
        ]
        # Chrome may nest under Downloads/HXYRULE/
        return roots

    def _assert_under_roots(self, path: Path, roots: list[Path]) -> Path:
        real = path.resolve()
        if not real.is_file():
            raise FileNotFoundError("source file not found")
        for root in roots:
            try:
                real.relative_to(root)
                return real
            except ValueError:
                continue
        raise ValueError("source path not under Downloads or video root")

    def import_download(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Move a completed Chrome download into the video root and index it."""
        with self._video_root_lock:
            return self._import_download_locked(payload)

    def _import_download_locked(self, payload: dict[str, Any]) -> dict[str, Any]:
        video_id = str(payload.get("videoId") or "").strip()
        if not VIDEO_ID_RE.fullmatch(video_id):
            raise ValueError("invalid videoId")
        filename = str(payload.get("filename") or "").strip().replace("\\", "/")
        if not filename or "/" in filename or filename in {".", ".."}:
            raise ValueError("filename must be a basename")
        if self._is_incomplete(Path(filename)):
            raise ValueError("incomplete filename")
        source_raw = str(payload.get("sourcePath") or "").strip()
        if not source_raw:
            raise ValueError("sourcePath required")
        source = self._assert_under_roots(Path(source_raw), self._allowed_import_roots())
        if self._is_incomplete(source) or source.stat().st_size <= 0:
            raise ValueError("source incomplete or empty")

        # Require size stability before move.
        size1 = source.stat().st_size
        time.sleep(0.4)
        size2 = source.stat().st_size
        if size1 != size2 or size2 <= 0:
            raise ValueError("source size not stable")

        root = self._refresh_video_dir().resolve()
        root.mkdir(parents=True, exist_ok=True)
        dest = (root / filename).resolve()
        try:
            dest.relative_to(root)
        except ValueError as exc:
            raise ValueError("destination escapes video root") from exc
        if dest.exists():
            if dest.stat().st_size > 0:
                # Chrome used to be forced into an HXYRULE/ child even when its
                # configured download directory already was the video root.
                # If that produced an exact-size duplicate, remove only the
                # redundant source after resolving and validating both paths.
                if source != dest:
                    if source.stat().st_size != dest.stat().st_size:
                        raise ValueError("destination conflict with different size")
                    source.unlink()
                # Already present; index existing.
                self.store.upsert_media(
                    {
                        "video_id": video_id,
                        "relative_path": filename,
                        "absolute_path": str(dest),
                        "size": dest.stat().st_size,
                        "title": str(payload.get("title") or ""),
                        "scanned_at": utc_now(),
                        "downloaded_at": utc_now(),
                    }
                )
                result = {
                    "status": "ok",
                    "videoId": video_id,
                    "relativePath": filename,
                    "displayPath": self._display_path(str(dest)),
                    "size": dest.stat().st_size,
                    "alreadyExisted": True,
                }
                result["removedPartials"] = self._cleanup_video_partials_locked(video_id)
                return result
            dest.unlink()

        try:
            source.replace(dest)
        except OSError:
            shutil.copy2(source, dest)
            try:
                source.unlink()
            except OSError:
                pass

        dest = dest.resolve()
        dest.relative_to(root)
        size = dest.stat().st_size
        if size <= 0:
            raise ValueError("empty destination")
        self.store.upsert_media(
            {
                "video_id": video_id,
                "relative_path": filename,
                "absolute_path": str(dest),
                "size": size,
                "title": str(payload.get("title") or ""),
                "scanned_at": utc_now(),
                "downloaded_at": utc_now(),
            }
        )
        result = {
            "status": "ok",
            "videoId": video_id,
            "relativePath": filename,
            "displayPath": self._display_path(str(dest)),
            "size": size,
            "alreadyExisted": False,
        }
        result["removedPartials"] = self._cleanup_video_partials_locked(video_id)
        return result

    def _cleanup_video_partials_locked(self, video_id: str) -> int:
        """Remove stale incomplete/empty files that mention this video id."""
        if not VIDEO_ID_RE.fullmatch(video_id):
            raise ValueError("invalid videoId")
        removed = 0
        id_token = re.compile(rf"(?<!\d){re.escape(video_id)}(?!\d)")
        for allowed_root in self._allowed_import_roots():
            if not allowed_root.is_dir():
                continue
            for partial in allowed_root.rglob("*"):
                try:
                    if not partial.is_file():
                        continue
                    real = partial.resolve()
                    real.relative_to(allowed_root)
                    if not self._is_discardable_failure_file(real):
                        continue
                    if not id_token.search(real.name):
                        continue
                    real.unlink()
                    removed += 1
                except (FileNotFoundError, OSError, ValueError):
                    continue
        return removed

    def _cleanup_exact_partials_locked(self, partial_paths: list[Any]) -> int:
        """Delete explicitly identified incomplete/empty Chrome artifacts under an allowed root."""
        removed = 0
        roots = self._allowed_import_roots()
        for raw in partial_paths[:40]:
            value = str(raw or "").strip()
            if not value:
                continue
            candidates = [value]
            lower_value = value.lower()
            if not any(lower_value.endswith(suf) for suf in INCOMPLETE_SUFFIXES):
                candidates.append(f"{value}.crdownload")
            for candidate in candidates:
                try:
                    partial = self._assert_under_roots(Path(candidate), roots)
                    # Incomplete suffix, or a zero-byte HXYRULE-named video
                    # (including Chrome uniquify `name (1).mp4` leftovers).
                    if not self._is_discardable_failure_file(partial):
                        continue
                    partial.unlink()
                    removed += 1
                except (FileNotFoundError, OSError, ValueError):
                    continue
        return removed

    def cleanup_video_partials(
        self, video_id: str, partial_paths: Optional[list[Any]] = None
    ) -> dict[str, Any]:
        """Delete exact Chrome partials, plus filename-addressable video partials."""
        with self._video_root_lock:
            exact_removed = self._cleanup_exact_partials_locked(partial_paths or [])
            matched_removed = self._cleanup_video_partials_locked(
                str(video_id or "").strip()
            )
            removed = exact_removed + matched_removed
        return {"status": "ok", "videoId": str(video_id), "removedPartials": removed}

    def _cleanup_orphan_failure_files_locked(self, keep_paths: list[Any]) -> int:
        """Delete stranded Unconfirmed*.crdownload and zero-byte named videos.

        Keep anything Chrome still reports as in_progress (may briefly be 0 bytes).
        """
        keep_resolved: set[Path] = set()
        keep_names: set[str] = set()
        roots = self._allowed_import_roots()
        for raw in keep_paths[:80]:
            value = str(raw or "").strip()
            if not value:
                continue
            keep_names.add(Path(value).name.lower())
            try:
                keep_resolved.add(self._assert_under_roots(Path(value), roots))
            except (FileNotFoundError, OSError, ValueError):
                # Keep-list entries may already be gone; basename still protects
                # a same-named in-progress file under another allowed root.
                continue
        removed = 0
        for allowed_root in roots:
            if not allowed_root.is_dir():
                continue
            for partial in allowed_root.rglob("*"):
                try:
                    if not partial.is_file():
                        continue
                    name = partial.name
                    is_unconfirmed = bool(UNCONFIRMED_INCOMPLETE_RE.fullmatch(name))
                    is_empty_named = self._is_empty_named_failure(partial)
                    if not is_unconfirmed and not is_empty_named:
                        continue
                    real = partial.resolve()
                    real.relative_to(allowed_root)
                    if real in keep_resolved or real.name.lower() in keep_names:
                        continue
                    real.unlink()
                    removed += 1
                except (FileNotFoundError, OSError, ValueError):
                    continue
        return removed

    def cleanup_orphan_unconfirmed(
        self, keep_paths: Optional[list[Any]] = None
    ) -> dict[str, Any]:
        """Sweep Unconfirmed incompletes and zero-byte HXYRULE-named videos."""
        with self._video_root_lock:
            removed = self._cleanup_orphan_failure_files_locked(keep_paths or [])
        return {"status": "ok", "removedPartials": removed}

    def register_download(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._video_root_lock:
            return self._register_download_locked(payload)

    def _register_download_locked(self, payload: dict[str, Any]) -> dict[str, Any]:
        video_id = str(payload.get("videoId") or "").strip()
        if not VIDEO_ID_RE.fullmatch(video_id):
            raise ValueError("invalid videoId")
        filename = str(payload.get("filename") or "").strip().replace("\\", "/")
        if not filename or "/" in filename or filename in {".", ".."}:
            raise ValueError("filename must be a basename")
        if self._is_incomplete(Path(filename)):
            raise ValueError("incomplete filename")
        root = self._refresh_video_dir().resolve()
        dest = (root / filename).resolve()
        try:
            dest.relative_to(root)
        except ValueError as exc:
            raise ValueError("path escapes video root") from exc
        if not dest.is_file():
            raise FileNotFoundError("final file not found")
        size = dest.stat().st_size
        if size <= 0:
            raise ValueError("empty file")
        self.store.upsert_media(
            {
                "video_id": video_id,
                "relative_path": filename,
                "absolute_path": str(dest),
                "size": size,
                "title": str(payload.get("title") or ""),
                "scanned_at": utc_now(),
                "downloaded_at": utc_now(),
            }
        )
        result = {
            "status": "ok",
            "videoId": video_id,
            "relativePath": filename,
            "displayPath": self._display_path(str(dest)),
            "size": size,
        }
        result["removedPartials"] = self._cleanup_video_partials_locked(video_id)
        return result

    def recover_partial_download(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Finish one interrupted Chrome partial via validated HTTP Range."""
        video_id = str(payload.get("videoId") or "").strip()
        if not VIDEO_ID_RE.fullmatch(video_id):
            raise ValueError("invalid videoId")
        filename = str(payload.get("filename") or "").strip().replace("\\", "/")
        partial_name = str(payload.get("partialName") or "").strip().replace("\\", "/")
        partial_path = str(payload.get("partialPath") or "").strip()
        if not filename or "/" in filename or self._is_incomplete(Path(filename)):
            raise ValueError("invalid final filename")
        if not partial_name or "/" in partial_name or not self._is_incomplete(Path(partial_name)):
            raise ValueError("invalid partial filename")
        source_url = str(payload.get("sourceUrl") or "").strip()
        parsed = urllib.parse.urlparse(source_url)
        if parsed.scheme != "https" or not parsed.hostname:
            raise ValueError("recovery URL must be HTTPS")
        if parsed.hostname.lower() in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("local recovery URL rejected")
        expected = int(payload.get("expectedSize") or 0)
        if expected <= 0:
            return {"status": "ok", "recovered": False, "reason": "unknown total size"}

        root = self._refresh_video_dir().resolve()
        # Prefer Chrome's actual absolute path. Basename-only lookup was wrong
        # when Chrome placed the partial below Downloads/HXYRULE or, with a
        # root already named HXYRULE, below HXYRULE/HXYRULE.
        dest = (root / filename).resolve()
        with self._video_root_lock:
            partial = (
                self._assert_under_roots(Path(partial_path), self._allowed_import_roots())
                if partial_path
                else (root / partial_name).resolve()
            )
            if not self._is_incomplete(partial):
                raise ValueError("partial path is not incomplete")
            dest.relative_to(root)
            if dest.is_file() and dest.stat().st_size == expected:
                return {"status": "ok", "recovered": True, "filename": filename, "size": expected}
            if not partial.is_file():
                return {"status": "ok", "recovered": False, "reason": "partial not found"}
            current = partial.stat().st_size
            if current <= 0 or current > expected:
                return {"status": "ok", "recovered": False, "reason": "invalid partial size"}
            if current < expected:
                req = urllib.request.Request(
                    source_url,
                    headers={"Range": f"bytes={current}-", "Accept-Encoding": "identity"},
                )
                try:
                    with urllib.request.urlopen(req, timeout=60) as resp:
                        if int(getattr(resp, "status", 0) or 0) != 206:
                            return {"status": "ok", "recovered": False, "reason": "range unsupported"}
                        content_range = str(resp.headers.get("Content-Range") or "")
                        match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+)", content_range.strip(), re.I)
                        if not match or int(match.group(1)) != current or int(match.group(3)) != expected:
                            return {"status": "ok", "recovered": False, "reason": "range mismatch"}
                        with partial.open("ab") as out:
                            shutil.copyfileobj(resp, out, length=1024 * 1024)
                            out.flush()
                            os.fsync(out.fileno())
                except Exception as exc:
                    return {
                        "status": "ok",
                        "recovered": False,
                        "reason": f"range request failed: {type(exc).__name__}",
                    }
            final_size = partial.stat().st_size
            if final_size != expected:
                return {"status": "ok", "recovered": False, "reason": "final size mismatch"}
            if dest.exists():
                return {"status": "ok", "recovered": False, "reason": "destination conflict"}
            partial.replace(dest)
            return {"status": "ok", "recovered": True, "filename": filename, "size": final_size}

    def health(self) -> dict[str, Any]:
        root = self._refresh_video_dir()
        return {
            "status": "ok",
            "localSessionId": self.session_id,
            "directory": str(root),
            "directoryExists": root.exists(),
            "player": self.store.get_setting("player", self.player),
            "lastScan": self.last_scan,
            "queue": {
                "paused": self.store.get_meta("queue_paused", "0") == "1",
            },
        }

    def settings_get(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "videoDir": self.video_dir_arg,
            "resolvedVideoDir": str(self._refresh_video_dir()),
            "player": self.store.get_setting("player", self.player),
            "localPreferPlayback": self.store.get_setting("local_prefer", "1") == "1",
            "showFullPath": self.store.get_setting("show_full_path", "1") == "1",
            "namingPattern": "{seq}——{sanitizedTitle}——{videoId}.{ext}",
            "lastScan": self.last_scan,
        }

    def settings_set(self, payload: dict[str, Any]) -> dict[str, Any]:
        if "player" in payload:
            player = str(payload.get("player") or "").strip().lower()
            if player not in PLAYERS:
                raise ValueError("invalid player")
            self.player = player
            self.store.set_setting("player", player)
        if "localPreferPlayback" in payload:
            self.store.set_setting(
                "local_prefer",
                "1" if bool(payload.get("localPreferPlayback")) else "0",
            )
        if "showFullPath" in payload:
            self.store.set_setting(
                "show_full_path",
                "1" if bool(payload.get("showFullPath")) else "0",
            )
        if "videoDir" in payload:
            # Only allow changing via install/settings file path already configured;
            # reject arbitrary absolute path updates from extension unless under /Volumes or home.
            raw = str(payload.get("videoDir") or "").strip()
            candidate = Path(raw).expanduser()
            resolved = candidate.resolve()
            home = Path.home().resolve()
            ok = False
            try:
                resolved.relative_to(home)
                ok = True
            except ValueError:
                if str(resolved).startswith("/Volumes/"):
                    ok = True
            if not ok:
                raise ValueError("videoDir must be under home or /Volumes")
            self.video_dir_arg = str(candidate)
            self.video_dir = resolved
            self.store.set_setting("video_dir", self.video_dir_arg)
        return self.settings_get()


def make_handler(helper: Helper):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _origin(self) -> str:
            return (self.headers.get("Origin") or "").rstrip("/")

        def _token_ok(self, body: Optional[dict] = None) -> bool:
            header = (self.headers.get("X-HXYRULE-Token") or "").strip()
            if header and secrets.compare_digest(header, helper.pairing_token):
                return True
            if body:
                body_token = str(body.get("token") or "").strip()
                if body_token and secrets.compare_digest(body_token, helper.pairing_token):
                    return True
            return False

        def _authorize(self, body: Optional[dict] = None, *, allow_empty_origin: bool = True):
            """
            Require pairing token always.
            - Matching chrome-extension Origin: OK
            - Empty Origin: OK only with valid token (some extension pages omit Origin
              on loopback fetches; websites do not know the token)
            - Any other Origin: reject
            """
            origin = self._origin()
            if origin and origin != helper.allowed_origin:
                return False, f"Origin not allowed (got {origin}, want {helper.allowed_origin})"
            if not origin and not allow_empty_origin:
                return False, "Origin required"
            if not self._token_ok(body):
                return False, "Invalid or missing pairing token"
            return True, ""

        def _cors(self):
            # Echo allowed origin when present; otherwise omit ACAO.
            origin = self._origin()
            if origin == helper.allowed_origin:
                self.send_header("Access-Control-Allow-Origin", helper.allowed_origin)
            elif not origin:
                # Token-authenticated same-machine calls without Origin.
                self.send_header("Access-Control-Allow-Origin", helper.allowed_origin)
            elif origin.startswith("chrome-extension://"):
                # Let the extension page read auth/origin error JSON instead of
                # an opaque browser "Failed to fetch" (still rejects the request).
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header(
                "Access-Control-Allow-Headers",
                "Content-Type, X-HXYRULE-Token",
            )
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")

        def _json(self, status: int, payload: dict[str, Any]):
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or "0")
            if length < 0 or length > MAX_BODY_BYTES:
                raise ValueError("request body too large")
            raw = self.rfile.read(length) if length else b"{}"
            if not raw:
                return {}
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("JSON object required")
            return data

        def do_OPTIONS(self):
            origin = self._origin()
            # Preflight: allow configured Origin, or empty Origin on loopback.
            if origin and origin != helper.allowed_origin:
                self._json(403, {"error": f"Origin not allowed (got {origin})"})
                return
            self._json(204, {})

        def do_GET(self):
            ok, reason = self._authorize()
            if not ok:
                self._json(403, {"error": reason})
                return
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path == "/health":
                self._json(200, helper.health())
                return
            if parsed.path == "/downloads/status":
                self._json(200, {"status": "ok", **helper.store.queue_snapshot()})
                return
            if parsed.path == "/settings":
                self._json(200, helper.settings_get())
                return
            self._json(404, {"error": "Not found"})

        def do_POST(self):
            try:
                body = self._read_json()
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
                return
            ok, reason = self._authorize(body)
            if not ok:
                self._json(403, {"error": reason})
                return

            path = urllib.parse.urlparse(self.path).path
            try:
                if path == "/scan":
                    self._json(200, helper.scan())
                    return
                if path == "/lookup":
                    ids = body.get("videoIds") or []
                    if not isinstance(ids, list) or len(ids) > 500:
                        raise ValueError("videoIds must be a list of up to 500 ids")
                    self._json(200, helper.lookup([str(x) for x in ids]))
                    return
                if path == "/ordinals/lookup":
                    ids = body.get("videoIds") or []
                    if not isinstance(ids, list) or len(ids) > 500:
                        raise ValueError("videoIds must be a list of up to 500 ids")
                    mapping = helper.store.lookup_ordinals([str(x) for x in ids])
                    self._json(200, {"status": "ok", "ordinals": mapping})
                    return
                if path == "/ordinals/by-seq":
                    try:
                        seq = int(body.get("seq"))
                    except (TypeError, ValueError):
                        raise ValueError("seq must be a positive integer") from None
                    result = helper.store.lookup_by_seq(seq)
                    self._json(200, {"status": "ok", **(result or {})})
                    return
                if path == "/ordinals/ensure":
                    items = body.get("items") or []
                    if not isinstance(items, list) or len(items) > 500:
                        raise ValueError("items must be a list of up to 500")
                    mapping = helper.store.ensure_ordinals(items)
                    self._json(200, {"status": "ok", "ordinals": mapping})
                    return
                if path == "/ordinals/rebuild":
                    ids = body.get("videoIds") or []
                    if not isinstance(ids, list) or not ids:
                        raise ValueError("videoIds must be a non-empty list")
                    if len(ids) > 20000:
                        raise ValueError("videoIds too long (max 20000)")
                    mapping = helper.store.rebuild_ordinals([str(x) for x in ids])
                    rename = bool(body.get("renameFiles"))
                    rename_result = None
                    if rename:
                        raw_titles = body.get("titles") or {}
                        titles_by_id = (
                            {
                                str(k): str(v)
                                for k, v in raw_titles.items()
                                if str(k).strip() and str(v).strip()
                            }
                            if isinstance(raw_titles, dict)
                            else {}
                        )
                        rename_result = helper.rename_media_to_ordinals(
                            titles_by_id=titles_by_id
                        )
                    self._json(
                        200,
                        {
                            "status": "ok",
                            "count": len(mapping),
                            "ordinals": mapping,
                            "rename": rename_result,
                        },
                    )
                    return
                if path == "/open":
                    self._json(
                        200,
                        helper.open_local(str(body.get("videoId") or ""), reveal=False),
                    )
                    return
                if path == "/reveal":
                    self._json(
                        200,
                        helper.open_local(str(body.get("videoId") or ""), reveal=True),
                    )
                    return
                if path == "/reveal-path":
                    self._json(
                        200,
                        helper.reveal_path(str(body.get("relativePath") or "")),
                    )
                    return
                if path == "/media/delete":
                    ids = body.get("videoIds") or []
                    if not isinstance(ids, list) or not ids or len(ids) > 500:
                        raise ValueError("videoIds must be a list of 1..500 ids")
                    self._json(200, helper.delete_media([str(x) for x in ids]))
                    return
                if path == "/media/list-orphans":
                    ids = body.get("keepVideoIds") or []
                    if not isinstance(ids, list):
                        raise ValueError("keepVideoIds must be a list")
                    if len(ids) > 20000:
                        raise ValueError("keepVideoIds too long (max 20000)")
                    self._json(
                        200, helper.list_orphans([str(x) for x in ids])
                    )
                    return
                if path == "/media/delete-paths":
                    paths = body.get("relativePaths") or []
                    if not isinstance(paths, list) or not paths or len(paths) > 500:
                        raise ValueError("relativePaths must be a list of 1..500 paths")
                    self._json(
                        200, helper.delete_paths([str(x) for x in paths])
                    )
                    return
                if path == "/downloads/enqueue":
                    items = body.get("items") or []
                    if not isinstance(items, list) or not items or len(items) > 500:
                        raise ValueError("items must be 1..500")
                    # Recompute sort keys: earlier favorite first.
                    # favoritePage desc, cardIndex desc => sort_key ascending with negative.
                    normalized = []
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        page = int(item.get("favoritePage") or 0)
                        card = int(item.get("cardIndex") or 0)
                        # Ascending sort_key => download earlier favorites first.
                        sort_key = -(page * 100000 + card)
                        if item.get("sortKey") is not None:
                            sort_key = int(item["sortKey"])
                        normalized.append({**item, "sortKey": sort_key})
                    result = helper.store.enqueue(normalized)
                    self._json(200, {"status": "ok", **result, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/claim":
                    item = helper.store.claim_next()
                    self._json(200, {"status": "ok", "item": item, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/progress":
                    item_id = int(body.get("id") or 0)
                    updated = helper.store.update_queue_item(
                        item_id,
                        status=str(body.get("status") or "downloading"),
                        error=str(body.get("error") or ""),
                        filename=str(body.get("filename") or ""),
                        quality=str(body.get("quality") or ""),
                        chromeDownloadId=body.get("chromeDownloadId"),
                    )
                    self._json(200, {"status": "ok", "item": updated, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/import":
                    imported = helper.import_download(body)
                    self._json(200, imported)
                    return
                if path == "/downloads/complete":
                    item_id = int(body.get("id") or 0)
                    # File should already be imported into the root.
                    reg = helper.register_download(body)
                    helper.store.update_queue_item(
                        item_id,
                        status="completed",
                        filename=reg["relativePath"],
                        finishedAt=utc_now(),
                        error="",
                    )
                    self._json(200, {"status": "ok", "registered": reg, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/fail":
                    item_id = int(body.get("id") or 0)
                    helper.store.update_queue_item(
                        item_id,
                        status="failed",
                        error=str(body.get("error") or "download failed")[:500],
                        finishedAt=utc_now(),
                    )
                    self._json(200, {"status": "ok", **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/cleanup-partials":
                    partial_paths = body.get("partialPaths") or []
                    if not isinstance(partial_paths, list) or len(partial_paths) > 20:
                        raise ValueError("partialPaths must be a list of up to 20 paths")
                    self._json(
                        200,
                        helper.cleanup_video_partials(
                            str(body.get("videoId") or ""), partial_paths
                        ),
                    )
                    return
                if path == "/downloads/cleanup-orphan-unconfirmed":
                    keep_paths = body.get("keepPaths") or []
                    if not isinstance(keep_paths, list) or len(keep_paths) > 80:
                        raise ValueError("keepPaths must be a list of up to 80 paths")
                    self._json(200, helper.cleanup_orphan_unconfirmed(keep_paths))
                    return
                if path == "/downloads/auto-retry":
                    item_id = int(body.get("id") or 0)
                    result = helper.store.retry_transient(
                        item_id, str(body.get("error") or "temporary network failure")
                    )
                    self._json(200, {"status": "ok", **result, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/pause":
                    helper.store.set_paused(True)
                    self._json(200, {"status": "ok", **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/resume":
                    helper.store.set_paused(False)
                    self._json(200, {"status": "ok", **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/retry":
                    item_id = int(body.get("id") or 0)
                    item = helper.store.get_queue_item(item_id)
                    if not item:
                        raise FileNotFoundError("queue item not found")
                    helper.store.update_queue_item(
                        item_id,
                        status="pending",
                        error="",
                        finishedAt=None,
                        chromeDownloadId=None,
                        retryCount=0,
                        retryAt=None,
                    )
                    helper.store.set_paused(False)
                    self._json(200, {"status": "ok", **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/queue/list":
                    self._json(200, {"status": "ok", **helper.store.queue_list(body)})
                    return
                if path == "/downloads/queue/pause":
                    ids = body.get("ids") if isinstance(body, dict) else None
                    result = helper.store.queue_pause_live(ids)
                    self._json(200, {"status": "ok", **result, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/queue/resume":
                    ids = body.get("ids") if isinstance(body, dict) else None
                    result = helper.store.queue_resume_paused(ids)
                    self._json(200, {"status": "ok", **result, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/queue/remove":
                    result = helper.store.queue_remove(int(body.get("id") or 0))
                    self._json(200, {"status": "ok", **result, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/queue/reorder":
                    result = helper.store.queue_reorder(body.get("ids") or [])
                    self._json(200, {"status": "ok", **result, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/cancel":
                    n = helper.store.cancel_remaining()
                    self._json(200, {"status": "ok", "cancelled": n, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/clear-finished":
                    n = helper.store.clear_finished_queue()
                    self._json(200, {"status": "ok", "cleared": n, **helper.store.queue_snapshot()})
                    return
                if path == "/downloads/suggest-filename":
                    name = helper.suggested_filename(
                        str(body.get("videoId") or ""),
                        str(body.get("title") or ""),
                        str(body.get("ext") or ".mp4"),
                    )
                    self._json(200, {"status": "ok", "filename": name})
                    return
                if path == "/downloads/recover-partial":
                    self._json(200, helper.recover_partial_download(body))
                    return
                if path == "/settings":
                    self._json(200, helper.settings_set(body))
                    return
                if path == "/maintenance/clear-stale":
                    n = helper.store.clear_stale_media()
                    self._json(200, {"status": "ok", "removed": n})
                    return
                if path == "/maintenance/open-logs":
                    log_path = Path.home() / "Library" / "Logs" / "HXYRULEHelper.log"
                    log_path.parent.mkdir(parents=True, exist_ok=True)
                    log_path.touch(exist_ok=True)
                    subprocess.run(["/usr/bin/open", "-R", str(log_path)], check=False)
                    self._json(200, {"status": "ok", "logPath": str(log_path)})
                    return
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
                return
            except FileNotFoundError as exc:
                self._json(404, {"error": str(exc)})
                return
            except PermissionError as exc:
                self._json(403, {"error": str(exc)})
                return
            except Exception as exc:
                print(f"[hxyrule-helper] error: {exc!r}", flush=True)
                self._json(500, {"error": "internal error"})
                return
            self._json(404, {"error": "Not found"})

        def log_message(self, fmt, *args):
            # Never log query strings that might contain tokens.
            print("[hxyrule-helper] " + (fmt % args), flush=True)

    return Handler


def load_or_create_token(path: Path) -> str:
    if path.is_file():
        token = path.read_text(encoding="utf-8").strip()
        if len(token) >= 24:
            return token
    token = secrets.token_urlsafe(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(token + "\n", encoding="utf-8")
    os.chmod(path, 0o600)
    return token


def main():
    parser = argparse.ArgumentParser(description="HXYRULE local Mac Helper")
    parser.add_argument(
        "--video-dir",
        default=os.getenv("HXYRULE_VIDEO_DIR", "/Volumes/External/HXYRULE"),
    )
    parser.add_argument("--origin", default=os.getenv("HXYRULE_ORIGIN", ""))
    parser.add_argument("--port", type=int, default=int(os.getenv("HXYRULE_PORT", DEFAULT_PORT)))
    parser.add_argument("--player", default=os.getenv("HXYRULE_PLAYER", "iina"))
    parser.add_argument(
        "--support-dir",
        default=os.getenv(
            "HXYRULE_SUPPORT_DIR",
            str(Path.home() / "Library" / "Application Support" / "HXYRULE"),
        ),
    )
    parser.add_argument("--token-file", default="")
    args = parser.parse_args()
    if not args.origin or not args.origin.startswith("chrome-extension://"):
        parser.error("--origin must be a chrome-extension:// URL")

    support_dir = Path(args.support_dir).expanduser()
    token_file = Path(args.token_file) if args.token_file else support_dir / "pairing.token"
    token = load_or_create_token(token_file)

    # Ensure video dir exists when possible (external volume may be absent).
    video_dir = Path(args.video_dir).expanduser()
    try:
        video_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"[hxyrule-helper] video dir not ready: {exc!r}", flush=True)

    helper = Helper(
        video_dir=video_dir,
        allowed_origin=args.origin,
        pairing_token=token,
        support_dir=support_dir,
        player=args.player,
    )
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(helper))
    print(f"HXYRULE Mac helper listening on http://127.0.0.1:{args.port}", flush=True)
    print(f"Video folder: {helper.video_dir}", flush=True)
    print(f"Allowed origin: {helper.allowed_origin}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
