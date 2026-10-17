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


FIX = Path(__file__).resolve().parent / "fixtures" / "trix_ta.json"


class TrixAgulhadaTests(unittest.TestCase):
    def test_trix_matches_ta_and_old_rule(self):
        import json
        d = json.loads(FIX.read_text())
        c = pd.Series(d["close"], dtype=float)
        f = hi.trix_frame(c)
        exp = pd.Series([np.nan if x is None else x for x in d["trix"]], dtype=float)
        np.testing.assert_allclose(f["trix"].round(8).values, exp.values, rtol=0, atol=1e-7, equal_nan=True)
        self.assertEqual(f["side"].tolist(), d["side"])
        self.assertTrue((f["side"] == 1).any() and (f["side"] == -1).any())

    def test_trix_no_lookahead(self):
        rng = np.random.default_rng(2)
        c = pd.Series(100 * np.cumprod(1 + rng.normal(0, 0.02, 300)))
        a = hi.trix_frame(c)["side"]
        b = hi.trix_frame(pd.concat([c.iloc[:200], c.iloc[200:] * 2]))["side"]
        self.assertEqual(a.iloc[:200].tolist(), b.iloc[:200].tolist())

    def test_agulhada_side_flat_then_up(self):
        c = pd.Series([10.0] * 25 + [10.0, 10.01, 10.02])
        s = hi.agulhada_side(c)
        self.assertEqual(int(s.iloc[18]), 0)   # sem SMA 20
        self.assertEqual(int(s.iloc[19]), 1)   # plano: curta = longa → compra
        self.assertTrue((s.iloc[19:] != 0).all())

    def test_history_split_sides_and_base(self):
        rng = np.random.default_rng(3)
        cl = list(100 * np.cumprod(1 + rng.normal(0, 0.02, 400)))
        out = hi.summarize(hi.collect({"X": frame(cl)}, None))
        for k in ("agulhada_buy", "agulhada_sell", "trix_buy", "trix_sell", "base"):
            self.assertIn(k, out)
        self.assertEqual(out["base"]["events"], hi.WINDOW - 5)  # +5: últimos 5 sem retorno futuro
        self.assertGreater(out["trix_buy"]["events"] + out["trix_sell"]["events"], 0)


class DataErrorFilterTests(unittest.TestCase):
    def test_absurd_forward_return_dropped(self):
        c = pd.Series([1.0] * 10 + [5000.0] * 10)
        r5 = hi.forward_returns(c)[5]
        self.assertTrue(r5.iloc[5:10].isna().all())   # salto de 5000× = erro de dados
        self.assertEqual(float(r5.iloc[0]), 0.0)


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
