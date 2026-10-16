import sys, unittest
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_data as bd


class IndicatorTests(unittest.TestCase):
    def frame(self, closes):
        idx = pd.bdate_range("2025-01-01", periods=len(closes))
        c = pd.Series(closes, index=idx, dtype=float)
        return pd.DataFrame({"Open": c, "High": c, "Low": c, "Close": c, "Volume": 1000.0})

    def test_high52_excludes_today_and_streak(self):
        closes = [10.0] * 260 + [11, 12, 13]
        ind = bd.indicators(self.frame(closes), 0.0)
        self.assertEqual(ind["high52"], 12.0)  # máxima ex-hoje
        self.assertGreater(ind["price"], ind["high52"])
        self.assertEqual(ind["upStreak"], 3)
        self.assertEqual(ind["maxC20"], 12.0)

    def test_rsi_bounds(self):
        ind = bd.indicators(self.frame([10 + (i % 5) for i in range(300)]), 0.0)
        self.assertTrue(0 <= ind["rsi"] <= 100)

    def test_kind(self):
        self.assertEqual(bd.asset_kind("BPAC11", {"subType": "unit"}), "acao")
        self.assertEqual(bd.asset_kind("BOVA11", {"subType": "etf"}), "etf")
        self.assertEqual(bd.asset_kind("HGLG11", {"subType": "fii"}), "fii")
        self.assertEqual(bd.asset_kind("MELI34", {"subType": "bdr"}), "bdr")


if __name__ == "__main__":
    unittest.main()
