import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fingerprint as fp


class FingerprintTests(unittest.TestCase):
    def write(self, d, br, summ):
        (d / "latest_br.json").write_text(json.dumps(br))
        (d / "summary.json").write_text(json.dumps(summ))
        return fp.fingerprint(d)

    def test_ignora_hora_da_rodada_mas_nao_os_dados(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t)
            a = self.write(d, {"generatedAt": "17:34", "tickers": [{"t": "A", "price": 1}]}, {"generated_at": "17:34", "intraday": False})
            b = self.write(d, {"generatedAt": "18:04", "tickers": [{"t": "A", "price": 1}]}, {"generated_at": "18:04", "intraday": False})
            self.assertEqual(a, b)
            c = self.write(d, {"generatedAt": "18:04", "tickers": [{"t": "A", "price": 2}]}, {"generated_at": "18:04", "intraday": False})
            self.assertNotEqual(a, c)
            e = self.write(d, {"generatedAt": "18:04", "tickers": [{"t": "A", "price": 1}]}, {"generated_at": "18:04", "intraday": True})
            self.assertNotEqual(a, e)
