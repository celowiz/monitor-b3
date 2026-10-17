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

    def test_closes_for_agulhada(self):
        closes = [10 + i * 0.123456 for i in range(300)]
        ind = bd.indicators(self.frame(closes), 0.0)
        self.assertEqual(len(ind["cl"]), bd.AGU_CLOSES)
        self.assertAlmostEqual(ind["cl"][-1], ind["price"], places=2)
        self.assertEqual(ind["cl"][0], float(f"{closes[-bd.AGU_CLOSES]:.4g}"))

    def test_trix_fields(self):
        import numpy as np
        rng = np.random.default_rng(4)
        closes = list(100 * np.cumprod(1 + rng.normal(0, 0.02, 300)))
        ind = bd.indicators(self.frame(closes), 0.0)
        self.assertIn(ind["trixSide"], (-1, 0, 1))
        self.assertIsNotNone(ind["trix"])
        cp = bd.candles_payload(self.frame(closes))
        self.assertEqual(len(cp["trix"]), len(cp["t"]))
        self.assertEqual(cp["trixSide"][-1], ind["trixSide"])

    def test_rsi_bounds(self):
        ind = bd.indicators(self.frame([10 + (i % 5) for i in range(300)]), 0.0)
        self.assertTrue(0 <= ind["rsi"] <= 100)

    def test_candles_payload_series(self):
        closes = [10 + (i % 7) for i in range(300)]
        df = self.frame(closes)
        df.loc[df.index[-1], "Volume"] = 3000.0
        bench = pd.Series([100.0] * 300, index=df.index)
        p = bd.candles_payload(df, bench)
        n = len(p["t"])
        for k in ("rsi", "volr", "rs21", "low52", "high52"):
            self.assertEqual(len(p[k]), n, k)
        self.assertAlmostEqual(p["volr"][-1], 3.0)
        exp = (closes[-1] / closes[-22] - 1) * 100
        self.assertAlmostEqual(p["rs21"][-1], round(exp, 3), places=3)
        self.assertTrue(all(x is None or 0 <= x <= 100 for x in p["rsi"]))
        self.assertIsNone(bd.candles_payload(df)["rs21"][-1])

    def test_kind(self):
        self.assertEqual(bd.asset_kind("BPAC11", {"subType": "unit"}), "acao")
        self.assertEqual(bd.asset_kind("BOVA11", {"subType": "etf"}), "etf")
        self.assertEqual(bd.asset_kind("HGLG11", {"subType": "fii"}), "fii")
        self.assertEqual(bd.asset_kind("MELI34", {"subType": "bdr"}), "bdr")


if __name__ == "__main__":
    unittest.main()
