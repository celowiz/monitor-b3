import unittest
from datetime import date, datetime
import nyse_calendar as n


class NyseTests(unittest.TestCase):
    def test_2026_holidays(self):
        h = n.holidays(2026)
        for d in ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]:
            self.assertIn(date.fromisoformat(d), h, d)
        self.assertEqual(len(h), 10)

    def test_2027_observed(self):
        h = n.holidays(2027)
        self.assertIn(date(2027, 12, 24), h)  # Natal no sábado → sexta
        self.assertIn(date(2027, 3, 26), h)   # Good Friday
        self.assertNotIn(date(2021, 12, 31), n.holidays(2022))  # Ano-novo sábado não observado

    def test_skip(self):
        self.assertTrue(n.should_skip(datetime.fromisoformat("2026-11-26T12:00-05:00"))[0])
        self.assertFalse(n.should_skip(datetime.fromisoformat("2026-10-16T12:00-04:00"))[0])
        self.assertTrue(n.should_skip(datetime.fromisoformat("2026-10-17T12:00-04:00"))[0])


if __name__ == "__main__":
    unittest.main()
