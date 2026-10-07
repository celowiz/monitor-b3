import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")


class WriteMonitorChartTests(unittest.TestCase):
    def test_writes_stable_index_html(self):
        try:
            import screener
        except ImportError as e:
            self.skipTest(f"screener deps missing: {e}")

        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp) / "site"
            cache = Path(tmp) / "cache"
            screener.configure_paths(site_dir=site, cache_dir=cache, skip_png=True)
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
                        {
                            "time": "2026-10-05",
                            "open": 38.0,
                            "high": 40.0,
                            "low": 37.5,
                            "close": 39.5,
                        }
                    ],
                    "volumes": [
                        {"time": "2026-10-05", "value": 1000, "color": "rgba(38, 166, 154, 0.5)"}
                    ],
                }
            }
            path = screener.write_monitor_chart(run_at, "header", rows, ohlcv)
            self.assertEqual(path, site / "index.html")
            html = path.read_text(encoding="utf-8")
            self.assertIn("Não é recomendação de investimento", html)
            self.assertIn("PETR4", html)
            self.assertTrue((site / ".nojekyll").is_file())
            payload = json.loads(
                html.split('id="monitor-data" type="application/json">', 1)[1].split(
                    "</script>", 1
                )[0]
            )
            self.assertEqual(payload["default_ticker"], "PETR4")
            self.assertEqual(payload["series"]["PETR4"]["high52_ex"], 39.0)


if __name__ == "__main__":
    unittest.main()
