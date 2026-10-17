import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import adjust as aj  # noqa: E402


def frame(close, vol=None, div=None):
    idx = pd.bdate_range("2025-01-01", periods=len(close))
    c = np.asarray(close, dtype=float)
    return pd.DataFrame({"Open": c, "High": c, "Low": c, "Close": c, "Adj Close": c,
                         "Volume": np.asarray(vol if vol is not None else [1000.0] * len(c), dtype=float),
                         "Dividends": np.asarray(div if div is not None else [0.0] * len(c), dtype=float)}, index=idx)


class B3Tests(unittest.TestCase):
    def test_multiplier_semantics(self):
        self.assertAlmostEqual(aj.b3_multiplier("GRUPAMENTO", 0.0133333333), 75, places=3)
        self.assertAlmostEqual(aj.b3_multiplier("DESDOBRAMENTO", 100), 0.5)
        self.assertAlmostEqual(aj.b3_multiplier("BONIFICACAO", 10), 1 / 1.1)
        self.assertIsNone(aj.b3_multiplier("RESG TOTAL RV", 100))

    def test_parse_prefers_class_isin(self):
        pl = {"stockDividends": [
            {"label": "DESDOBRAMENTO", "factor": "100,00000000000", "lastDatePrior": "15/04/2024", "isinCode": "BRBBASACNOR3"},
            {"label": "DESDOBRAMENTO", "factor": "4.900,00000000000", "lastDatePrior": "08/06/2009", "isinCode": "BRBBASA04OR8"}]}
        ev = aj.parse_b3_stock_events(pl, "BBAS3")
        self.assertEqual(len(ev), 1)
        self.assertAlmostEqual(ev[0]["mult"], 0.5)


class CleanTests(unittest.TestCase):
    def test_spike_segment_rescaled(self):  # XPML11: 3 pregões ~1/100 do preço
        c = [110.0] * 10 + [1.1, 1.1, 1.1] + [110.0] * 10
        out, rep = aj.clean(frame(c))
        self.assertTrue(np.allclose(out["Close"], 110.0))
        self.assertEqual([f.kind for f in rep.fixes], ["spike"])

    def test_b3_event_not_adjusted_by_yahoo(self):  # desdobramento 6:1 que o Yahoo não aplicou
        c = [60.0] * 10 + [10.0] * 10
        df = frame(c)
        ev = [{"label": "DESDOBRAMENTO", "mult": 1 / 6, "lastDatePrior": df.index[9]}]
        out, rep = aj.clean(df, ev)
        self.assertTrue(np.allclose(out["Close"], 10.0))
        self.assertAlmostEqual(out["Volume"].iloc[0], 6000.0)
        self.assertEqual(rep.fixes[0].kind, "b3_event")
        self.assertTrue(rep.corrected)

    def test_round_split_with_inverse_volume(self):
        out, rep = aj.clean(frame([40.0] * 10 + [10.0] * 10, vol=[1000.0] * 10 + [4000.0] * 10))
        self.assertTrue(np.allclose(out["Close"], 10.0))
        self.assertEqual(rep.fixes[0].kind, "round_split")

    def test_round_ratio_without_volume_change_is_real(self):
        out, rep = aj.clean(frame([40.0] * 10 + [20.0] * 10))
        self.assertEqual(rep.fixes[0].kind, "big_move")
        self.assertAlmostEqual(out["Close"].iloc[0], 40.0)

    def test_unexplained_break_and_mask(self):
        df = frame([1.0] * 30 + [10.0] * 30)
        out, rep = aj.clean(df)
        self.assertEqual(rep.breaks, [str(df.index[30].date())])
        m = aj.break_mask(out.index, rep.breaks, before=5, after=3)
        self.assertEqual(int(m.sum()), 9)
        self.assertTrue(m.iloc[27] and m.iloc[35] and not m.iloc[26] and not m.iloc[36])

    def test_stale_prefix_dropped(self):  # NATU3: preço parado sem negócio antes da listagem
        out, rep = aj.clean(frame([36.86] * 8 + [10.0] * 10, vol=[0.0] * 8 + [5e6] * 10))
        self.assertEqual(len(out), 10)
        self.assertEqual(rep.fixes[0].kind, "stale_prefix")

    def test_dividends_total_return_like_yahoo(self):
        c = [10.0, 10.0, 9.0, 9.0]
        out, _ = aj.clean(frame(c, div=[0, 0, 1.0, 0]))
        self.assertAlmostEqual(out["Close"].iloc[0], 9.0)       # 10 × (1 − 1/10)
        self.assertAlmostEqual(out["Close"].iloc[-1], 9.0)      # último = preço de tela
        self.assertNotIn("Dividends", out)

    def test_huge_dividend_only_if_price_dropped(self):
        ok, r1 = aj.clean(frame([10.0, 10.0, 5.0, 5.0], div=[0, 0, 5.0, 0]))     # redução de capital real
        self.assertAlmostEqual(ok["Close"].iloc[0], 5.0)
        bad, r2 = aj.clean(frame([10.0, 10.0, 10.0, 10.0], div=[0, 0, 5.0, 0]))  # provento em escala errada
        self.assertAlmostEqual(bad["Close"].iloc[0], 10.0)
        self.assertEqual(r2.fixes[-1].kind, "bad_dividend")


if __name__ == "__main__":
    unittest.main()
