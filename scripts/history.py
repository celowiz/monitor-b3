"""Histórico de sinais recomputado a partir dos candles (sem armazenamento extra).

Para cada pregão i dos últimos ~12 meses, avalia os 9 sinais usando SOMENTE dados até o
fechamento de i (máx./mín. 52s e faixas excluem a própria barra; médias, RSI e volume
relativo terminam em i). O retorno futuro de h pregões é medido de close[i] até close[i+h]
— entrada no fechamento do dia do sinal, sem custos. Eventos sem h pregões à frente ficam
fora da estatística daquele horizonte (n menor nos horizontes longos).

Variantes usadas (parâmetros padrão, sentido "de alta" quando o sinal tem dois lados):
máx. 52s, mín. 52s, golden cross 50/200, volume ≥ 2× média 21d, RSI(14) entra abaixo de 30,
RS 21d vira positivo, gap de alta ≥ 2%, rompimento da máx. de 20 fechamentos, 3 altas seguidas.
Agulhada do Didi e TRIX entram separados por lado (compra/venda). Agulhada com os parâmetros padrão
do bloco (SMA 3/8/20, alpha 1,5%, janela 1, sem filtro de 1º dia: conta todo pregão em que o bloco
listaria o ativo). TRIX com a regra fixa do bloco (ver trix_frame).

"base" = todos os pregões da janela dos mesmos ativos (comportamento normal, sem sinal), para comparar.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

HORIZONS = (5, 21, 63)
WINDOW = 252  # pregões avaliados (~12 meses)
SIGNALS = ("high52", "low52", "smaCross", "volume", "rsi", "rs", "gap", "range", "streak",
           "agulhada_buy", "agulhada_sell", "trix_buy", "trix_sell")

# --- TRIX: fiel a cursor-agents/agulhada/indicators.py (biblioteca `ta`) ---
TRIX_PERIOD = 9      # TRIX(9) = variação % da EMA tripla de 9 do fechamento
TRIX_SIGNAL = 9      # linha de sinal = EMA(9) do TRIX
TRIX_LOOKBACK = 60   # banda = ±(quantil 80% − quantil 20%)/2 do TRIX em 60 pregões
AGU = {"curta": 3, "media": 8, "longa": 20, "alpha": 0.015}


def _ema(x: pd.Series, n: int) -> pd.Series:
    # igual a ta.trend._ema (fillna=False): ewm(span=n, adjust=False, min_periods=n)
    return x.ewm(span=n, min_periods=n, adjust=False).mean()


def trix_frame(close: pd.Series) -> pd.DataFrame:
    """TRIX, sinal, banda e lado. Compra no pregão t quando, em t−1: TRIX > sinal, TRIX e sinal abaixo de −banda
    e TRIX subindo (TRIX[t−1] > TRIX[t−2]); venda simétrica (acima de +banda, TRIX < sinal e caindo)."""
    e3 = _ema(_ema(_ema(close, TRIX_PERIOD), TRIX_PERIOD), TRIX_PERIOD)
    trix = (e3 - e3.shift(1)) / e3.shift(1) * 100
    sig = _ema(trix, TRIX_SIGNAL)
    band = (trix.rolling(TRIX_LOOKBACK).quantile(0.8) - trix.rolling(TRIX_LOOKBACK).quantile(0.2)) / 2
    t1, s1, b1 = trix.shift(1), sig.shift(1), band.shift(1)
    buy = (t1 > s1) & (t1 < -b1) & (s1 < -b1) & (t1 > trix.shift(2))
    sell = (t1 < s1) & (t1 > b1) & (s1 > b1) & (t1 < trix.shift(2))
    side = buy.astype(int) - sell.astype(int)
    return pd.DataFrame({"trix": trix, "sig": sig, "band": band, "side": side})


def agulhada_side(close: pd.Series) -> pd.Series:
    """+1/−1 nos pregões convergidos (mesma fórmula de web/src/agulhada.ts com os padrões), 0 nos demais."""
    mc, mm, ml = (close.rolling(AGU[k]).mean() for k in ("curta", "media", "longa"))
    dc, dl, a = mc / mm - 1, ml / mm - 1, AGU["alpha"]
    conv = (dc.abs() < a) & (dl.abs() < a) & ((dc - dl).abs() < a)
    return pd.Series(np.where(conv, np.where(mc >= ml, 1, -1), 0), index=close.index)


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
    ag = agulhada_side(c)
    out["agulhada_buy"], out["agulhada_sell"] = ag == 1, ag == -1
    tx = trix_frame(c)["side"]
    out["trix_buy"], out["trix_sell"] = tx == 1, tx == -1
    return out.fillna(False).astype(bool)


def forward_returns(close: pd.Series) -> dict[int, pd.Series]:
    """Retorno futuro sobre a série já ajustada (total-return, eventos corrigidos em adjust.py). Sem filtro de valor."""
    return {hz: close.shift(-hz) / close - 1 for hz in HORIZONS}


def collect(frames: dict[str, pd.DataFrame], bench_close: pd.Series | None,
            bench_for: dict[str, pd.Series | None] | None = None,
            exclude: dict[str, pd.Series] | None = None) -> dict[str, dict[int, list[tuple[float, float | None]]]]:
    """frames: ticker -> OHLCV. Retorna sig -> h -> [(ret, excesso vs benchmark)]; também conta eventos.
    exclude: ticker -> máscara (True = pregão fora do estudo, ex.: janela que atravessa uma quebra não explicada
    da série; ver adjust.break_mask). Vale para sinais e base."""
    acc = {s: {hz: [] for hz in HORIZONS} for s in SIGNALS}
    base = {hz: [] for hz in HORIZONS}
    counts = {s: 0 for s in SIGNALS}
    tickers = {s: set() for s in SIGNALS}
    bfw_cache: dict[int, dict[int, pd.Series]] = {}
    for t, df in frames.items():
        if len(df) < 60:
            continue
        bc = (bench_for or {}).get(t, bench_close)
        sf = signal_frame(df, bc).tail(WINDOW)
        if exclude and t in exclude:
            sf = sf[~exclude[t].reindex(sf.index).fillna(False).astype(bool)]
        fw = forward_returns(df["Close"])
        # benchmark sem filtro (índices não sofrem do problema)
        bfw = None
        if bc is not None:
            key = id(bc)
            if key not in bfw_cache:
                bfw_cache[key] = {hz: bc.shift(-hz) / bc - 1 for hz in HORIZONS}
            bfw = bfw_cache[key]
        for hz in HORIZONS:  # base: todos os pregões da janela
            r = fw[hz].reindex(sf.index)
            ex = (r - bfw[hz].reindex(sf.index)) if bfw is not None else pd.Series(np.nan, index=sf.index)
            base[hz].extend((float(a), float(b) if b == b else None) for a, b in zip(r.values, ex.values) if a == a)
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
    return {"acc": acc, "counts": counts, "tickers": {s: len(v) for s, v in tickers.items()}, "base": base}


def _r(x, nd=5):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), nd)


def _stat(xs: list) -> dict:
    if not xs:
        return {"n": 0}
    r = np.array([a for a, _ in xs])
    ex = np.array([b for _, b in xs if b is not None])
    return {"n": int(len(r)), "mean": _r(r.mean()), "median": _r(float(np.median(r))),
            "hit": _r((r > 0).mean(), 4),
            "exMean": _r(ex.mean()) if len(ex) else None,
            "exHit": _r((ex > 0).mean(), 4) if len(ex) else None}


def summarize(col: dict) -> dict:
    out = {}
    for s in SIGNALS:
        hs = {str(hz): _stat(col["acc"][s][hz]) for hz in HORIZONS}
        out[s] = {"events": col["counts"][s], "tickers": col["tickers"][s], "h": hs}
    if "base" in col:
        b = col["base"]
        out["base"] = {"events": len(b[HORIZONS[0]]), "tickers": None, "h": {str(hz): _stat(b[hz]) for hz in HORIZONS}}
    return out
