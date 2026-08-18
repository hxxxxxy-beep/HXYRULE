#!/usr/bin/env python3
import importlib.util
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.client import HTTPConnection
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = ROOT / "mac-helper" / "hxyrule_mac_helper.py"


def load_helper_module():
    spec = importlib.util.spec_from_file_location("hxyrule_mac_helper", HELPER_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class HelperCoreTests(unittest.TestCase):
    def setUp(self):
        self.mod = load_helper_module()
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "HXYRULE"
        self.root.mkdir()
        self.support = Path(self.tmp.name) / "support"
        self.origin = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"
        self.token = "test-token-" + ("x" * 40)
        self.helper = self.mod.Helper(
            video_dir=self.root,
            allowed_origin=self.origin,
            pairing_token=self.token,
            support_dir=self.support,
            player="system",
        )
        self.server = self.mod.ThreadingHTTPServer(
            ("127.0.0.1", 0), self.mod.make_handler(self.helper)
        )
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def _req(self, method, path, body=None, origin=None, token=None, expect_json=True):
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=data,
            method=method,
            headers={
                "Content-Type": "application/json",
                "Origin": origin if origin is not None else self.origin,
                "X-HXYRULE-Token": token if token is not None else self.token,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                raw = resp.read()
                return resp.status, json.loads(raw.decode("utf-8")) if expect_json else raw
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            return exc.code, payload

    def test_allows_empty_origin_with_valid_token(self):
        # Extension options pages may omit Origin on loopback fetches.
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", "/health", headers={"X-HXYRULE-Token": self.token})
        resp = conn.getresponse()
        body = json.loads(resp.read().decode("utf-8"))
        self.assertEqual(resp.status, 200, body)
        self.assertEqual(body.get("status"), "ok")
        conn.close()

    def test_rejects_foreign_origin_even_with_token(self):
        status, payload = self._req(
            "GET",
            "/health",
            origin="https://evil.example",
            token=self.token,
        )
        self.assertEqual(status, 403)
        self.assertIn("Origin not allowed", payload.get("error", ""))

    def test_rejects_wrong_token(self):
        status, payload = self._req("GET", "/health", token="wrong")
        self.assertEqual(status, 403)
        self.assertIn("error", payload)

    def test_scan_matches_video_id_filename(self):
        # Legacy prefix form still works.
        f = self.root / "3105205__sample_title.mp4"
        f.write_bytes(b"0" * 2048)
        # Current form: `{seq}——{title}——{videoId}.mp4`
        f2 = self.root / "138——Ahri Lux Throating [Iidssm]——9988776.mp4"
        f2.write_bytes(b"0" * 2048)
        (self.root / "no_id_video.mp4").write_bytes(b"0" * 1024)
        (self.root / "3105205__partial.mp4.crdownload").write_bytes(b"0" * 4096)
        status, payload = self._req("POST", "/scan", body={})
        self.assertEqual(status, 200)
        self.assertEqual(payload["matchedCount"], 2)
        self.assertIn("3105205", payload["matches"])
        self.assertIn("9988776", payload["matches"])
        # Ordinal 138 must NOT be treated as video id.
        self.assertNotIn("138", payload["matches"])
        status, lookup = self._req(
            "POST", "/lookup", body={"videoIds": ["3105205", "9988776", "999"]}
        )
        self.assertTrue(lookup["results"]["3105205"]["exists"])
        self.assertTrue(lookup["results"]["9988776"]["exists"])
        self.assertFalse(lookup["results"]["999"]["exists"])

    def test_path_escape_open_by_id_only(self):
        # Create outside file and try to trick via absolute path fields — open only accepts videoId.
        outside = Path(self.tmp.name) / "secret.txt"
        outside.write_text("secret", encoding="utf-8")
        status, payload = self._req("POST", "/open", body={"videoId": "../secret"})
        self.assertEqual(status, 400)

    def test_import_rejects_outside_downloads(self):
        outside = Path(self.tmp.name) / "evil.mp4"
        outside.write_bytes(b"0" * 1500)
        status, payload = self._req(
            "POST",
            "/downloads/import",
            body={
                "videoId": "123",
                "filename": "123__x.mp4",
                "sourcePath": str(outside),
            },
        )
        self.assertEqual(status, 400)

    def test_queue_order_earliest_favorite_first(self):
        items = [
            {"videoId": "1", "title": "new", "favoritePage": 1, "cardIndex": 0},
            {"videoId": "2", "title": "mid", "favoritePage": 3, "cardIndex": 1},
            {"videoId": "3", "title": "old", "favoritePage": 8, "cardIndex": 5},
            {"videoId": "4", "title": "same-page-later", "favoritePage": 8, "cardIndex": 9},
        ]
        # normalize like API
        normalized = []
        for item in items:
            page = item["favoritePage"]
            card = item["cardIndex"]
            normalized.append({**item, "sortKey": -(page * 100000 + card)})
        status, payload = self._req("POST", "/downloads/enqueue", body={"items": normalized})
        self.assertEqual(status, 200)
        self.assertEqual(payload["added"], 4)
        # claim should get page 8 card 9 first
        status, claim = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(claim["item"]["videoId"], "4")
        self.helper.store.update_queue_item(claim["item"]["id"], status="completed", finishedAt=int(time.time()))
        status, claim2 = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(claim2["item"]["videoId"], "3")

    def test_queue_allows_six_concurrent_claims(self):
        items = [
            {
                "videoId": str(i),
                "title": f"t{i}",
                "favoritePage": 1,
                "cardIndex": i,
                "sortKey": -i,
            }
            for i in range(1, 9)
        ]
        status, payload = self._req("POST", "/downloads/enqueue", body={"items": items})
        self.assertEqual(status, 200)
        self.assertEqual(payload["added"], 8)
        claimed = []
        for _ in range(6):
            status, claim = self._req("POST", "/downloads/claim", body={})
            self.assertEqual(status, 200, claim)
            self.assertIsNotNone(claim.get("item"))
            claimed.append(claim["item"])
        status, blocked = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(status, 200, blocked)
        self.assertIsNone(blocked.get("item"))
        # Free one slot → another claim succeeds.
        self.helper.store.update_queue_item(
            claimed[0]["id"], status="completed", finishedAt=int(time.time())
        )
        status, claim7 = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(status, 200, claim7)
        self.assertIsNotNone(claim7.get("item"))
        self.assertNotEqual(claim7["item"]["videoId"], claimed[0]["videoId"])

    def test_duplicate_video_ids_cannot_be_downloading_together(self):
        now = int(time.time())
        with self.helper.store._lock:
            self.helper.store._conn.execute(
                "INSERT INTO download_queue(video_id, title, sort_key, status, created_at) "
                "VALUES ('777', 'first', 1, 'pending', ?)",
                (now,),
            )
            self.helper.store._conn.execute(
                "INSERT INTO download_queue(video_id, title, sort_key, status, created_at) "
                "VALUES ('777', 'duplicate', 2, 'pending', ?)",
                (now,),
            )
            self.helper.store._conn.commit()

        first = self.helper.store.claim_next()
        self.assertEqual(first["videoId"], "777")
        self.assertIsNone(self.helper.store.claim_next())

    def test_transient_failures_retry_with_backoff_then_isolate_failure(self):
        status, payload = self._req(
            "POST",
            "/downloads/enqueue",
            body={
                "items": [{"videoId": "901", "title": "retry me", "sortKey": -2}]
            },
        )
        self.assertEqual(status, 200, payload)
        status, claim = self._req("POST", "/downloads/claim", body={})
        item_id = claim["item"]["id"]

        for expected_count, expected_delay in enumerate((5, 15, 30), start=1):
            status, retried = self._req(
                "POST",
                "/downloads/auto-retry",
                body={"id": item_id, "error": "Chrome download interrupted"},
            )
            self.assertEqual(status, 200, retried)
            self.assertTrue(retried["scheduled"])
            self.assertEqual(retried["retryCount"], expected_count)
            self.assertEqual(retried["delaySeconds"], expected_delay)
            self.assertFalse(retried["paused"])
            # A future retry must not be claimed early.
            status, early = self._req("POST", "/downloads/claim", body={})
            self.assertIsNone(early.get("item"))
            self.helper.store.update_queue_item(item_id, retryAt=int(time.time()) - 1)
            status, claim = self._req("POST", "/downloads/claim", body={})
            self.assertEqual(claim["item"]["id"], item_id)

        status, exhausted = self._req(
            "POST",
            "/downloads/auto-retry",
            body={"id": item_id, "error": "Chrome download interrupted"},
        )
        self.assertEqual(status, 200, exhausted)
        self.assertFalse(exhausted["scheduled"])
        self.assertTrue(exhausted["exhausted"])
        self.assertFalse(exhausted["paused"])
        self.assertEqual(exhausted["counts"]["failed"], 1)
        # An exhausted item must not prevent unrelated pending work from claiming.
        status, added = self._req(
            "POST",
            "/downloads/enqueue",
            body={"items": [{"videoId": "902", "title": "keep going"}]},
        )
        self.assertEqual(status, 200, added)
        status, next_claim = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(status, 200, next_claim)
        self.assertEqual(next_claim["item"]["videoId"], "902")

    def test_permanent_failure_does_not_pause_other_queue_items(self):
        status, payload = self._req(
            "POST",
            "/downloads/enqueue",
            body={
                "items": [
                    {"videoId": "911", "title": "bad", "sortKey": -2},
                    {"videoId": "912", "title": "good", "sortKey": -1},
                ]
            },
        )
        self.assertEqual(status, 200, payload)
        status, first = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(first["item"]["videoId"], "911")
        status, failed = self._req(
            "POST",
            "/downloads/fail",
            body={"id": first["item"]["id"], "error": "detail page HTTP 404"},
        )
        self.assertEqual(status, 200, failed)
        self.assertFalse(failed["paused"])
        status, second = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(second["item"]["videoId"], "912")

    def test_symlink_escape_rejected_on_scan(self):
        outside_dir = Path(self.tmp.name) / "outside"
        outside_dir.mkdir()
        target = outside_dir / "999999__escaped.mp4"
        target.write_bytes(b"0" * 2048)
        link = self.root / "999999__escaped.mp4"
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest("symlink not permitted")
        status, payload = self._req("POST", "/scan", body={})
        self.assertEqual(status, 200)
        # resolved path escapes root -> should not match
        self.assertNotIn("999999", payload.get("matches") or {})

    def test_ordinals_stable_across_deletes(self):
        status, first = self._req(
            "POST",
            "/ordinals/ensure",
            body={
                "items": [
                    {"videoId": "100", "preferredSeq": 1},
                    {"videoId": "200", "preferredSeq": 2},
                    {"videoId": "300", "preferredSeq": 3},
                ]
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(first["ordinals"]["100"], 1)
        self.assertEqual(first["ordinals"]["200"], 2)
        self.assertEqual(first["ordinals"]["300"], 3)
        # "Delete" 200 from favorites — ordinals row must remain; no renumber.
        status, again = self._req(
            "POST",
            "/ordinals/ensure",
            body={"items": [{"videoId": "100", "preferredSeq": 1}, {"videoId": "300", "preferredSeq": 2}]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(again["ordinals"]["100"], 1)
        self.assertEqual(again["ordinals"]["300"], 3)
        # New favorite prefers 2 (gap) if free — 2 is still held by deleted 200, so max+1.
        status, nxt = self._req(
            "POST",
            "/ordinals/ensure",
            body={"items": [{"videoId": "400", "preferredSeq": 2}]},
        )
        self.assertEqual(status, 200)
        # preferred 2 still reserved by video 200 → assign 4
        self.assertEqual(nxt["ordinals"]["400"], 4)
        status, looked = self._req(
            "POST", "/ordinals/lookup", body={"videoIds": ["100", "200", "300", "400"]}
        )
        self.assertEqual(status, 200)
        self.assertEqual(looked["ordinals"]["200"], 2)

    def test_ordinals_ensure_oldest_first_when_preferred_taken(self):
        # Stale low seqs from a wiped library must not reverse a newest-first page.
        self._req(
            "POST",
            "/ordinals/ensure",
            body={
                "items": [
                    {"videoId": "1", "preferredSeq": 1},
                    {"videoId": "2", "preferredSeq": 2},
                    {"videoId": "3", "preferredSeq": 3},
                    {"videoId": "4", "preferredSeq": 4},
                ]
            },
        )
        # Site order: newest → oldest. preferred 4…1 are all still reserved.
        status, payload = self._req(
            "POST",
            "/ordinals/ensure",
            body={
                "items": [
                    {"videoId": "40", "preferredSeq": 4},
                    {"videoId": "30", "preferredSeq": 3},
                    {"videoId": "20", "preferredSeq": 2},
                    {"videoId": "10", "preferredSeq": 1},
                ]
            },
        )
        self.assertEqual(status, 200, payload)
        # Oldest (10) → smallest new seq; newest (40) → largest.
        self.assertEqual(payload["ordinals"]["10"], 5)
        self.assertEqual(payload["ordinals"]["20"], 6)
        self.assertEqual(payload["ordinals"]["30"], 7)
        self.assertEqual(payload["ordinals"]["40"], 8)

    def test_ordinals_ensure_newest_first_without_preferred(self):
        status, payload = self._req(
            "POST",
            "/ordinals/ensure",
            body={
                "items": [
                    {"videoId": "40"},
                    {"videoId": "30"},
                    {"videoId": "20"},
                    {"videoId": "10"},
                ]
            },
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["ordinals"]["10"], 1)
        self.assertEqual(payload["ordinals"]["20"], 2)
        self.assertEqual(payload["ordinals"]["30"], 3)
        self.assertEqual(payload["ordinals"]["40"], 4)

    def test_ordinals_ensure_ignores_preferred_gaps_after_cold_start(self):
        # After a library exists, preferred must not fill mid-range gaps (2563…).
        self._req(
            "POST",
            "/ordinals/ensure",
            body={
                "items": [
                    {"videoId": "100", "preferredSeq": 1},
                    {"videoId": "200", "preferredSeq": 2},
                    {"videoId": "300", "preferredSeq": 3},
                ]
            },
        )
        status, payload = self._req(
            "POST",
            "/ordinals/ensure",
            body={
                "items": [
                    {"videoId": "40", "preferredSeq": 10},
                    {"videoId": "30", "preferredSeq": 9},
                ]
            },
        )
        self.assertEqual(status, 200, payload)
        # Newest-first DOM [40,30] → oldest-first max+1: 30=4, 40=5.
        self.assertEqual(payload["ordinals"]["30"], 4)
        self.assertEqual(payload["ordinals"]["40"], 5)

    def test_ordinals_claim_newest_refavorite_gets_max(self):
        self._req(
            "POST",
            "/ordinals/rebuild",
            body={"videoIds": ["40", "30", "20", "10"], "renameFiles": False},
        )
        # 10 is oldest (seq 1). Refavorite as newest must bump to max+1.
        status, payload = self._req(
            "POST",
            "/ordinals/claim-newest",
            body={"videoIds": ["10"]},
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["ordinals"]["10"], 5)
        status, looked = self._req(
            "POST", "/ordinals/lookup", body={"videoIds": ["10", "40", "30"]}
        )
        self.assertEqual(status, 200)
        self.assertEqual(looked["ordinals"]["10"], 5)
        self.assertEqual(looked["ordinals"]["40"], 4)
        self.assertEqual(looked["ordinals"]["30"], 3)
        # Batch claim: newest-first ids → highest seq on first id.
        status, batch = self._req(
            "POST",
            "/ordinals/claim-newest",
            body={"videoIds": ["99", "88"]},
        )
        self.assertEqual(status, 200, batch)
        self.assertEqual(batch["ordinals"]["88"], 6)
        self.assertEqual(batch["ordinals"]["99"], 7)

    def test_ordinals_realign_repairs_reversed_batch(self):
        # Simulate newest-first DOM ensure that assigned max+1 in the wrong order.
        self._req(
            "POST",
            "/ordinals/ensure",
            body={
                "items": [
                    {"videoId": "40", "preferredSeq": 4},
                    {"videoId": "30", "preferredSeq": 3},
                    {"videoId": "20", "preferredSeq": 2},
                    {"videoId": "10", "preferredSeq": 1},
                ]
            },
        )
        # Force a reversed assignment via rebuild then manual ensure overwrite path:
        # rebuild newest-first gives 40=4…10=1 (correct). Seed reversed with raw SQL-like
        # second ensure after wipe: assign 40=1… by rebuilding opposite list.
        self._req(
            "POST",
            "/ordinals/rebuild",
            body={"videoIds": ["10", "20", "30", "40"], "renameFiles": False},
        )
        # Now 10=4 (wrong: 10 is oldest in true favorites order). Realign with
        # preferred oldest=1 using newest-first preferred ranks.
        status, payload = self._req(
            "POST",
            "/ordinals/realign",
            body={
                "items": [
                    {"videoId": "40", "preferredSeq": 4},
                    {"videoId": "30", "preferredSeq": 3},
                    {"videoId": "20", "preferredSeq": 2},
                    {"videoId": "10", "preferredSeq": 1},
                ]
            },
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["ordinals"]["10"], 1)
        self.assertEqual(payload["ordinals"]["20"], 2)
        self.assertEqual(payload["ordinals"]["30"], 3)
        self.assertEqual(payload["ordinals"]["40"], 4)
        # Idempotent when already aligned.
        status2, payload2 = self._req(
            "POST",
            "/ordinals/realign",
            body={
                "items": [
                    {"videoId": "40", "preferredSeq": 4},
                    {"videoId": "30", "preferredSeq": 3},
                    {"videoId": "20", "preferredSeq": 2},
                    {"videoId": "10", "preferredSeq": 1},
                ]
            },
        )
        self.assertEqual(status2, 200, payload2)
        self.assertEqual(payload2["ordinals"]["10"], 1)
        self.assertEqual(payload2["ordinals"]["40"], 4)

    def test_ordinals_by_seq(self):
        self._req(
            "POST",
            "/ordinals/rebuild",
            body={"videoIds": ["30", "20", "10"], "renameFiles": False},
        )
        status, hit = self._req("POST", "/ordinals/by-seq", body={"seq": 1})
        self.assertEqual(status, 200, hit)
        self.assertTrue(hit["found"])
        self.assertEqual(hit["videoId"], "10")
        self.assertEqual(hit["maxSeq"], 3)
        status, miss = self._req("POST", "/ordinals/by-seq", body={"seq": 99})
        self.assertEqual(status, 200, miss)
        self.assertFalse(miss["found"])
        self.assertIsNone(miss["videoId"])

    def test_ordinals_rebuild_newest_first_oldest_is_one(self):
        # Newest-first crawl order: g,f,e,...,a → a gets 1, g gets 7.
        ids = ["7", "6", "5", "4", "3", "2", "1"]
        status, payload = self._req(
            "POST",
            "/ordinals/rebuild",
            body={"videoIds": ids, "renameFiles": False},
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["count"], 7)
        self.assertEqual(payload["ordinals"]["1"], 1)
        self.assertEqual(payload["ordinals"]["7"], 7)
        self.assertEqual(payload["ordinals"]["4"], 4)
        # Rebuild replaces prior ensure data entirely.
        status, _ = self._req(
            "POST",
            "/ordinals/ensure",
            body={"items": [{"videoId": "999", "preferredSeq": 1}]},
        )
        self.assertEqual(status, 200)
        status, payload2 = self._req(
            "POST",
            "/ordinals/rebuild",
            body={"videoIds": ["30", "20", "10"], "renameFiles": False},
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload2["ordinals"]["10"], 1)
        self.assertEqual(payload2["ordinals"]["20"], 2)
        self.assertEqual(payload2["ordinals"]["30"], 3)
        status, looked = self._req(
            "POST", "/ordinals/lookup", body={"videoIds": ["999", "1", "10"]}
        )
        self.assertEqual(status, 200)
        self.assertNotIn("999", looked["ordinals"])
        self.assertNotIn("1", looked["ordinals"])
        self.assertEqual(looked["ordinals"]["10"], 1)

    def test_rename_media_to_ordinals(self):
        # Wrong / missing prefixes should be fixed without deleting files.
        f1 = self.root / "10__Old Title.mp4"
        f2 = self.root / "20__9——Keep Me.mp4"
        f1.write_bytes(b"aaa")
        f2.write_bytes(b"bbbb")
        self.helper.store.replace_media(
            [
                {
                    "video_id": "10",
                    "relative_path": f1.name,
                    "absolute_path": str(f1),
                    "size": 3,
                    "title": "Old Title",
                },
                {
                    "video_id": "20",
                    "relative_path": f2.name,
                    "absolute_path": str(f2),
                    "size": 4,
                    "title": "Keep Me",
                },
            ]
        )
        status, rebuilt = self._req(
            "POST",
            "/ordinals/rebuild",
            body={"videoIds": ["20", "10"], "renameFiles": True},
        )
        self.assertEqual(status, 200, rebuilt)
        self.assertEqual(rebuilt["ordinals"]["10"], 1)
        self.assertEqual(rebuilt["ordinals"]["20"], 2)
        rename = rebuilt.get("rename") or {}
        self.assertEqual(rename.get("renamed"), 2)
        self.assertTrue((self.root / "1——Old Title——10.mp4").is_file())
        self.assertTrue((self.root / "2——Keep Me——20.mp4").is_file())
        self.assertFalse(f1.exists())
        self.assertFalse(f2.exists())

    def test_rename_uses_web_titles_over_local_abbrev(self):
        f1 = self.root / "99——Y——3524508.mp4"
        f1.write_bytes(b"data")
        self.helper.store.replace_media(
            [
                {
                    "video_id": "3524508",
                    "relative_path": f1.name,
                    "absolute_path": str(f1),
                    "size": 4,
                    "title": "Y",
                }
            ]
        )
        status, rebuilt = self._req(
            "POST",
            "/ordinals/rebuild",
            body={
                "videoIds": ["3524508"],
                "renameFiles": True,
                "titles": {"3524508": "Y'shtola & Zero Long"},
            },
        )
        self.assertEqual(status, 200, rebuilt)
        self.assertEqual(rebuilt["ordinals"]["3524508"], 1)
        rename = rebuilt.get("rename") or {}
        self.assertEqual(rename.get("renamed"), 1)
        expected = "1——Y'shtola & Zero Long——3524508.mp4"
        self.assertTrue((self.root / expected).is_file(), list(self.root.iterdir()))
        self.assertFalse(f1.exists())

    def test_sanitize_keeps_ordinal_emdash(self):
        name = self.mod.sanitize_title("2311——Catching A Maid In Her Duty [mdf an]")
        self.assertIn("2311", name)
        self.assertIn("——", name)
        self.assertIn("Catching", name)

    def test_sanitize_keeps_apostrophe_and_ampersand(self):
        name = self.mod.sanitize_title("Y'shtola & Zero Long")
        self.assertEqual(name, "Y'shtola & Zero Long")
        blocked = self.mod.sanitize_title('a/b:c*?"<>|d')
        self.assertNotIn("/", blocked)
        self.assertNotIn(":", blocked)
        self.assertNotIn("*", blocked)

    def test_suggested_filename_injects_ordinal(self):
        status, ensured = self._req(
            "POST",
            "/ordinals/ensure",
            body={"items": [{"videoId": "3105205", "preferredSeq": 138}]},
        )
        self.assertEqual(status, 200, ensured)
        self.assertEqual(ensured["ordinals"]["3105205"], 138)
        # Bare title → `{seq}——{title}——{videoId}.mp4`
        status, payload = self._req(
            "POST",
            "/downloads/suggest-filename",
            body={
                "videoId": "3105205",
                "title": "Ahri Lux Throating [Iidssm]",
                "ext": ".mp4",
            },
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(
            payload["filename"],
            "138——Ahri Lux Throating [Iidssm]——3105205.mp4",
        )
        # Title that already has an ordinal must not double-prefix.
        status, again = self._req(
            "POST",
            "/downloads/suggest-filename",
            body={
                "videoId": "3105205",
                "title": "138——Ahri Lux Throating [Iidssm]",
                "ext": ".mp4",
            },
        )
        self.assertEqual(status, 200, again)
        self.assertEqual(again["filename"], payload["filename"])
        # Unknown id: no seq, still append distinguisher for Scan.
        status, bare = self._req(
            "POST",
            "/downloads/suggest-filename",
            body={"videoId": "9999999", "title": "No Ordinal Yet", "ext": ".mp4"},
        )
        self.assertEqual(status, 200, bare)
        self.assertEqual(bare["filename"], "No Ordinal Yet——9999999.mp4")

    def test_recover_complete_partial_promotes_without_second_download(self):
        final_name = "17——Title——123.mp4"
        partial_name = final_name + ".crdownload"
        payload = b"already fully received"
        (self.root / partial_name).write_bytes(payload)

        recovered = self.helper.recover_partial_download(
            {
                "videoId": "123",
                "filename": final_name,
                "partialName": partial_name,
                "sourceUrl": "https://cdn.example.test/video.mp4",
                "expectedSize": len(payload),
            }
        )

        self.assertTrue(recovered["recovered"])
        self.assertEqual((self.root / final_name).read_bytes(), payload)
        self.assertFalse((self.root / partial_name).exists())

    def test_recover_uses_actual_nested_chrome_partial_path(self):
        final_name = "18——Nested——124.mp4"
        nested = self.root / "HXYRULE"
        nested.mkdir()
        partial = nested / f"{final_name}.crdownload"
        payload = b"complete nested Chrome partial"
        partial.write_bytes(payload)

        recovered = self.helper.recover_partial_download(
            {
                "videoId": "124",
                "filename": final_name,
                "partialName": partial.name,
                "partialPath": str(partial),
                "sourceUrl": "https://cdn.example.test/video.mp4",
                "expectedSize": len(payload),
            }
        )

        self.assertTrue(recovered["recovered"])
        self.assertEqual((self.root / final_name).read_bytes(), payload)
        self.assertFalse(partial.exists())

    def test_completed_import_cleans_only_same_video_partials(self):
        video_id = "124"
        final_name = "18——Nested——124.mp4"
        source = self.root / "chrome-complete.mp4"
        source.write_bytes(b"complete download")
        same_id = self.root / f"{final_name}.crdownload"
        same_id.write_bytes(b"failed attempt")
        other_id = self.root / "19——Other——1240.mp4.crdownload"
        other_id.write_bytes(b"keep this")

        result = self.helper.import_download(
            {
                "videoId": video_id,
                "filename": final_name,
                "sourcePath": str(source),
            }
        )

        self.assertEqual(result["removedPartials"], 1)
        self.assertFalse(same_id.exists())
        self.assertTrue(other_id.exists())

    def test_terminal_cleanup_removes_only_requested_video_partials(self):
        target = self.root / "Title——124.mp4.crdownload"
        conflict_copy = self.root / "Title——124.mp4 (1).crdownload"
        other = self.root / "Title——1240.mp4.crdownload"
        target.write_bytes(b"partial")
        conflict_copy.write_bytes(b"partial retry")
        other.write_bytes(b"unrelated")

        status, result = self._req(
            "POST", "/downloads/cleanup-partials", body={"videoId": "124"}
        )

        self.assertEqual(status, 200, result)
        self.assertEqual(result["removedPartials"], 2)
        self.assertFalse(target.exists())
        self.assertFalse(conflict_copy.exists())
        self.assertTrue(other.exists())

    def test_terminal_cleanup_removes_exact_unconfirmed_partial(self):
        unconfirmed = self.root / "Unconfirmed 911750.crdownload"
        unconfirmed.write_bytes(b"failed Chrome attempt")
        unrelated = self.root / "Unconfirmed 594201.crdownload"
        unrelated.write_bytes(b"another task")

        status, result = self._req(
            "POST",
            "/downloads/cleanup-partials",
            body={"videoId": "124", "partialPaths": [str(unconfirmed)]},
        )

        self.assertEqual(status, 200, result)
        self.assertEqual(result["removedPartials"], 1)
        self.assertFalse(unconfirmed.exists())
        self.assertTrue(unrelated.exists())

    def test_exact_cleanup_rejects_non_partial_file(self):
        completed = self.root / "Unconfirmed 911750.mp4"
        completed.write_bytes(b"completed video")

        status, result = self._req(
            "POST",
            "/downloads/cleanup-partials",
            body={"videoId": "124", "partialPaths": [str(completed)]},
        )

        self.assertEqual(status, 200, result)
        self.assertEqual(result["removedPartials"], 0)
        self.assertTrue(completed.exists())

    def test_orphan_unconfirmed_sweep_keeps_active_paths(self):
        orphan = self.root / "Unconfirmed 160459.crdownload"
        active = self.root / "Unconfirmed 594201.crdownload"
        named = self.root / "Title——124.mp4.crdownload"
        orphan.write_bytes(b"stranded")
        active.write_bytes(b"live chrome job")
        named.write_bytes(b"has video id")

        status, result = self._req(
            "POST",
            "/downloads/cleanup-orphan-unconfirmed",
            body={"keepPaths": [str(active)]},
        )

        self.assertEqual(status, 200, result)
        self.assertEqual(result["removedPartials"], 1)
        self.assertFalse(orphan.exists())
        self.assertTrue(active.exists())
        # Named partials are not Unconfirmed — leave them for videoId cleanup.
        self.assertTrue(named.exists())

    def test_orphan_sweep_removes_empty_uniquify_mp4(self):
        empty_conflict = self.root / "1263——Ouro——3117332 (1).mp4"
        empty_base = self.root / "1263——Ouro——3117332.mp4"
        good = self.root / "1263——Ouro——3117332 (2).mp4"
        empty_conflict.write_bytes(b"")
        empty_base.write_bytes(b"")
        good.write_bytes(b"real video bytes")
        keep_live = self.root / "1264——Keep——3927817.mp4"
        keep_live.write_bytes(b"")  # in-progress may be 0 bytes briefly

        status, result = self._req(
            "POST",
            "/downloads/cleanup-orphan-unconfirmed",
            body={"keepPaths": [str(keep_live)]},
        )

        self.assertEqual(status, 200, result)
        self.assertEqual(result["removedPartials"], 2)
        self.assertFalse(empty_conflict.exists())
        self.assertFalse(empty_base.exists())
        self.assertTrue(good.exists())
        self.assertTrue(keep_live.exists())

    def test_video_cleanup_removes_empty_conflict_copies(self):
        empty = self.root / "Title——124 (1).mp4"
        empty.write_bytes(b"")
        other = self.root / "Title——1240 (1).mp4"
        other.write_bytes(b"")

        status, result = self._req(
            "POST", "/downloads/cleanup-partials", body={"videoId": "124"}
        )

        self.assertEqual(status, 200, result)
        self.assertGreaterEqual(result["removedPartials"], 1)
        self.assertFalse(empty.exists())
        self.assertTrue(other.exists())

    def test_media_delete_unlinks_path_locked_files(self):
        keep = self.root / "1——Keep Title——1111111.mp4"
        drop = self.root / "2——Drop Title——2222222.mp4"
        keep.write_bytes(b"0" * 2048)
        drop.write_bytes(b"0" * 2048)
        status, scan = self._req("POST", "/scan", body={})
        self.assertEqual(status, 200, scan)
        self.assertIn("1111111", scan["matches"])
        self.assertIn("2222222", scan["matches"])

        status, result = self._req(
            "POST", "/media/delete", body={"videoIds": ["2222222"]}
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["deletedCount"], 1)
        self.assertEqual(result["deleted"][0]["videoId"], "2222222")
        self.assertFalse(drop.exists())
        self.assertTrue(keep.exists())

        status, lookup = self._req(
            "POST", "/lookup", body={"videoIds": ["1111111", "2222222"]}
        )
        self.assertEqual(status, 200, lookup)
        self.assertTrue(lookup["results"]["1111111"]["exists"])
        self.assertFalse(lookup["results"]["2222222"]["exists"])

    def test_media_delete_rejects_path_escape_and_empty(self):
        status, payload = self._req("POST", "/media/delete", body={"videoIds": []})
        self.assertEqual(status, 400)
        status, payload = self._req(
            "POST", "/media/delete", body={"videoIds": ["../secret"]}
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["deletedCount"], 0)
        self.assertTrue(payload["failed"])

    def test_list_orphans_includes_any_non_favorite_paths(self):
        keep = self.root / "kept" / "1——Keep——1111111.mp4"
        keep.parent.mkdir()
        drop = self.root / "2——Drop——2222222.mp4"
        keep.write_bytes(b"0" * 2048)
        drop.write_bytes(b"0" * 2048)
        empty = self.root / "EmptyFolder"
        empty.mkdir()
        nested = self.root / "misc" / "note.txt"
        nested.parent.mkdir()
        nested.write_text("x", encoding="utf-8")
        plain = self.root / "random.bin"
        plain.write_bytes(b"abc")
        (self.root / ".DS_Store").write_bytes(b"junk")
        (nested.parent / ".DS_Store").write_bytes(b"junk")

        status, payload = self._req(
            "POST",
            "/media/list-orphans",
            body={"keepVideoIds": ["1111111"]},
        )
        self.assertEqual(status, 200, payload)
        rels = {item["relativePath"] for item in payload["items"]}
        kinds = {item["relativePath"]: item["kind"] for item in payload["items"]}
        # Only the kept favorite video itself is omitted — its parent folder still lists.
        self.assertNotIn("kept/1——Keep——1111111.mp4", rels)
        self.assertNotIn(".DS_Store", rels)
        self.assertNotIn("misc/.DS_Store", rels)
        self.assertIn("kept", rels)
        self.assertEqual(kinds["kept"], "dir")
        self.assertIn("2——Drop——2222222.mp4", rels)
        self.assertIn("EmptyFolder", rels)
        self.assertEqual(kinds["EmptyFolder"], "dir")
        self.assertIn("misc", rels)
        self.assertEqual(kinds["misc"], "dir")
        self.assertIn("misc/note.txt", rels)
        self.assertIn("random.bin", rels)
        self.assertEqual(payload["keptFileCount"], 1)

    def test_delete_paths_removes_files_and_dirs(self):
        drop = self.root / "2——Drop——2222222.mp4"
        drop.write_bytes(b"0" * 2048)
        empty = self.root / "EmptyFolder"
        empty.mkdir()
        nested = self.root / "misc" / "note.txt"
        nested.parent.mkdir()
        nested.write_text("x", encoding="utf-8")
        self._req("POST", "/scan", body={})

        status, result = self._req(
            "POST",
            "/media/delete-paths",
            body={
                "relativePaths": [
                    "2——Drop——2222222.mp4",
                    "EmptyFolder",
                    "misc/note.txt",
                    "misc",
                ]
            },
        )
        self.assertEqual(status, 200, result)
        self.assertEqual(result["deletedCount"], 4)
        self.assertFalse(drop.exists())
        self.assertFalse(empty.exists())
        self.assertFalse(nested.exists())
        self.assertFalse((self.root / "misc").exists())

    def test_delete_paths_rejects_escape(self):
        status, payload = self._req(
            "POST",
            "/media/delete-paths",
            body={"relativePaths": ["../secret"]},
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["deletedCount"], 0)
        self.assertTrue(payload["failed"])

    def test_reveal_path_accepts_dir_under_root(self):
        folder = self.root / "EmptyFolder"
        folder.mkdir()
        status, payload = self._req(
            "POST", "/reveal-path", body={"relativePath": "EmptyFolder"}
        )
        self.assertEqual(status, 200, payload)
        self.assertEqual(payload["kind"], "dir")
        self.assertEqual(payload["relativePath"], "EmptyFolder")

    def test_reveal_path_rejects_escape(self):
        status, payload = self._req(
            "POST", "/reveal-path", body={"relativePath": "../secret"}
        )
        self.assertEqual(status, 400)

    def test_downloads_queue_list_remove_reorder(self):
        status, payload = self._req(
            "POST",
            "/downloads/enqueue",
            body={
                "items": [
                    {"videoId": "1001", "title": "a", "sortKey": 1},
                    {"videoId": "1002", "title": "b", "sortKey": 2},
                    {"videoId": "1003", "title": "c", "sortKey": 3},
                ]
            },
        )
        self.assertEqual(status, 200, payload)

        status, listed = self._req("POST", "/downloads/queue/list", body={})
        self.assertEqual(status, 200, listed)
        self.assertEqual(
            [i["videoId"] for i in listed["items"]], ["1001", "1002", "1003"]
        )
        self.assertFalse(listed.get("paused"))

        status, claim = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(status, 200, claim)
        self.assertEqual(claim["item"]["videoId"], "1001")
        live_id = int(claim["item"]["id"])

        status, listed = self._req("POST", "/downloads/queue/list", body={})
        ids = [int(i["id"]) for i in listed["items"]]
        self.assertEqual(ids[0], live_id)
        # Swap the two pending rows; live download must stay first.
        status, reordered = self._req(
            "POST",
            "/downloads/queue/reorder",
            body={"ids": [ids[0], ids[2], ids[1]]},
        )
        self.assertEqual(status, 200, reordered)
        self.assertEqual(
            [i["videoId"] for i in reordered["items"]], ["1001", "1003", "1002"]
        )

        pending_id = int(reordered["items"][2]["id"])
        status, removed = self._req(
            "POST", "/downloads/queue/remove", body={"id": pending_id}
        )
        self.assertEqual(status, 200, removed)
        self.assertEqual(removed["item"]["videoId"], "1002")
        self.assertEqual(removed["item"]["status"], "cancelled")
        self.assertEqual(removed["remaining"], 2)

        status, left = self._req("POST", "/downloads/queue/list", body={})
        self.assertEqual([i["videoId"] for i in left["items"]], ["1001", "1003"])

        status, removed_live = self._req(
            "POST", "/downloads/queue/remove", body={"id": live_id}
        )
        self.assertEqual(status, 200, removed_live)
        self.assertEqual(removed_live["item"]["status"], "cancelled")
        status, empty = self._req("POST", "/downloads/queue/list", body={})
        self.assertEqual([i["videoId"] for i in empty["items"]], ["1003"])

    def test_downloads_queue_pause_live_lets_next_claim(self):
        status, payload = self._req(
            "POST",
            "/downloads/enqueue",
            body={
                "items": [
                    {"videoId": "2001", "title": "live", "sortKey": 1},
                    {"videoId": "2002", "title": "next", "sortKey": 2},
                ]
            },
        )
        self.assertEqual(status, 200, payload)
        status, claim = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(claim["item"]["videoId"], "2001")
        live_id = int(claim["item"]["id"])

        status, paused = self._req("POST", "/downloads/queue/pause", body={})
        self.assertEqual(status, 200, paused)
        self.assertTrue(paused.get("hasPausedItems"))
        self.assertFalse(paused.get("hasDownloading"))
        self.assertEqual(paused["pausedItems"][0]["id"], live_id)
        self.assertEqual(paused["pausedItems"][0]["status"], "paused")

        # Pausing must not freeze the queue — the next pending item takes the slot.
        status, next_claim = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(status, 200, next_claim)
        self.assertEqual(next_claim["item"]["videoId"], "2002")

        status, listed = self._req("POST", "/downloads/queue/list", body={})
        self.assertEqual(listed["items"][0]["videoId"], "2002")
        self.assertEqual(listed["items"][0]["status"], "downloading")
        self.assertEqual(listed["items"][1]["videoId"], "2001")
        self.assertEqual(listed["items"][1]["status"], "paused")

        status, resumed = self._req("POST", "/downloads/queue/resume", body={})
        self.assertEqual(status, 200, resumed)
        self.assertEqual(resumed.get("resumed"), 1)
        status, listed = self._req("POST", "/downloads/queue/list", body={})
        by_id = {int(i["id"]): i for i in listed["items"]}
        self.assertEqual(by_id[live_id]["status"], "pending")
        self.assertFalse(listed.get("hasPausedItems"))

    def test_downloads_queue_pause_resume_selected_ids_only(self):
        status, payload = self._req(
            "POST",
            "/downloads/enqueue",
            body={
                "items": [
                    {"videoId": "2101", "title": "live-a", "sortKey": 1},
                    {"videoId": "2102", "title": "live-b", "sortKey": 2},
                    {"videoId": "2103", "title": "queued", "sortKey": 3},
                ]
            },
        )
        self.assertEqual(status, 200, payload)
        status, claim_a = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(status, 200, claim_a)
        status, claim_b = self._req("POST", "/downloads/claim", body={})
        self.assertEqual(status, 200, claim_b)
        id_a = int(claim_a["item"]["id"])
        id_b = int(claim_b["item"]["id"])

        status, paused = self._req(
            "POST", "/downloads/queue/pause", body={"ids": [id_a]}
        )
        self.assertEqual(status, 200, paused)
        self.assertEqual([int(i["id"]) for i in paused["pausedItems"]], [id_a])
        self.assertTrue(paused.get("hasDownloading"))
        self.assertTrue(paused.get("hasPausedItems"))

        status, listed = self._req("POST", "/downloads/queue/list", body={})
        by_id = {int(i["id"]): i for i in listed["items"]}
        self.assertEqual(by_id[id_a]["status"], "paused")
        self.assertEqual(by_id[id_b]["status"], "downloading")
        queued = next(i for i in listed["items"] if i["videoId"] == "2103")
        self.assertEqual(queued["status"], "pending")

        status, resumed = self._req(
            "POST", "/downloads/queue/resume", body={"ids": [id_a]}
        )
        self.assertEqual(status, 200, resumed)
        self.assertEqual(resumed.get("resumed"), 1)
        status, listed = self._req("POST", "/downloads/queue/list", body={})
        by_id = {int(i["id"]): i for i in listed["items"]}
        self.assertEqual(by_id[id_a]["status"], "pending")
        self.assertEqual(by_id[id_b]["status"], "downloading")
        self.assertFalse(listed.get("hasPausedItems"))


if __name__ == "__main__":
    unittest.main()
