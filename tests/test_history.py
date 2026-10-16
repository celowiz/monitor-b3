import sys, unittest
from pathlib import Path
import numpy as np, pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import history as hi


def frame(closes, opens=None):
    idx = pd.bdate_range("2024-01-01", periods=len(closes))
    c = pd.Series(closes, index=idx, dtype=float)
    o = pd.Series(opens if opens is not None else closes, index=idx, dtype=float)
    return pd.DataFrame({"Open": o, "High": c, "Low": c, "Close": c, "Volume": 1000.0})


class HistoryTests(unittest.TestCase):
    def test_no_lookahead(self):
        # sinais no dia i não mudam se o futuro mudar
        rng = np.random.default_rng(1)
        cl = list(100 * np.cumprod(1 + rng.normal(0, 0.02, 400)))
        a = hi.signal_frame(frame(cl), None)
        b = hi.signal_frame(frame(cl[:300] + [x * 3 for x in cl[300:]]), None)
        pd.testing.assert_frame_equal(a.iloc[:300], b.iloc[:300])

    def test_streak_and_range(self):
        cl = [10.0] * 30 + [11, 12, 13, 14]
        sf = hi.signal_frame(frame(cl), None)
        self.assertEqual(list(sf.index[sf["streak"]]), [sf.index[32]])
        self.assertTrue(sf["range"].iloc[30])

    def test_summary_forward(self):
        cl = [10.0] * 30 + [11, 12, 13] + [13.0 + i for i in range(70)]
        bench = frame([100.0] * len(cl))["Close"]
        col = hi.collect({"X": frame(cl)}, bench)
        s = hi.summarize(col)["streak"]
        # 3ª alta em 13 (idx 32) e de novo em 16 após o 13 repetido (idx 36)
        self.assertEqual(s["events"], 2)
        self.assertEqual(s["h"]["5"]["n"], 2)
        self.assertAlmostEqual(s["h"]["5"]["mean"], round(((17 / 13 - 1) + (21 / 16 - 1)) / 2, 5))
        self.assertAlmostEqual(s["h"]["5"]["exMean"], s["h"]["5"]["mean"])
        self.assertEqual(s["h"]["5"]["hit"], 1.0)


if __name__ == "__main__":
    unittest.main()
