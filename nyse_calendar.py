#!/usr/bin/env python3
"""NYSE session calendar (regras oficiais de feriados, qualquer ano).

Feriados NYSE: New Year's Day, MLK Day, Presidents' Day, Good Friday, Memorial Day,
Juneteenth (desde 2022), Independence Day, Labor Day, Thanksgiving, Christmas.
Sábado → sexta anterior; domingo → segunda seguinte (New Year's no sábado não é observado).
Pregões encurtados (13h ET) não são pulados.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")


def _easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mo, da = divmod(h + l - 7 * m + 114, 31)
    return date(y, mo, da + 1)


def _nth(y, m, wd, n):  # n-ésimo dia da semana wd (0=seg); n=-1 → último
    if n > 0:
        d = date(y, m, 1)
        return d + timedelta(days=(wd - d.weekday()) % 7 + 7 * (n - 1))
    d = date(y, m + 1, 1) - timedelta(days=1) if m < 12 else date(y, 12, 31)
    return d - timedelta(days=(d.weekday() - wd) % 7)


def _obs(d: date, allow_sat: bool = True) -> date | None:
    if d.weekday() == 5:
        return d - timedelta(days=1) if allow_sat else None
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def holidays(y: int) -> dict[date, str]:
    hs = {
        _obs(date(y, 1, 1), allow_sat=False): "New Year's Day",
        _nth(y, 1, 0, 3): "Martin Luther King Jr. Day",
        _nth(y, 2, 0, 3): "Washington's Birthday",
        _easter(y) - timedelta(days=2): "Good Friday",
        _nth(y, 5, 0, -1): "Memorial Day",
        _obs(date(y, 7, 4)): "Independence Day",
        _nth(y, 9, 0, 1): "Labor Day",
        _nth(y, 11, 3, 4): "Thanksgiving Day",
        _obs(date(y, 12, 25)): "Christmas Day",
    }
    if y >= 2022:
        hs[_obs(date(y, 6, 19))] = "Juneteenth"
    hs.pop(None, None)
    return hs


def should_skip(now: datetime, force: bool = False) -> tuple[bool, str]:
    if force:
        return False, "force=true"
    now = now.astimezone(ET) if now.tzinfo else now.replace(tzinfo=ET)
    d = now.date()
    if d.weekday() >= 5:
        return True, f"fim de semana NYSE ({d})"
    h = holidays(d.year).get(d)
    if h:
        return True, f"feriado NYSE: {h} ({d})"
    return False, f"dia útil NYSE ({d})"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--github-output", action="store_true")
    ap.add_argument("--now", default=None)
    a = ap.parse_args()
    now = datetime.fromisoformat(a.now) if a.now else datetime.now(ET)
    skip, reason = should_skip(now, os.environ.get("FORCE_RUN", "").lower() in ("1", "true", "yes"))
    print(reason)
    out = os.environ.get("GITHUB_OUTPUT")
    if a.github_output and out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"skip_us={'true' if skip else 'false'}\nreason_us={reason}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
