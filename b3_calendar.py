#!/usr/bin/env python3
"""B3 session calendar: skip GitHub Actions runs on holidays and weekends.

Holiday dates for 2026 follow B3's published calendar (Ofício Circular /
notícia de 09/01/2026). There is no Brazilian DST; America/Sao_Paulo is UTC-3.

TODO: add 2027+ when B3 publishes the next circular. Until then, unknown
years only skip weekends (and any dates listed below).
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, time
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Sao_Paulo")

# Days with no equities trading session on B3 (listed segment).
# Source: https://www.b3.com.br/pt_br/noticias/calendario-de-negociacao-da-b3-confira-o-funcionamento-da-bolsa-em-2026.htm
B3_NO_SESSION: dict[str, str] = {
    "2026-01-01": "Confraternização Universal",
    "2026-02-16": "Carnaval",
    "2026-02-17": "Carnaval",
    "2026-04-03": "Sexta-feira Santa",
    "2026-04-21": "Tiradentes",
    "2026-05-01": "Dia do Trabalho",
    "2026-06-04": "Corpus Christi",
    "2026-09-07": "Independência do Brasil",
    "2026-10-12": "Nossa Senhora Aparecida",
    "2026-11-02": "Finados",
    # 15/11/2026 cai no domingo; listado mesmo assim.
    "2026-11-15": "Proclamação da República",
    "2026-11-20": "Zumbi e Consciência Negra",
    "2026-12-24": "Véspera de Natal (sem sessão de negociação)",
    "2026-12-25": "Natal",
    "2026-12-31": "Véspera de Ano Novo (sem sessão de negociação)",
}

# Quarta-feira de Cinzas 2026: pregão começa às 13h (horário especial B3).
DELAYED_OPEN: dict[str, time] = {
    "2026-02-18": time(13, 0),
}


def should_skip(now: datetime, force: bool = False) -> tuple[bool, str]:
    """Return (skip, reason). Weekends and B3 no-session days are skipped."""
    if force:
        return False, "force=true — rodando mesmo fora do calendário"
    if now.tzinfo is None:
        now = now.replace(tzinfo=TZ)
    else:
        now = now.astimezone(TZ)
    day = now.strftime("%Y-%m-%d")
    if now.weekday() >= 5:
        return True, f"fim de semana ({day})"
    if day in B3_NO_SESSION:
        return True, f"feriado B3: {B3_NO_SESSION[day]} ({day})"
    delayed = DELAYED_OPEN.get(day)
    if delayed is not None and now.timetz().replace(tzinfo=None) < delayed:
        return True, (
            f"horário especial B3 em {day}: pregão só a partir de "
            f"{delayed.strftime('%H:%M')} America/Sao_Paulo"
        )
    return False, f"dia útil B3 ({day})"


def main() -> int:
    parser = argparse.ArgumentParser(description="Decide whether to skip a B3 scan run")
    parser.add_argument("--github-output", action="store_true")
    parser.add_argument("--now", default=None, help="ISO datetime override (tests)")
    args = parser.parse_args()

    if args.now:
        now = datetime.fromisoformat(args.now)
        if now.tzinfo is None:
            now = now.replace(tzinfo=TZ)
    else:
        now = datetime.now(TZ)

    force = os.environ.get("FORCE_RUN", "").strip().lower() in ("1", "true", "yes")
    skip, reason = should_skip(now, force=force)
    print(reason)
    if args.github_output:
        gh_out = os.environ.get("GITHUB_OUTPUT")
        if gh_out:
            with open(gh_out, "a", encoding="utf-8") as f:
                f.write(f"skip={'true' if skip else 'false'}\n")
                f.write(f"reason={reason}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
