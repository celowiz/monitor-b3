"""Histórico de sinais recomputado a partir dos candles (sem armazenamento extra).

Para cada pregão i dos últimos ~12 meses, avalia os 9 sinais usando SOMENTE dados até o
fechamento de i (máx./mín. 52s e faixas excluem a própria barra; médias, RSI e volume
relativo terminam em i). O retorno futuro de h pregões é medido de close[i] até close[i+h]
— entrada no fechamento do dia do sinal, sem custos. Eventos sem h pregões à frente ficam
fora da estatística daquele horizonte (n menor nos horizontes longos).

Variantes usadas (parâmetros padrão, sentido "de alta" quando o sinal tem dois lados):
máx. 52s, mín. 52s, golden cross 50/200, volume ≥ 2× média 21d, RSI(14) entra abaixo de 30,
RS 21d vira positivo, gap de alta ≥ 2%, rompimento da máx. de 20 fechamentos, 3 altas seguidas.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

HORIZONS = (5, 21, 63)
WINDOW = 252  # pregões avaliados (~12 meses)
SIGNALS = ("high52", "low52", "smaCross", "volume", "rsi", "rs", "gap", "range", "streak")


def rsi_wilder(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).where(dn != 0, 100.0)


def signal_frame(df: pd.DataFrame, bench_close: pd.Series | None, lookback: int = 252) -> pd.DataFrame:
    c, o, h, l = df["Close"], df["Open"], df["High"], df["Low"]
    v = df["Volume"].fillna(0)
    hi52 = h.shift(1).rolling(lookback, min_periods=lookback - 5).max()
    lo52 = l.shift(1).rolling(lookback, min_periods=lookback - 5).min()
    s50, s200 = c.rolling(50).mean(), c.rolling(200).mean()
    avg21 = v.shift(1).rolling(21).mean()
    rsi = rsi_wilder(c)
    out = pd.DataFrame(index=df.index)
    out["high52"] = c > hi52
    out["low52"] = c < lo52
    out["smaCross"] = (s50 > s200) & (s50.shift(1) <= s200.shift(1))
    out["volume"] = (v / avg21.where(avg21 > 0)) >= 2
    out["rsi"] = (rsi < 30) & (rsi.shift(1) >= 30)
    if bench_close is not None:
        b = bench_close.reindex(c.index).ffill()
        rs = (c / c.shift(21) - 1 - (b / b.shift(21) - 1)) * 100
        out["rs"] = (rs > 0) & (rs.shift(1) <= 0)
    else:
        out["rs"] = False
    out["gap"] = (o / c.shift(1) - 1) >= 0.02
    out["range"] = c > c.shift(1).rolling(20).max()
    up = (c.diff() > 0).astype(int)
    run = up.groupby((up == 0).cumsum()).cumsum()
    out["streak"] = run == 3
    return out.fillna(False).astype(bool)


def forward_returns(close: pd.Series) -> dict[int, pd.Series]:
    return {hz: close.shift(-hz) / close - 1 for hz in HORIZONS}


def collect(frames: dict[str, pd.DataFrame], bench_close: pd.Series | None,
            bench_for: dict[str, pd.Series | None] | None = None) -> dict[str, dict[int, list[tuple[float, float | None]]]]:
    """frames: ticker -> OHLCV. Retorna sig -> h -> [(ret, excesso vs benchmark)]; também conta eventos."""
    acc = {s: {hz: [] for hz in HORIZONS} for s in SIGNALS}
    counts = {s: 0 for s in SIGNALS}
    tickers = {s: set() for s in SIGNALS}
    bfw_cache: dict[int, dict[int, pd.Series]] = {}
    for t, df in frames.items():
        if len(df) < 60:
            continue
        bc = (bench_for or {}).get(t, bench_close)
        sf = signal_frame(df, bc).tail(WINDOW)
        fw = forward_returns(df["Close"])
        bfw = None
        if bc is not None:
            key = id(bc)
            if key not in bfw_cache:
                bfw_cache[key] = forward_returns(bc)
            bfw = bfw_cache[key]
        for s in SIGNALS:
            idx = sf.index[sf[s].values]
            if not len(idx):
                continue
            counts[s] += len(idx)
            tickers[s].add(t)
            for hz in HORIZONS:
                r = fw[hz].reindex(idx)
                ex = (r - bfw[hz].reindex(idx)) if bfw is not None else pd.Series(np.nan, index=idx)
                for a, b in zip(r.values, ex.values):
                    if a == a:  # não-NaN
                        acc[s][hz].append((float(a), float(b) if b == b else None))
    return {"acc": acc, "counts": counts, "tickers": {s: len(v) for s, v in tickers.items()}}


def _r(x, nd=5):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), nd)


def summarize(col: dict) -> dict:
    out = {}
    for s in SIGNALS:
        hs = {}
        for hz in HORIZONS:
            xs = col["acc"][s][hz]
            if not xs:
                hs[str(hz)] = {"n": 0}
                continue
            r = np.array([a for a, _ in xs])
            ex = np.array([b for _, b in xs if b is not None])
            hs[str(hz)] = {"n": int(len(r)), "mean": _r(r.mean()), "median": _r(float(np.median(r))),
                           "hit": _r((r > 0).mean(), 4),
                           "exMean": _r(ex.mean()) if len(ex) else None,
                           "exHit": _r((ex > 0).mean(), 4) if len(ex) else None}
        out[s] = {"events": col["counts"][s], "tickers": col["tickers"][s], "h": hs}
    return out
