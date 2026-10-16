#!/usr/bin/env python3
"""Gera os dados do painel de blocos do Monitor B3.

Saída (em --out, normalmente site/data):
  latest.json            universo + indicadores por ticker (filtragem roda no browser)
  candles/<TICKER>.json  ~1 ano de candles diários + SMA50/SMA200 (carregado sob demanda)

Fontes: brapi.dev (universo + metadados, cache em data/ticker_meta.json) e
yfinance (OHLCV diário, auto_adjust=True em tudo, incluindo ^BVSP).
Conteúdo educativo, não é recomendação de investimento.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
TZ = ZoneInfo("America/Sao_Paulo")
BRAPI = "https://brapi.dev/api/v2/tickers"
META_PATH = ROOT / "data" / "ticker_meta.json"
LOOKBACK = 252
CHART_BARS = 260

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("build-data")


def brapi_list(typ: str) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        for attempt in range(3):
            try:
                r = requests.get(BRAPI, params={"type": typ, "limit": 1000, "page": page}, timeout=60)
                r.raise_for_status()
                payload = r.json()
                break
            except Exception as e:  # rate limit / instabilidade
                log.warning("brapi type=%s page=%s tentativa %d: %s", typ, page, attempt + 1, e)
                time.sleep(3 * (attempt + 1))
        else:
            return out
        out.extend(payload.get("results") or [])
        if not (payload.get("pagination") or {}).get("hasNextPage"):
            return out
        page += 1


def norm_meta(item: dict) -> dict:
    sym = (item.get("symbol") or "").strip().upper()
    name = (item.get("name") or "").strip() or None
    long_name = (item.get("longName") or "").strip() or None
    display = name if name and name.upper() != sym else (long_name or name)
    return {
        "symbol": sym,
        "name": display,
        "longName": long_name,
        "sector": (item.get("sector") or "").strip() or None,
        "subsector": (item.get("subsector") or item.get("subSector") or "").strip() or None,
        "logoUrl": (item.get("logoUrl") or item.get("logo") or "").strip() or None,
        "assetType": item.get("assetType") or item.get("type"),
        "subType": item.get("subType"),
    }


INDEX_PATH = ROOT / "data" / "index_constituents.json"
INDEXES = ("IBOV", "IFIX", "SMLL")
_INDEX_CACHE: dict[str, dict] = {}


def index_constituents(index: str) -> list[str]:
    """Carteira do dia (API pública B3 indexProxy/GetPortfolioDay); cai para o cache do repo."""
    import base64
    if not _INDEX_CACHE and INDEX_PATH.exists():
        _INDEX_CACHE.update(json.loads(INDEX_PATH.read_text()))
    q = base64.b64encode(json.dumps({"language": "pt-br", "pageNumber": 1, "pageSize": 300,
                                     "index": index, "segment": "1"}).encode()).decode()
    try:
        r = requests.get(f"https://sistemaswebb3-listados.b3.com.br/indexProxy/indexCall/GetPortfolioDay/{q}", timeout=30)
        r.raise_for_status()
        d = r.json()
        ticks = sorted(x["cod"].strip().upper() for x in d.get("results") or [] if x.get("cod"))
        if len(ticks) > 30:
            _INDEX_CACHE[index] = {"source": "B3 indexProxy GetPortfolioDay (carteira do dia)", "date": d["header"]["date"], "tickers": ticks}
            INDEX_PATH.write_text(json.dumps(_INDEX_CACHE, indent=0, sort_keys=True))
            return ticks
    except Exception as e:
        log.warning("carteira %s B3 falhou (%s) — usando cache", index, e)
    return (_INDEX_CACHE.get(index) or {}).get("tickers", [])


def ifix_constituents() -> list[str]:
    return index_constituents("IFIX")


def asset_kind(sym: str, meta: dict) -> str:
    st = (meta.get("subType") or "").lower()
    if st in ("stock", "unit"):
        return "acao"
    if st == "etf":
        return "etf"
    if st == "fii":
        return "fii"
    if st == "bdr" or (meta.get("assetType") or "").lower() == "bdr":
        return "bdr"
    return "acao"


def build_universe(cfg: dict, limit: int | None) -> tuple[list[str], dict[str, dict]]:
    store_raw = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
    store: dict[str, dict] = dict(store_raw.get("tickers") or {})
    endings = "|".join(re.escape(e) for e in cfg.get("ticker_endings", ["3", "4", "5", "6", "11"]))
    pat = re.compile(rf"^[A-Z0-9]{{4}}({endings})$")
    fund_min = float(cfg.get("fund_prefilter_turnover_brl", 1_000_000))

    stocks = brapi_list("stock")
    funds = brapi_list("fund")
    tickers: list[str] = []
    seen: set[str] = set()

    def add(sym: str, item: dict | None, sub_override: str | None = None):
        if sym in seen:
            return
        seen.add(sym)
        tickers.append(sym)
        if item:
            m = norm_meta(item)
            if sub_override:
                m["subType"] = sub_override
            store[sym] = {**store.get(sym, {}), **{k: v for k, v in m.items() if v}}

    for it in stocks:
        sym = (it.get("symbol") or "").upper()
        st = (it.get("subType") or "").lower()
        if not sym or sym.endswith("F") or st not in ("stock", "unit", "") or not pat.match(sym):
            continue
        add(sym, it)
    if not stocks:  # brapi fora do ar: cai para o cache
        log.warning("brapi stock vazio — usando cache de metadados")
        for sym, m in store.items():
            if (m.get("assetType") == "stock") and pat.match(sym):
                add(sym, None)
    for sym in cfg.get("bdr_allowlist") or []:
        sym = str(sym).strip().upper()
        store.setdefault(sym, {"symbol": sym, "assetType": "bdr", "subType": "bdr"})
        store[sym].setdefault("subType", "bdr")
        add(sym, None)
    # ETFs: brapi type=fund subType=etf (pré-filtro grosseiro por giro volume × preço da
    # brapi, para não baixar centenas de ETFs ilíquidos) + lista estática de checagem.
    fund_by_sym = {(it.get("symbol") or "").upper(): it for it in funds}
    for it in funds:
        sym = (it.get("symbol") or "").upper()
        q = it.get("quote") or {}
        turnover = (q.get("volume") or 0) * (q.get("lastPrice") or 0)
        if (it.get("subType") or "").lower() == "etf" and not sym.endswith("F") and turnover >= fund_min:
            add(sym, it, "etf")
    for sym in cfg.get("etf_static", []):
        store.setdefault(sym, {"symbol": sym, "name": sym, "assetType": "fund"})
        store[sym]["subType"] = "etf"
        add(sym, fund_by_sym.get(sym), "etf")
    # FIIs: somente constituintes do IFIX (carteira do dia B3, cache em data/ifix_constituents.json).
    for sym in ifix_constituents():
        store.setdefault(sym, {"symbol": sym, "name": sym, "assetType": "fund"})
        store[sym]["subType"] = "fii"
        add(sym, fund_by_sym.get(sym), "fii")

    tickers.sort()
    if limit:
        prio = [t for t in cfg.get("bdr_allowlist", []) if t in seen][:5]
        tickers = sorted(set(tickers[:: max(1, len(tickers) // limit)][:limit]) | set(prio))
    META_PATH.write_text(json.dumps({"updated_at": datetime.now(TZ).isoformat(), "tickers": store},
                                    ensure_ascii=False, indent=0, sort_keys=True))
    return tickers, store


def download(symbols: list[str], period: str, chunk: int) -> tuple[dict[str, pd.DataFrame], list[str]]:
    frames: dict[str, pd.DataFrame] = {}
    failed: list[str] = []
    for i in range(0, len(symbols), chunk):
        part = symbols[i : i + chunk]
        log.info("yfinance %d-%d / %d", i + 1, i + len(part), len(symbols))
        raw = None
        for attempt in range(3):
            try:
                raw = yf.download(tickers=part, period=period, interval="1d", auto_adjust=True,
                                  group_by="ticker", threads=True, progress=False)
                break
            except Exception as e:
                log.warning("chunk falhou (%d): %s", attempt + 1, e)
                time.sleep(5 * (attempt + 1))
        for s in part:
            try:
                df = raw[s] if isinstance(raw.columns, pd.MultiIndex) else raw
                df = df.dropna(subset=["Close"])
                if len(df) < 30:
                    raise ValueError("histórico curto")
                frames[s] = df
            except Exception:
                failed.append(s)
    return frames, failed


def rsi_wilder(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, math.nan)
    return (100 - 100 / (1 + rs)).where(dn != 0, 100.0)


def r(x, nd=4):
    if x is None:
        return None
    try:
        if pd.isna(x) or math.isinf(x):
            return None
    except TypeError:
        return None
    return round(float(x), nd)


def indicators(df: pd.DataFrame, bench_ret21: float | None) -> dict:
    c, h, l, v, o = df["Close"], df["High"], df["Low"], df["Volume"].fillna(0), df["Open"]
    n = len(df)
    sma = {k: c.rolling(k).mean() for k in (20, 50, 200)}
    rsi = rsi_wilder(c)
    prev = h.iloc[:-1].tail(LOOKBACK)  # exclui a barra de hoje
    prevl = l.iloc[:-1].tail(LOOKBACK)
    full52 = len(prev) >= LOOKBACK - 5
    vol_avg21 = v.iloc[:-1].tail(21).mean()
    ret21 = c.iloc[-1] / c.iloc[-22] - 1 if n > 22 else None
    out = {
        "date": df.index[-1].strftime("%Y-%m-%d"),
        "price": r(c.iloc[-1]),
        "prevClose": r(c.iloc[-2]) if n > 1 else None,
        "open": r(o.iloc[-1]),
        "chg": r(c.iloc[-1] / c.iloc[-2] - 1, 5) if n > 1 else None,
        "high52": r(prev.max()) if full52 else None,
        "low52": r(prevl.min()) if full52 else None,
        "liq21": r((c * v).tail(21).mean(), 0),
        "vol": r(v.iloc[-1], 0),
        "volRatio": r(v.iloc[-1] / vol_avg21, 3) if vol_avg21 else None,
        "rsi": r(rsi.iloc[-1], 2),
        "rsiPrev": r(rsi.iloc[-2], 2) if n > 1 else None,
        "ret21": r(ret21, 5),
        "rs21": r((ret21 - bench_ret21) * 100, 3) if ret21 is not None and bench_ret21 is not None else None,
        "bars": n,
        "gap": r(o.iloc[-1] / c.iloc[-2] - 1, 5) if n > 1 else None,
    }
    for N in (20, 60):
        prevc = c.iloc[:-1].tail(N)
        out[f"maxC{N}"] = r(prevc.max()) if len(prevc) == N else None
        out[f"minC{N}"] = r(prevc.min()) if len(prevc) == N else None
    d = c.diff().iloc[1:][::-1]
    up = 0
    for x in d:
        if x > 0: up += 1
        else: break
    dn = 0
    for x in d:
        if x < 0: dn += 1
        else: break
    out["upStreak"], out["downStreak"] = up, dn
    for k, s in sma.items():
        out[f"sma{k}"] = r(s.iloc[-1])
    out["sma50Prev"] = r(sma[50].iloc[-2]) if n > 1 else None
    out["sma200Prev"] = r(sma[200].iloc[-2]) if n > 1 else None
    return out


def candles_payload(df: pd.DataFrame, bench_close: pd.Series | None = None) -> dict:
    """~1 ano de candles + séries para o gráfico: SMAs, máx./mín. 52s ex-hoje, RSI(14),
    volume relativo (vol / média dos 21 pregões anteriores) e RS 21d em pp vs benchmark."""
    c = df["Close"]
    s50, s200 = c.rolling(50).mean(), c.rolling(200).mean()
    hi52 = df["High"].shift(1).rolling(LOOKBACK, min_periods=LOOKBACK - 5).max()
    lo52 = df["Low"].shift(1).rolling(LOOKBACK, min_periods=LOOKBACK - 5).min()
    rsi = rsi_wilder(c)
    v = df["Volume"].fillna(0)
    avg21 = v.shift(1).rolling(21).mean()
    volr = (v / avg21.where(avg21 > 0))
    ret21 = c / c.shift(21) - 1
    if bench_close is not None:
        b = bench_close.reindex(c.index).ffill()
        rs = (ret21 - (b / b.shift(21) - 1)) * 100
    else:
        rs = pd.Series(float("nan"), index=c.index)
    t = df.tail(CHART_BARS)
    idx = t.index
    return {
        "t": [d.strftime("%Y-%m-%d") for d in idx],
        "o": [r(x, 3) for x in t["Open"]],
        "h": [r(x, 3) for x in t["High"]],
        "l": [r(x, 3) for x in t["Low"]],
        "c": [r(x, 3) for x in t["Close"]],
        "v": [r(x, 0) for x in t["Volume"].fillna(0)],
        "sma50": [r(x, 3) for x in s50.loc[idx]],
        "sma200": [r(x, 3) for x in s200.loc[idx]],
        "high52": [r(x, 3) for x in hi52.loc[idx]],
        "low52": [r(x, 3) for x in lo52.loc[idx]],
        "rsi": [r(x, 2) for x in rsi.loc[idx]],
        "volr": [r(x, 3) for x in volr.loc[idx]],
        "rs21": [r(x, 3) for x in rs.loc[idx]],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--limit", type=int, default=None, help="universo reduzido (teste local)")
    args = ap.parse_args()
    cfg = json.loads(Path(args.config).read_text())
    out = Path(args.out)
    (out / "candles").mkdir(parents=True, exist_ok=True)
    run_at = datetime.now(TZ)

    tickers, store = build_universe(cfg, args.limit)
    membership = {ix: set(index_constituents(ix)) for ix in INDEXES}
    log.info("universo: %d tickers", len(tickers))
    yc = cfg.get("yfinance", {})
    ifix_proxy = cfg.get("ifix_proxy", "XFIX11.SA")
    syms = [f"{t}.SA" for t in tickers] + ["^BVSP", ifix_proxy]
    frames, failed = download(syms, yc.get("period_panel", "2y"), int(yc.get("chunk_size", 40)))

    def chg_of(sym):
        b = frames.get(sym)
        return float(b["Close"].iloc[-1] / b["Close"].iloc[-2] - 1) if b is not None and len(b) > 1 else None

    def ret21_of(sym):
        b = frames.get(sym)
        return float(b["Close"].iloc[-1] / b["Close"].iloc[-22] - 1) if b is not None and len(b) > 22 else None
    bench = frames.get("^BVSP")
    bench_ret21 = ret21_of("^BVSP")
    ifix_ret21 = ret21_of(ifix_proxy)
    rows = []
    failed_t = sorted(s.replace(".SA", "") for s in failed if s not in ("^BVSP", ifix_proxy))
    for t in tickers:
        df = frames.get(f"{t}.SA")
        if df is None:
            continue
        try:
            kind = asset_kind(t, store.get(t, {}))
            # FIIs vs IFIX (proxy XFIX11; se indisponível, cai para ^BVSP); demais vs Ibovespa
            use_ifix = kind == "fii" and ifix_ret21 is not None
            ind = indicators(df, ifix_ret21 if use_ifix else bench_ret21)
            ind["rsBench"] = "IFIX" if use_ifix else "IBOV"
        except Exception as e:
            log.warning("indicadores %s: %s", t, e)
            failed_t.append(t)
            continue
        m = store.get(t, {})
        rows.append({"t": t, "name": m.get("name") or t, "kind": kind,
                     "sector": m.get("sector"), "subsector": m.get("subsector"),
                     "logo": m.get("logoUrl"), "idx": [ix for ix in INDEXES if t in membership[ix]], **ind})
        (out / "candles" / f"{t}.json").write_text(json.dumps(candles_payload(df, (frames.get(ifix_proxy) if use_ifix else bench)["Close"] if (frames.get(ifix_proxy) if use_ifix else bench) is not None else None), separators=(",", ":")))

    last_dates = sorted({x["date"] for x in rows})
    payload = {
        "schema": 1,
        "generatedAt": run_at.isoformat(timespec="seconds"),
        "dataDate": last_dates[-1] if last_dates else None,
        "sources": {"universe": "brapi.dev (tier gratuito, cache em data/ticker_meta.json)",
                    "prices": "yfinance diário, auto_adjust=True", "benchmark": "^BVSP"},
        "delayNote": "até ~30 min (GitHub Actions) + atraso do Yahoo; barra de hoje é provisória durante o pregão",
        "lookback52": LOOKBACK,
        "defaults": {"liq21MinBrl": cfg.get("filters", {}).get("liq21_min_brl", 5_000_000)},
        "bdrAllowlist": cfg.get("bdr_allowlist", []),
        "benchmark": {"ret21": r(bench_ret21, 5), "price": r(bench["Close"].iloc[-1], 2) if bench is not None else None,
                      "ifixProxy": ifix_proxy.replace(".SA", ""), "ifixRet21": r(ifix_ret21, 5),
                      "chg": r(chg_of("^BVSP"), 5), "ifixChg": r(chg_of(ifix_proxy), 5)},
        "universeCount": len(tickers),
        "indexes": {ix: {"date": (_INDEX_CACHE.get(ix) or {}).get("date"), "count": len(membership[ix])} for ix in INDEXES},
        "failedTickers": sorted(set(failed_t)),
        "tickers": rows,
    }
    (out / "latest.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    log.info("latest.json: %d linhas, %d falhas", len(rows), len(payload["failedTickers"]))
    if not rows:
        log.error("nenhum ticker com dados — abortando para não publicar site vazio")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
