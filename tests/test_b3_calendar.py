import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from b3_calendar import should_skip

TZ = ZoneInfo("America/Sao_Paulo")


class B3CalendarTests(unittest.TestCase):
    def test_new_year_2026_is_holiday(self):
        skip, reason = should_skip(datetime(2026, 1, 1, 12, 0, tzinfo=TZ))
        self.assertTrue(skip)
        self.assertIn("Confraternização", reason)

    def test_carnival_monday_2026(self):
        skip, _ = should_skip(datetime(2026, 2, 16, 11, 0, tzinfo=TZ))
        self.assertTrue(skip)

    def test_weekday_session_runs(self):
        skip, reason = should_skip(datetime(2026, 10, 7, 11, 0, tzinfo=TZ))
        self.assertFalse(skip)
        self.assertIn("dia útil", reason)

    def test_saturday_skipped(self):
        skip, reason = should_skip(datetime(2026, 10, 10, 11, 0, tzinfo=TZ))
        self.assertTrue(skip)
        self.assertIn("fim de semana", reason)

    def test_ash_wednesday_before_open_skipped(self):
        skip, reason = should_skip(datetime(2026, 2, 18, 11, 0, tzinfo=TZ))
        self.assertTrue(skip)
        self.assertIn("horário especial", reason)

    def test_ash_wednesday_after_open_runs(self):
        skip, _ = should_skip(datetime(2026, 2, 18, 13, 30, tzinfo=TZ))
        self.assertFalse(skip)

    def test_force_overrides_holiday(self):
        skip, reason = should_skip(
            datetime(2026, 1, 1, 12, 0, tzinfo=TZ), force=True
        )
        self.assertFalse(skip)
        self.assertIn("force", reason)

    def test_christmas_eve_2026_no_session(self):
        skip, _ = should_skip(datetime(2026, 12, 24, 12, 0, tzinfo=TZ))
        self.assertTrue(skip)

    def test_july_9_2026_b3_is_open(self):
        # Feriado estadual em SP; B3 opera normalmente.
        skip, _ = should_skip(datetime(2026, 7, 9, 12, 0, tzinfo=TZ))
        self.assertFalse(skip)


if __name__ == "__main__":
    unittest.main()
