"""Painel diário para o backtest do grafo (walk-forward, sem look-ahead).

Para cada pregão dos últimos PANEL_DAYS, calcula os MESMOS campos de `build_data.indicators` (a linha que o navegador
usa para avaliar o grafo), mas usando só dados até aquele pregão. Tudo vetorizado (rolling/shift); a paridade com
`indicators()` na última barra é coberta por teste. O painel não é publicado: é lido pelo script de backtest em Node
(web/scripts/derived.ts), que roda o mesmo engine do navegador em cada data.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

import history

LOOKBACK = 252
AGU_CLOSES = 62
PANEL_DAYS = 252 + max(history.HORIZONS)  # 252 datas de avaliação + horizonte do retorno futuro
FIELDS = ("price", "prevClose", "open", "chg", "high52", "low52", "liq21", "vol", "volRatio", "rsi", "rsiPrev", "ret21",
          "rs21", "gap", "maxC20", "minC20", "maxC60", "minC60", "upStreak", "downStreak", "sma20", "sma50", "sma200",
          "sma50Prev", "sma200Prev", "trixSide", "trix", "trixSig", "trixBand")
ND = {"chg": 5, "ret21": 5, "gap": 5, "volRatio": 3, "rs21": 3, "rsi": 2, "rsiPrev": 2, "liq21": 0, "vol": 0}


def rsi_wilder(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, math.nan)
    return (100 - 100 / (1 + rs)).where(dn != 0, 100.0)


def _streak(pos: pd.Series) -> pd.Series:
    """Quantos dias seguidos (terminando em t) a condição é verdadeira."""
    g = (~pos).cumsum()
    return pos.astype(int).groupby(g).cumsum()


def indicator_frame(df: pd.DataFrame, bench_close: pd.Series | None) -> pd.DataFrame:
    c, h, l, o = df["Close"], df["High"], df["Low"], df["Open"]
    v = df["Volume"].fillna(0)
    out = pd.DataFrame(index=df.index)
    out["price"] = c
    out["prevClose"] = c.shift(1)
    out["open"] = o
    out["chg"] = c / c.shift(1) - 1
    out["high52"] = h.shift(1).rolling(LOOKBACK, min_periods=LOOKBACK - 5).max()
    out["low52"] = l.shift(1).rolling(LOOKBACK, min_periods=LOOKBACK - 5).min()
    out["liq21"] = (c * v).rolling(21, min_periods=1).mean()
    out["vol"] = v
    avg = v.shift(1).rolling(21, min_periods=1).mean()
    out["volRatio"] = (v / avg).where(avg > 0)
    rsi = rsi_wilder(c)
    out["rsi"], out["rsiPrev"] = rsi, rsi.shift(1)
    ret21 = c / c.shift(21) - 1
    out["ret21"] = ret21
    if bench_close is not None:
        b = bench_close.reindex(c.index).ffill()
        out["rs21"] = (ret21 - (b / b.shift(21) - 1)) * 100
    else:
        out["rs21"] = np.nan
    out["gap"] = o / c.shift(1) - 1
    for n in (20, 60):
        out[f"maxC{n}"] = c.shift(1).rolling(n).max()
        out[f"minC{n}"] = c.shift(1).rolling(n).min()
    d = c.diff()
    out["upStreak"], out["downStreak"] = _streak(d > 0), _streak(d < 0)
    for k in (20, 50, 200):
        out[f"sma{k}"] = c.rolling(k).mean()
    out["sma50Prev"], out["sma200Prev"] = out["sma50"].shift(1), out["sma200"].shift(1)
    tx = history.trix_frame(c)
    out["trixSide"], out["trix"], out["trixSig"], out["trixBand"] = tx["side"], tx["trix"], tx["sig"], tx["band"]
    return out


def _col(s: pd.Series, k: str) -> list:
    nd = ND.get(k, 4)
    if k in ("upStreak", "downStreak", "trixSide"):
        return [None if x != x else int(x) for x in s]
    return [None if (x != x or math.isinf(x)) else round(float(x), nd) for x in s]


def build_panel(market: str, cal: pd.DatetimeIndex, items: list[dict]) -> dict:
    """items: {t, name, kind, sector, subsector, idx, rsBench, df, bench_close, excl (bool Series)}.
    cal: calendário mestre (pregões do índice). Campos ficam alinhados a cal[-PANEL_DAYS:]; os fechamentos vêm com
    AGU_CLOSES−1 pregões a mais no início (janela da Agulhada)."""
    cal = cal[-(PANEL_DAYS + AGU_CLOSES - 1):]
    days = cal[AGU_CLOSES - 1:]
    tick = {}
    for it in items:
        f = indicator_frame(it["df"], it.get("bench_close")).reindex(days)
        cl = it["df"]["Close"].reindex(cal)
        x = it.get("excl")
        tick[it["t"]] = {
            "name": it["name"], "kind": it["kind"], "sector": it.get("sector"), "subsector": it.get("subsector"),
            "idx": it.get("idx", []), "rsBench": it.get("rsBench"),
            "f": {k: _col(f[k], k) for k in FIELDS},
            "c": [None if v != v else float(f"{v:.6g}") for v in cl],
            "x": [i for i, b in enumerate((x.reindex(days).fillna(False) if x is not None else pd.Series(False, index=days)).astype(bool)) if b],
        }
    return {"market": market, "dates": [d.strftime("%Y-%m-%d") for d in days], "closeOffset": AGU_CLOSES - 1,
            "horizons": list(history.HORIZONS), "evalDays": 252, "tickers": tick}


def write_panel(path: Path, panel: dict, benches: dict[str, pd.Series], cal: pd.DatetimeIndex) -> None:
    days = cal[-PANEL_DAYS:]
    panel["bench"] = {k: [None if v != v else float(f"{v:.6g}") for v in s.reindex(days).ffill()] for k, s in benches.items()}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(panel, separators=(",", ":"), ensure_ascii=False))
