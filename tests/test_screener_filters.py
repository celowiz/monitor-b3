import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import screener


def _ohlcv(n: int, last_high: float, last_close: float, volume: int = 100_000) -> pd.DataFrame:
    idx = pd.date_range("2025-10-01", periods=n, freq="B", tz="America/Sao_Paulo")
    close = [10.0] * (n - 1) + [last_close]
    high = [10.5] * (n - 1) + [last_high]
    return pd.DataFrame(
        {
            "Open": close,
            "High": high,
            "Low": [9.5] * n,
            "Close": close,
            "Volume": [volume] * n,
        },
        index=idx,
    )


class FilterLogicTests(unittest.TestCase):
    def test_breakout_excludes_current_candle_when_closed(self):
        df = _ohlcv(260, last_high=20.0, last_close=19.0)
        today = df.index[-1].strftime("%Y-%m-%d")
        ref = screener.compute_reference(df, liq_n=21, high_n=252, today=today, market_open=False)
        self.assertIsNotNone(ref)
        # Latest bar high is 20; prior highs are 10.5, so high52_ex must ignore today.
        self.assertEqual(ref["high52_ex"], 10.5)

    def test_liq_threshold_and_breakout_evaluation(self):
        refs = {
            "PASS": {"high52_ex": 10.0, "liq21": 6_000_000, "data_as_of": "2026-10-06"},
            "ILLIQ": {"high52_ex": 10.0, "liq21": 1_000_000, "data_as_of": "2026-10-06"},
            "NOBRK": {"high52_ex": 40.0, "liq21": 8_000_000, "data_as_of": "2026-10-06"},
        }
        prices = {"PASS": 11.0, "ILLIQ": 12.0, "NOBRK": 39.0}
        rows = {r["ticker"]: r for r in screener.evaluate_from_refs(refs, prices, 5_000_000)}
        self.assertTrue(rows["PASS"]["passes"])
        self.assertFalse(rows["ILLIQ"]["passes"])
        self.assertTrue(rows["ILLIQ"]["passes_breakout"])
        self.assertFalse(rows["NOBRK"]["passes"])
        self.assertTrue(rows["NOBRK"]["passes_liq"])

    @patch("screener.hydrate_state_from_pages")
    @patch("screener.fetch_universe", return_value=["PETR4"])
    @patch("screener.download_history", return_value=({}, ["PETR4"]))
    def test_yfinance_empty_raises_before_site_write(self, *_mocks):
        tmp = Path(tempfile.mkdtemp())
        site, cache = tmp / "site", tmp / "cache"
        screener.configure_paths(site_dir=site, cache_dir=cache, skip_png=True)
        with self.assertRaises(RuntimeError) as ctx:
            screener.run(config_path=Path("config.json"))
        self.assertIn("yfinance returned no data", str(ctx.exception))
        self.assertFalse((site / "last_run.json").exists())


if __name__ == "__main__":
    unittest.main()
