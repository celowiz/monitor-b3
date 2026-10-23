#!/usr/bin/env python3
"""Impressão digital dos dados publicados (sem os horários da rodada).

Usada pelo workflow para não republicar o Pages quando uma rodada agendada traz exatamente os mesmos
números da publicação anterior (ex.: rodadas depois do fechamento). Entra o que o usuário vê:
latest_br/latest_us (sem generatedAt) e summary.json (sem generated_at; inclui intraday/final, então a
virada para "fechamento" sempre publica).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

DROP = {"generatedAt", "generated_at"}


def _strip(x):
    if isinstance(x, dict):
        return {k: _strip(v) for k, v in x.items() if k not in DROP}
    if isinstance(x, list):
        return [_strip(v) for v in x]
    return x


def fingerprint(data_dir: Path) -> str:
    h = hashlib.sha256()
    for name in ("latest_br.json", "latest_us.json", "summary.json"):
        p = data_dir / name
        h.update(name.encode() + b"\0")
        if p.exists():
            h.update(json.dumps(_strip(json.loads(p.read_text())), sort_keys=True, separators=(",", ":")).encode())
        h.update(b"\0")
    return h.hexdigest()


if __name__ == "__main__":
    print(fingerprint(Path(sys.argv[1] if len(sys.argv) > 1 else "web/dist/data")))
