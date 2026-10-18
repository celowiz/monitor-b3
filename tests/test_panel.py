import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build_data as bd  # noqa: E402
import panel as pn  # noqa: E402


def frame(n=400, seed=1):
    rng = np.random.default_rng(seed)
    c = 50 * np.cumprod(1 + rng.normal(0, 0.02, n))
    o = c * (1 + rng.normal(0, 0.01, n))
    idx = pd.bdate_range("2024-01-01", periods=n)
    return pd.DataFrame({"Open": o, "High": np.maximum(o, c) * 1.01, "Low": np.minimum(o, c) * 0.99, "Close": c,
                         "Volume": rng.integers(1000, 9000, n).astype(float)}, index=idx)


class PanelParityTests(unittest.TestCase):
    def test_last_row_equals_indicators(self):
        for seed in (1, 2, 3):
            df = frame(seed=seed)
            bench = frame(seed=seed + 10)["Close"]
            ind = bd.indicators(df, float(bench.iloc[-1] / bench.iloc[-22] - 1))
            f = pn.indicator_frame(df, bench).iloc[-1]
            for k in pn.FIELDS:
                a, b = ind.get(k), f[k]
                if a is None:
                    self.assertTrue(b != b or b is None, k)
                else:
                    self.assertAlmostEqual(float(a), round(float(b), pn.ND.get(k, 4)), places=3, msg=k)

    def test_walk_forward_no_lookahead(self):
        df = frame()
        full = pn.indicator_frame(df, None)
        cut = pn.indicator_frame(df.iloc[:300], None)
        pd.testing.assert_frame_equal(full.iloc[:300], cut, check_exact=False, rtol=1e-9)

    def test_build_panel_shapes_and_mask(self):
        df = frame()
        excl = pd.Series(False, index=df.index); excl.iloc[-10:] = True
        p = pn.build_panel("br", df.index, [{"t": "AAAA3", "name": "Aaaa", "kind": "acao", "df": df, "excl": excl}])
        t = p["tickers"]["AAAA3"]
        self.assertEqual(len(p["dates"]), pn.PANEL_DAYS)
        self.assertEqual(len(t["c"]), pn.PANEL_DAYS + pn.AGU_CLOSES - 1)
        self.assertEqual(len(t["f"]["price"]), pn.PANEL_DAYS)
        self.assertEqual(t["x"], list(range(pn.PANEL_DAYS - 10, pn.PANEL_DAYS)))
        self.assertEqual(t["c"][-1], float(f"{df['Close'].iloc[-1]:.6g}"))


if __name__ == "__main__":
    unittest.main()
