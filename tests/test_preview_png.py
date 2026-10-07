import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")


def _chromium_available() -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return False
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
            browser.close()
        return True
    except Exception:
        return False


class PreviewPngTests(unittest.TestCase):
    def test_png_path_pattern_and_relative_json(self):
        if not _chromium_available():
            self.skipTest("Playwright Chromium not installed")

        import screener

        tmp = Path(tempfile.mkdtemp())
        site = tmp / "site"
        screener.configure_paths(site_dir=site, cache_dir=tmp / "cache", skip_png=False)
        run_at = datetime(2026, 10, 6, 16, 33, tzinfo=TZ)
        rows = [
            {
                "ticker": "PETR4",
                "price": 40.0,
                "high52_ex": 39.0,
                "pct_above": 0.0256,
                "liq21_mi": 80,
                "price_fmt": "40,00",
                "high_fmt": "39,00",
                "acima_fmt": "+2,6%",
                "liq_fmt": "80",
                "desde_fmt": "-",
                "chg_vs_prev": None,
                "company": "Petrobras",
                "sector": "Petróleo",
                "subsector": None,
                "logoUrl": None,
                "tooltip": "Petrobras",
            }
        ]
        ohlcv = {
            "PETR4": {
                "candles": [
                    {"time": "2026-09-01", "open": 38.0, "high": 39.0, "low": 37.5, "close": 38.5},
                    {"time": "2026-10-05", "open": 38.5, "high": 40.0, "low": 38.0, "close": 39.5},
                ],
                "volumes": [
                    {"time": "2026-09-01", "value": 800, "color": "rgba(38, 166, 154, 0.5)"},
                    {"time": "2026-10-05", "value": 1000, "color": "rgba(38, 166, 154, 0.5)"},
                ],
            }
        }
        html_path = screener.write_monitor_chart(run_at, "header demo", rows, ohlcv)
        png = screener.render_chart_preview_png(html_path, run_at, tickers=["PETR4"])
        expected = site / "previews" / "2026-10-06" / "16-33" / "01_PETR4.png"
        self.assertEqual(png, expected)
        self.assertTrue(expected.is_file())
        self.assertGreater(expected.stat().st_size, 1000)
        listed = json.loads((site / "last_previews.json").read_text(encoding="utf-8"))
        self.assertEqual(
            listed,
            [{"ticker": "PETR4", "path": "previews/2026-10-06/16-33/01_PETR4.png"}],
        )


if __name__ == "__main__":
    unittest.main()
