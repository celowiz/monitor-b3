import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from b3_site import preview_relpath, preview_run_dir, prune_preview_days, write_nojekyll

TZ = ZoneInfo("America/Sao_Paulo")


class PreviewPathTests(unittest.TestCase):
    def test_relpath_uses_sao_paulo_clock_and_nn_ticker(self):
        run_at = datetime(2026, 10, 6, 16, 33, tzinfo=TZ)
        self.assertEqual(
            preview_relpath(run_at, 1, "PETR4"),
            "previews/2026-10-06/16-33/01_PETR4.png",
        )
        self.assertEqual(
            preview_relpath(run_at, 12, "VALE3"),
            "previews/2026-10-06/16-33/12_VALE3.png",
        )

    def test_run_dir_under_site(self):
        run_at = datetime(2026, 10, 6, 9, 5, tzinfo=TZ)
        d = preview_run_dir(Path("/tmp/site"), run_at)
        self.assertEqual(d, Path("/tmp/site/previews/2026-10-06/09-05"))


class PruneTests(unittest.TestCase):
    def test_keeps_last_n_calendar_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "previews"
            for name in ("2026-10-01", "2026-10-04", "2026-10-06"):
                folder = root / name / "16-00"
                folder.mkdir(parents=True)
                (folder / "01_PETR4.png").write_bytes(b"x")
            removed = prune_preview_days(root, keep_days=3, today=date(2026, 10, 6))
            self.assertEqual(removed, ["2026-10-01"])
            self.assertFalse((root / "2026-10-01").exists())
            self.assertTrue((root / "2026-10-04").exists())
            self.assertTrue((root / "2026-10-06").exists())

    def test_write_nojekyll(self):
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            write_nojekyll(site)
            self.assertTrue((site / ".nojekyll").is_file())


class LastPreviewsShapeTests(unittest.TestCase):
    def test_json_lists_site_relative_paths(self):
        run_at = datetime(2026, 10, 6, 16, 33, tzinfo=TZ)
        payload = [
            {"ticker": "PETR4", "path": preview_relpath(run_at, 1, "PETR4")},
            {"ticker": "VALE3", "path": preview_relpath(run_at, 2, "VALE3")},
        ]
        raw = json.dumps(payload)
        loaded = json.loads(raw)
        self.assertTrue(all(item["path"].startswith("previews/") for item in loaded))
        self.assertFalse(any(item["path"].startswith("/") for item in loaded))


if __name__ == "__main__":
    unittest.main()
