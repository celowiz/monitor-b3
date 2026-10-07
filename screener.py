#!/usr/bin/env python3
"""
B3 stock screener: liquidity + 52w high breakout.
Universe: brapi.dev free tickers. Prices: yfinance (.SA).
Writes a GitHub Pages publish dir (index.html, last_run.json, dated PNG previews).
Persists state.json (prev pass prices) and daily_cache.json (high52/liq21) in CACHE_DIR.
"""
from __future__ import annotations

import argparse
import html as html_lib
import json
import logging
import os
import re
import shutil
import sys
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

from b3_site import (
    preview_relpath,
    preview_run_dir,
    preview_run_parts,
    prune_preview_days,
    write_nojekyll,
)

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
TZ = ZoneInfo("America/Sao_Paulo")

# Publish + cache paths — set by configure_paths() (env SITE_DIR / CACHE_DIR).
SITE_DIR = ROOT / "site"
CACHE_DIR = ROOT / ".cache"
OUT_PATH = SITE_DIR / "last_run.json"
STATE_PATH = CACHE_DIR / "state.json"
DAILY_CACHE_PATH = CACHE_DIR / "daily_cache.json"
MESSAGE_PATH = SITE_DIR / "last_message.md"
LAST_CHART_PATH = SITE_DIR / "index.html"
LAST_PREVIEW_PATH = SITE_DIR / "last_preview.png"
PREVIEWS_DIR = SITE_DIR / "previews"
LAST_PREVIEWS_JSON = SITE_DIR / "last_previews.json"
META_CACHE_PATH = CACHE_DIR / "ticker_meta.json"
SKIP_PNG = False
PREVIEW_KEEP_DAYS = 7
PAGES_BASE_URL = "https://celowiz.github.io/monitor-b3"

# Regular + after-market window used to decide "intraday" price mode
B3_OPEN = time(10, 0)
B3_CLOSE = time(18, 0)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("b3-screener")


def configure_paths(
    site_dir: Path | None = None,
    cache_dir: Path | None = None,
    skip_png: bool | None = None,
) -> None:
    """Point publish/cache paths at SITE_DIR / CACHE_DIR (Actions or local)."""
    global SITE_DIR, CACHE_DIR, OUT_PATH, STATE_PATH, DAILY_CACHE_PATH
    global MESSAGE_PATH, LAST_CHART_PATH, LAST_PREVIEW_PATH, PREVIEWS_DIR
    global LAST_PREVIEWS_JSON, META_CACHE_PATH, SKIP_PNG, PREVIEW_KEEP_DAYS, PAGES_BASE_URL

    SITE_DIR = Path(site_dir or os.environ.get("SITE_DIR") or (ROOT / "site")).resolve()
    CACHE_DIR = Path(cache_dir or os.environ.get("CACHE_DIR") or (ROOT / ".cache")).resolve()
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH = SITE_DIR / "last_run.json"
    STATE_PATH = CACHE_DIR / "state.json"
    DAILY_CACHE_PATH = CACHE_DIR / "daily_cache.json"
    MESSAGE_PATH = SITE_DIR / "last_message.md"
    LAST_CHART_PATH = SITE_DIR / "index.html"
    LAST_PREVIEW_PATH = SITE_DIR / "last_preview.png"
    PREVIEWS_DIR = SITE_DIR / "previews"
    LAST_PREVIEWS_JSON = SITE_DIR / "last_previews.json"
    META_CACHE_PATH = CACHE_DIR / "ticker_meta.json"
    if skip_png is None:
        SKIP_PNG = os.environ.get("SKIP_PNG", "").strip().lower() in ("1", "true", "yes")
    else:
        SKIP_PNG = bool(skip_png)
    try:
        PREVIEW_KEEP_DAYS = max(1, int(os.environ.get("PREVIEW_KEEP_DAYS", "7")))
    except ValueError:
        PREVIEW_KEEP_DAYS = 7
    PAGES_BASE_URL = os.environ.get("PAGES_BASE_URL", PAGES_BASE_URL).rstrip("/")
    write_nojekyll(SITE_DIR)


def hydrate_state_from_pages() -> None:
    """If cache has no state.json, reuse last_run.json from the live Pages site."""
    if STATE_PATH.exists():
        return
    url = f"{PAGES_BASE_URL}/last_run.json"
    try:
        r = requests.get(url, timeout=20)
        if r.status_code != 200:
            log.info("No previous Pages last_run.json (%s %s)", r.status_code, url)
            return
        data = r.json()
    except Exception as e:
        log.info("Could not hydrate state from %s: %s", url, e)
        return
    if not isinstance(data, dict):
        return
    meta = data.get("metadata") or {}
    prices: dict[str, float] = {}
    for row in data.get("passing") or []:
        if not isinstance(row, dict):
            continue
        ticker = row.get("ticker")
        price = row.get("price")
        if ticker and price is not None:
            try:
                prices[str(ticker)] = float(price)
            except (TypeError, ValueError):
                continue
    state = {
        "run_at": meta.get("run_finished") or meta.get("run_started"),
        "prices": prices,
    }
    save_json(STATE_PATH, state)
    log.info("Hydrated %s from %s (%d prices)", STATE_PATH, url, len(prices))


def load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def load_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        log.warning("Could not read %s: %s", path, e)
        return None


def save_json(path: Path, data: dict) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def is_market_open(now: datetime | None = None) -> bool:
    """True during B3 weekday session approx 10:00–18:00 America/Sao_Paulo."""
    now = now or datetime.now(TZ)
    if now.weekday() >= 5:
        return False
    t = now.timetz().replace(tzinfo=None) if hasattr(now, "timetz") else now.time()
    # normalize: now.time() is fine for aware datetimes in Python
    t = now.time().replace(tzinfo=None) if now.tzinfo else now.time()
    return B3_OPEN <= t < B3_CLOSE


def fmt_number(value: float, decimals: int = 2) -> str:
    """pt-BR: dot thousands, comma decimal."""
    neg = value < 0
    v = abs(value)
    if decimals == 0:
        s = f"{int(round(v)):,}".replace(",", ".")
    else:
        s = f"{v:,.{decimals}f}"
        # 1,234.56 -> 1.234,56
        whole, frac = s.split(".")
        whole = whole.replace(",", ".")
        s = f"{whole},{frac}"
    return f"-{s}" if neg else s


def fmt_pct(frac: float, decimals: int = 1) -> str:
    """Signed percent from fraction, e.g. 0.225 -> +22,5%."""
    pct = frac * 100.0
    sign = "+" if pct >= 0 else ""
    return f"{sign}{fmt_number(pct, decimals)}%"


def fetch_universe(cfg: dict) -> list[str]:
    """Fetch B3 stock/unit tickers from brapi.dev, plus explicit BDR allowlist."""
    endings = tuple(cfg.get("ticker_endings", ["3", "4", "5", "6", "11"]))
    ending_re = "|".join(re.escape(e) for e in endings)
    pat = re.compile(rf"^([A-Z0-9]{{4}})({ending_re})$")

    url = "https://brapi.dev/api/v2/tickers"
    params = {"type": "stock", "limit": 1000, "page": 1}
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    payload = r.json()
    results = payload.get("results") or []

    pagination = payload.get("pagination") or {}
    total_pages = int(pagination.get("totalPages") or 1)
    for page in range(2, total_pages + 1):
        params["page"] = page
        rr = requests.get(url, params=params, timeout=60)
        rr.raise_for_status()
        results.extend(rr.json().get("results") or [])

    tickers: list[str] = []
    seen: set[str] = set()
    for item in results:
        sym = (item.get("symbol") or "").strip().upper()
        if not sym or sym in seen:
            continue
        if sym.endswith("F"):
            continue
        st = (item.get("subType") or "").lower()
        at = (item.get("assetType") or item.get("type") or "").lower()
        if st in ("etf", "fii", "bdr", "fi-infra", "fi-agro", "fip", "fidc") or at in (
            "fund",
            "bdr",
        ):
            continue
        if not pat.match(sym):
            continue
        seen.add(sym)
        tickers.append(sym)

    n_stocks = len(tickers)

    # Explicit BDR allowlist from config (editable); bypass stock ending filter
    bdr_allowlist = [
        str(t).strip().upper()
        for t in (cfg.get("bdr_allowlist") or [])
        if str(t).strip()
    ]
    added_bdrs: list[str] = []
    for sym in bdr_allowlist:
        if sym in seen:
            continue
        seen.add(sym)
        tickers.append(sym)
        added_bdrs.append(sym)

    tickers.sort()
    log.info(
        "Universe: %d stocks from brapi type=stock (raw=%d) + %d BDRs from allowlist -> %d total",
        n_stocks,
        len(results),
        len(added_bdrs),
        len(tickers),
    )
    if added_bdrs:
        log.info("BDRs added: %s", ", ".join(added_bdrs))
    return tickers


def download_history(
    tickers_sa: list[str], period: str, auto_adjust: bool, chunk_size: int, threads: bool
) -> tuple[dict[str, pd.DataFrame], list[str]]:
    """Batch-download daily OHLCV via yfinance. Returns {TICKER: df}, failed list."""
    frames: dict[str, pd.DataFrame] = {}
    failed: list[str] = []

    for i in range(0, len(tickers_sa), chunk_size):
        chunk = tickers_sa[i : i + chunk_size]
        log.info("Downloading chunk %d-%d / %d", i + 1, i + len(chunk), len(tickers_sa))
        try:
            raw = yf.download(
                tickers=chunk,
                period=period,
                interval="1d",
                auto_adjust=auto_adjust,
                group_by="ticker",
                threads=threads,
                progress=False,
            )
        except Exception as e:
            log.warning("Chunk download failed entirely: %s", e)
            failed.extend(t.replace(".SA", "") for t in chunk)
            continue

        if raw is None or raw.empty:
            failed.extend(t.replace(".SA", "") for t in chunk)
            continue

        if len(chunk) == 1:
            t = chunk[0]
            df = raw.copy()
            if isinstance(df.columns, pd.MultiIndex):
                try:
                    df = raw[t].copy()
                except Exception:
                    pass
            base = t.replace(".SA", "")
            if df.empty or "Close" not in df.columns:
                failed.append(base)
            else:
                frames[base] = df.dropna(how="all")
            continue

        for t in chunk:
            base = t.replace(".SA", "")
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if t not in raw.columns.get_level_values(0):
                        failed.append(base)
                        continue
                    df = raw[t].copy()
                else:
                    failed.append(base)
                    continue
                df = df.dropna(how="all")
                if df.empty or "Close" not in df.columns or df["Close"].dropna().empty:
                    failed.append(base)
                    continue
                frames[base] = df
            except Exception as e:
                log.debug("Parse fail %s: %s", t, e)
                failed.append(base)

    return frames, failed


def session_date(ts) -> str:
    """Normalize an index timestamp to YYYY-MM-DD in America/Sao_Paulo."""
    if hasattr(ts, "to_pydatetime"):
        ts = ts.to_pydatetime()
    if getattr(ts, "tzinfo", None) is not None:
        ts = ts.astimezone(TZ)
    return f"{ts.year:04d}-{ts.month:02d}-{ts.day:02d}"


def compute_reference(
    df: pd.DataFrame,
    liq_n: int,
    high_n: int,
    today: str,
    market_open: bool,
) -> dict | None:
    """
    Compute high52_ex and liq21 from daily history.
    - Market closed: latest bar = today; high52 excludes that bar; liq21 uses last liq_n bars incl. today.
    - Market open: exclude today's incomplete bar from both high52 and liq21 (completed sessions only).
    """
    need_cols = {"High", "Close", "Volume"}
    if not need_cols.issubset(set(df.columns)):
        return None

    sub = df[["High", "Close", "Volume"]].dropna(how="any").copy()
    if sub.empty:
        return None

    # Drop today's incomplete candle when market is open
    if market_open:
        mask = [session_date(idx) < today for idx in sub.index]
        completed = sub.loc[mask]
    else:
        completed = sub

    if len(completed) < max(liq_n, 30):
        return None

    # For high52: exclude the "candle being evaluated".
    # Closed: that candle is the latest completed bar (today).
    # Open: that candle is today (already dropped); high52 over prior completed sessions.
    if market_open:
        high_pool = completed.tail(high_n)
        price_close = float(completed.iloc[-1]["Close"])  # last completed close (fallback)
        data_as_of = session_date(completed.index[-1])
        liq_window = completed.tail(liq_n)
    else:
        if len(completed) < 2:
            return None
        latest = completed.iloc[-1]
        prior = completed.iloc[:-1]
        high_pool = prior.tail(high_n)
        price_close = float(latest["Close"])
        data_as_of = session_date(completed.index[-1])
        liq_window = completed.tail(liq_n)

    if high_pool.empty:
        return None

    high52_ex = float(high_pool["High"].max())
    financial = liq_window["Close"] * liq_window["Volume"]
    liq21 = float(financial.mean())

    return {
        "high52_ex": round(high52_ex, 4),
        "liq21": round(liq21, 2),
        "liq21_mi": round(liq21 / 1e6, 2),
        "price_close": round(price_close, 4),
        "data_as_of": data_as_of,
        "n_sessions": int(len(completed)),
    }


def fetch_live_prices(tickers: list[str], chunk_size: int = 40) -> dict[str, float]:
    """
    Best-effort latest prices for intraday mode.
    Tries yf.download 1m/5m last bars, then Ticker.fast_info.
    """
    prices: dict[str, float] = {}
    if not tickers:
        return prices

    tickers_sa = [f"{t}.SA" for t in tickers]

    # Prefer 5m bars (more reliable batch than 1m for many symbols)
    for interval in ("5m", "1m"):
        remaining = [t for t in tickers_sa if t.replace(".SA", "") not in prices]
        if not remaining:
            break
        for i in range(0, len(remaining), chunk_size):
            chunk = remaining[i : i + chunk_size]
            try:
                raw = yf.download(
                    tickers=chunk,
                    period="1d",
                    interval=interval,
                    auto_adjust=True,
                    group_by="ticker",
                    threads=True,
                    progress=False,
                )
            except Exception as e:
                log.debug("Intraday %s chunk failed: %s", interval, e)
                continue
            if raw is None or raw.empty:
                continue

            if len(chunk) == 1:
                t = chunk[0]
                base = t.replace(".SA", "")
                df = raw
                if isinstance(df.columns, pd.MultiIndex):
                    try:
                        df = raw[t]
                    except Exception:
                        continue
                if "Close" in df.columns and not df["Close"].dropna().empty:
                    prices[base] = float(df["Close"].dropna().iloc[-1])
                continue

            if not isinstance(raw.columns, pd.MultiIndex):
                continue
            for t in chunk:
                base = t.replace(".SA", "")
                if base in prices:
                    continue
                try:
                    if t not in raw.columns.get_level_values(0):
                        continue
                    s = raw[t]["Close"].dropna()
                    if not s.empty:
                        prices[base] = float(s.iloc[-1])
                except Exception:
                    continue

    # Fallback: fast_info one-by-one for missing
    missing = [t for t in tickers if t not in prices]
    for t in missing:
        try:
            info = yf.Ticker(f"{t}.SA").fast_info
            px = None
            for key in ("last_price", "lastPrice", "regular_market_price", "regularMarketPrice"):
                if hasattr(info, key):
                    px = getattr(info, key)
                    break
                if isinstance(info, dict) and key in info:
                    px = info[key]
                    break
            if px is not None and px == px:  # not NaN
                prices[t] = float(px)
        except Exception:
            continue

    log.info("Live prices fetched: %d / %d", len(prices), len(tickers))
    return prices


def build_daily_cache(
    universe: list[str],
    frames: dict[str, pd.DataFrame],
    failed: list[str],
    liq21_min: float,
    liq_n: int,
    high_n: int,
    today: str,
    market_open: bool,
) -> dict:
    refs: dict[str, dict] = {}
    insufficient = 0
    for t, df in frames.items():
        ref = compute_reference(df, liq_n=liq_n, high_n=high_n, today=today, market_open=market_open)
        if ref is None:
            insufficient += 1
            continue
        refs[t] = {
            **ref,
            "passes_liq": ref["liq21"] > liq21_min,
        }

    return {
        "date": today,
        "market_open_when_built": market_open,
        "universe": universe,
        "failed": failed,
        "insufficient_history": insufficient,
        "refs": refs,
    }


def evaluate_from_refs(
    refs: dict[str, dict],
    prices: dict[str, float],
    liq21_min: float,
) -> list[dict]:
    """Combine cached reference metrics with current prices."""
    rows: list[dict] = []
    for t, ref in refs.items():
        if t not in prices:
            continue
        price = float(prices[t])
        high52_ex = float(ref["high52_ex"])
        liq21 = float(ref["liq21"])
        passes_liq = liq21 > liq21_min
        passes_breakout = price > high52_ex
        pct_above = (price / high52_ex - 1.0) if high52_ex > 0 else None
        rows.append(
            {
                "ticker": t,
                "price": round(price, 4),
                "high52_ex": round(high52_ex, 4),
                "pct_above": round(pct_above, 6) if pct_above is not None else None,
                "liq21": round(liq21, 2),
                "liq21_mi": round(liq21 / 1e6),  # whole R$ mi for display/storage
                "passes_liq": passes_liq,
                "passes_breakout": passes_breakout,
                "passes": passes_liq and passes_breakout,
                "data_as_of": ref.get("data_as_of"),
            }
        )
    return rows



def frame_to_ohlcv(df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    """Convert daily OHLCV frame to lightweight-charts candle + volume series (no nulls)."""
    need = {"Open", "High", "Low", "Close", "Volume"}
    if not need.issubset(set(df.columns)):
        return [], []
    sub = df[["Open", "High", "Low", "Close", "Volume"]].dropna(how="any").copy()
    candles: list[dict] = []
    volumes: list[dict] = []
    seen_dates: set[str] = set()
    for idx, row in sub.iterrows():
        d = session_date(idx)
        if d in seen_dates:
            continue
        seen_dates.add(d)
        o = round(float(row["Open"]), 2)
        h = round(float(row["High"]), 2)
        l = round(float(row["Low"]), 2)
        c = round(float(row["Close"]), 2)
        v = float(row["Volume"])
        if not all(map(lambda x: x == x, (o, h, l, c, v))):  # NaN check
            continue
        # Ensure OHLC consistency after rounding
        h = max(h, o, c)
        l = min(l, o, c)
        candles.append({"time": d, "open": o, "high": h, "low": l, "close": c})
        color = "rgba(38, 166, 154, 0.5)" if c >= o else "rgba(239, 83, 80, 0.5)"
        volumes.append({"time": d, "value": int(v), "color": color})
    candles.sort(key=lambda x: x["time"])
    volumes.sort(key=lambda x: x["time"])
    return candles, volumes


def load_chart_ohlcv(
    tickers: list[str],
    frames: dict[str, pd.DataFrame] | None,
    period: str,
    auto_adjust: bool,
    chunk_size: int,
    threads: bool,
) -> dict[str, dict]:
    """Build {ticker: {candles, volumes}} for chart HTML; download missing from yfinance."""
    out: dict[str, dict] = {}
    missing: list[str] = []
    frames = frames or {}
    for t in tickers:
        if t in frames and not frames[t].empty:
            candles, volumes = frame_to_ohlcv(frames[t])
            if candles:
                out[t] = {"candles": candles, "volumes": volumes}
                continue
        missing.append(t)

    if missing:
        log.info("Downloading chart OHLCV for %d tickers", len(missing))
        downloaded, _failed = download_history(
            [f"{t}.SA" for t in missing],
            period=period,
            auto_adjust=auto_adjust,
            chunk_size=chunk_size,
            threads=threads,
        )
        for t in missing:
            if t not in downloaded:
                log.warning("No chart data for %s", t)
                continue
            candles, volumes = frame_to_ohlcv(downloaded[t])
            if candles:
                out[t] = {"candles": candles, "volumes": volumes}
            else:
                log.warning("Empty OHLCV after clean for %s", t)
    return out



def _normalize_brapi_meta(item: dict) -> dict:
    sym = (item.get("symbol") or "").strip().upper()
    name = (item.get("name") or "").strip() or None
    long_name = (item.get("longName") or "").strip() or None
    sector = (item.get("sector") or "").strip() or None
    subsector = (
        (item.get("subsector") or item.get("subSector") or "").strip() or None
    )
    logo = (item.get("logoUrl") or item.get("logo") or "").strip() or None
    # Prefer human name over ticker-looking name
    display = name
    if not display or display.upper() == sym:
        display = long_name or name
    return {
        "symbol": sym,
        "name": display,
        "longName": long_name,
        "sector": sector,
        "subsector": subsector,
        "logoUrl": logo,
        "assetType": item.get("assetType") or item.get("type"),
        "subType": item.get("subType"),
    }


def ensure_ticker_meta(tickers: list[str]) -> dict[str, dict]:
    """Return {ticker: meta} using ticker_meta.json cache; fetch missing from brapi."""
    raw = load_json(META_CACHE_PATH) or {}
    if isinstance(raw, dict) and isinstance(raw.get("tickers"), dict):
        store: dict = dict(raw["tickers"])
        updated_at = raw.get("updated_at")
    elif isinstance(raw, dict):
        store = {k: v for k, v in raw.items() if isinstance(v, dict)}
        updated_at = None
    else:
        store = {}
        updated_at = None

    needed = [t.upper() for t in tickers]
    missing = [t for t in needed if t not in store or not store[t].get("symbol")]
    if missing:
        log.info("Fetching brapi metadata for %d tickers (%d cached)", len(missing), len(store))
        found: set[str] = set()
        for typ in ("stock", "bdr"):
            page = 1
            while True:
                try:
                    rr = requests.get(
                        "https://brapi.dev/api/v2/tickers",
                        params={"type": typ, "limit": 1000, "page": page},
                        timeout=60,
                    )
                    rr.raise_for_status()
                    payload = rr.json()
                except Exception as e:
                    log.warning("brapi meta type=%s page=%s failed: %s", typ, page, e)
                    break
                for item in payload.get("results") or []:
                    sym = (item.get("symbol") or "").strip().upper()
                    if not sym:
                        continue
                    store[sym] = _normalize_brapi_meta(item)
                    if sym in missing:
                        found.add(sym)
                pag = payload.get("pagination") or {}
                if not pag.get("hasNextPage"):
                    break
                page += 1
        still = [t for t in missing if t not in found]
        for t in still:
            try:
                rr = requests.get(
                    "https://brapi.dev/api/v2/tickers",
                    params={"search": t, "limit": 10},
                    timeout=20,
                )
                rr.raise_for_status()
                for item in rr.json().get("results") or []:
                    if (item.get("symbol") or "").upper() == t:
                        store[t] = _normalize_brapi_meta(item)
                        break
            except Exception as e:
                log.debug("meta search %s failed: %s", t, e)
        save_json(
            META_CACHE_PATH,
            {
                "updated_at": datetime.now(TZ).isoformat(),
                "tickers": store,
            },
        )
        log.info("Wrote %s (%d tickers)", META_CACHE_PATH, len(store))
    else:
        log.info("Ticker meta cache hit for %d symbols", len(needed))

    out: dict[str, dict] = {}
    for t in needed:
        out[t] = store.get(t) or {
            "symbol": t,
            "name": None,
            "longName": None,
            "sector": None,
            "subsector": None,
            "logoUrl": None,
        }
    return out


def build_chart_table_rows(
    passed_final: list[dict],
    prev_state: dict | None,
    meta_by_ticker: dict[str, dict] | None = None,
) -> list[dict]:
    prev_prices: dict[str, float] = {}
    if prev_state and isinstance(prev_state.get("prices"), dict):
        prev_prices = {k: float(v) for k, v in prev_state["prices"].items()}
    meta_by_ticker = meta_by_ticker or {}

    rows: list[dict] = []
    for r in passed_final:
        t = r["ticker"]
        price = float(r["price"])
        high = float(r["high52_ex"])
        pct = float(r["pct_above"] or 0.0)
        liq_mi = int(round(float(r["liq21"]) / 1e6))
        chg_vs_prev = None
        if t in prev_prices and prev_prices[t] > 0:
            chg_vs_prev = price / prev_prices[t] - 1.0
            desde = fmt_pct(chg_vs_prev, 1)
        else:
            desde = "-"
        meta = meta_by_ticker.get(t) or {}
        company = meta.get("name") or meta.get("longName")
        sector = meta.get("sector")
        subsector = meta.get("subsector")
        tip_parts = [p for p in [company, sector, subsector] if p]
        rows.append(
            {
                "ticker": t,
                "price": round(price, 2),
                "high52_ex": round(high, 2),
                "pct_above": pct,
                "liq21_mi": liq_mi,
                "price_fmt": fmt_number(price, 2),
                "high_fmt": fmt_number(high, 2),
                "acima_fmt": fmt_pct(pct, 1),
                "liq_fmt": fmt_number(liq_mi, 0),
                "desde_fmt": desde,
                "chg_vs_prev": chg_vs_prev,
                "company": company,
                "sector": sector,
                "subsector": subsector,
                "logoUrl": meta.get("logoUrl"),
                "tooltip": " · ".join(tip_parts) if tip_parts else t,
            }
        )
    return rows


def write_monitor_chart(
    run_at: datetime,
    header_line: str,
    table_rows: list[dict],
    ohlcv_by_ticker: dict[str, dict],
) -> Path:
    """Write self-contained lightweight-charts v5 HTML to the stable Pages index.html."""
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    out_path = LAST_CHART_PATH

    series_payload = {}
    filtered_rows = []
    for row in table_rows:
        t = row["ticker"]
        if t not in ohlcv_by_ticker:
            continue
        filtered_rows.append(row)
        series_payload[t] = {
            "candles": ohlcv_by_ticker[t]["candles"],
            "volumes": ohlcv_by_ticker[t]["volumes"],
            "high52_ex": row["high52_ex"],
            "meta": row,
        }

    payload = {
        "title": "Monitor B3: rompimento da máxima de 52 semanas",
        "header": header_line,
        "generated_at": run_at.isoformat(),
        "rows": filtered_rows,
        "series": series_payload,
        "default_ticker": filtered_rows[0]["ticker"] if filtered_rows else None,
    }
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Monitor B3 — gráficos</title>
<script src="https://unpkg.com/lightweight-charts@5/dist/lightweight-charts.standalone.production.js"></script>
<style>
  :root {{
    --bg: #12151c;
    --panel: #1a1f2b;
    --border: #2a3142;
    --text: #e6eaf2;
    --muted: #9aa3b5;
    --accent: #5b8def;
    --up: #26a69a;
    --down: #ef5350;
    --row-hover: #232a3a;
    --row-active: #2b3550;
  }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; height: 100%; background: var(--bg); color: var(--text);
    font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }}
  .wrap {{ display: grid; grid-template-columns: minmax(320px, 420px) 1fr; height: 100vh; gap: 0; }}
  @media (max-width: 960px) {{
    .wrap {{ grid-template-columns: 1fr; grid-template-rows: auto 1fr; height: auto; min-height: 100vh; }}
  }}
  .sidebar {{ background: var(--panel); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; min-height: 0; overflow: hidden; }}
  .side-head {{ padding: 14px 14px 10px; border-bottom: 1px solid var(--border); }}
  .side-head h1 {{ margin: 0 0 6px; font-size: 15px; font-weight: 650; }}
  .side-head .meta {{ margin: 0; font-size: 12px; color: var(--muted); line-height: 1.4; }}
  .side-controls {{ padding: 10px 14px; border-bottom: 1px solid var(--border); }}
  .side-controls label {{ display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; }}
  .side-controls select {{ width: 100%; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 13px; }}
  .table-wrap {{ overflow: auto; flex: 1; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
  th, td {{ padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }}
  th {{ position: sticky; top: 0; background: #161b27; color: var(--muted);
    font-weight: 600; text-align: right; z-index: 1; cursor: pointer; user-select: none; }}
  th:hover {{ color: var(--text); }}
  th .sort-ind {{ margin-left: 4px; opacity: 0.35; font-size: 10px; }}
  th.sorted .sort-ind {{ opacity: 1; color: var(--accent); }}
  th:first-child, td:first-child {{ text-align: left; }}
  td {{ text-align: right; font-variant-numeric: tabular-nums; }}
  tbody tr {{ cursor: pointer; }}
  tbody tr:hover {{ background: var(--row-hover); }}
  tbody tr.active {{ background: var(--row-active); }}
  .pos {{ color: var(--up); }}
  .neg {{ color: var(--down); }}
  .main {{ display: flex; flex-direction: column; min-width: 0; min-height: 0; }}
  #previewCapture {{ display: flex; flex-direction: column; flex: 1; min-height: 0; background: var(--bg); }}
  .chart-head {{ padding: 14px 18px 10px; border-bottom: 1px solid var(--border); background: var(--panel); }}
  .ident {{ display: flex; align-items: center; gap: 14px; min-height: 80px; }}
  .ident .logo {{ width: 76px; height: 76px; border-radius: 10px; background: #0e121a;
    border: 1px solid var(--border); object-fit: contain; flex-shrink: 0; display: none; }}
  .ident .logo.show {{ display: block; }}
  .ident .titles {{ min-width: 0; }}
  .ident .sym {{ font-size: 20px; font-weight: 700; letter-spacing: 0.02em; line-height: 1.15; }}
  .ident .company {{ font-size: 13px; color: var(--text); margin-top: 2px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; max-width: 70vw; }}
  .ident .company:empty {{ display: none; }}
  .ident .sec {{ font-size: 12px; color: var(--muted); margin-top: 2px; }}
  .ident .sec:empty {{ display: none; }}
  .chart-head .stats {{ margin-top: 10px; display: flex; flex-wrap: wrap; gap: 14px;
    font-size: 13px; color: var(--muted); }}
  .chart-head .stats b {{ color: var(--text); font-weight: 600; }}
  #chart {{ flex: 1; min-height: 420px; width: 100%; }}
  .foot {{ padding: 8px 18px; font-size: 11px; color: var(--muted);
    border-top: 1px solid var(--border); background: var(--panel); }}
</style>
</head>
<body>
<div class="wrap">
  <aside class="sidebar">
    <div class="side-head">
      <h1>Monitor B3: rompimento da máxima de 52 semanas</h1>
      <p class="meta" id="headerMeta"></p>
      <p class="meta">Ferramenta educacional. Não é recomendação de investimento.</p>
    </div>
    <div class="side-controls">
      <label for="tickerSelect">Ticker</label>
      <select id="tickerSelect"></select>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th data-key="ticker" data-type="str">Ticker<span class="sort-ind"></span></th>
            <th data-key="price" data-type="num">Preço<span class="sort-ind"></span></th>
            <th data-key="high52_ex" data-type="num">Máx. 52s<span class="sort-ind"></span></th>
            <th data-key="pct_above" data-type="num">Acima<span class="sort-ind"></span></th>
            <th data-key="liq21_mi" data-type="num">Liq. 21d<span class="sort-ind"></span></th>
            <th data-key="chg_vs_prev" data-type="num">Desde últ.<span class="sort-ind"></span></th>
          </tr>
        </thead>
        <tbody id="tickerBody"></tbody>
      </table>
    </div>
  </aside>
  <section class="main">
    <div id="previewCapture">
      <div class="chart-head">
        <div class="ident">
          <img id="chartLogo" class="logo" alt="" referrerpolicy="no-referrer"/>
          <div class="titles">
            <div class="sym" id="chartSym">—</div>
            <div class="company" id="chartCompany"></div>
            <div class="sec" id="chartSector"></div>
          </div>
        </div>
        <div class="stats" id="chartStats"></div>
      </div>
      <div id="chart"></div>
    </div>
    <div class="foot">Ferramenta educacional — não é recomendação de investimento. Dados diários yfinance (auto_adjust) · linha tracejada = máxima de 52 semanas (ex-candle atual) · metadados brapi.dev</div>
  </section>
</div>
<script id="monitor-data" type="application/json">{payload_json}</script>
<script>
(function () {{
  const raw = document.getElementById('monitor-data').textContent;
  const DATA = JSON.parse(raw);
  document.getElementById('headerMeta').textContent = DATA.header || '';

  const select = document.getElementById('tickerSelect');
  const tbody = document.getElementById('tickerBody');
  const chartEl = document.getElementById('chart');
  const logoEl = document.getElementById('chartLogo');

  function buildRow(row) {{
    const tr = document.createElement('tr');
    tr.dataset.ticker = row.ticker;
    tr.dataset.price = String(row.price);
    tr.dataset.high52_ex = String(row.high52_ex);
    tr.dataset.pct_above = String(row.pct_above);
    tr.dataset.liq21_mi = String(row.liq21_mi);
    const dv = (row.chg_vs_prev === null || row.chg_vs_prev === undefined) ? null : Number(row.chg_vs_prev);
    tr.dataset.chg_vs_prev = dv === null || !Number.isFinite(dv) ? '' : String(dv);
    tr.dataset.chgMissing = (dv === null || !Number.isFinite(dv)) ? '1' : '0';
    if (row.tooltip) tr.title = row.tooltip;
    const acimaClass = row.pct_above >= 0 ? 'pos' : 'neg';
    const desdeClass = row.desde_fmt.startsWith('-') && row.desde_fmt !== '-' ? 'neg'
      : (row.desde_fmt.startsWith('+') ? 'pos' : '');
    tr.innerHTML = [
      '<td>' + row.ticker + '</td>',
      '<td>' + row.price_fmt + '</td>',
      '<td>' + row.high_fmt + '</td>',
      '<td class="' + acimaClass + '">' + row.acima_fmt + '</td>',
      '<td>' + row.liq_fmt + '</td>',
      '<td class="' + desdeClass + '">' + row.desde_fmt + '</td>',
    ].join('');
    tr.addEventListener('click', () => selectTicker(row.ticker));
    return tr;
  }}

  // Populate dropdown once (order independent of table sort)
  DATA.rows.forEach((row) => {{
    const opt = document.createElement('option');
    opt.value = row.ticker;
    opt.textContent = row.ticker + '  ' + row.acima_fmt;
    select.appendChild(opt);
  }});

  let sortKey = 'pct_above';
  let sortDir = 'desc'; // default = Acima desc (same as DATA.rows order)

  function cmpRows(a, b) {{
    const key = sortKey;
    const dir = sortDir === 'asc' ? 1 : -1;
    if (key === 'chg_vs_prev') {{
      const am = a.dataset.chgMissing === '1';
      const bm = b.dataset.chgMissing === '1';
      if (am && bm) return a.dataset.ticker.localeCompare(b.dataset.ticker);
      if (am) return 1;  // missing always last
      if (bm) return -1;
      const av = parseFloat(a.dataset.chg_vs_prev);
      const bv = parseFloat(b.dataset.chg_vs_prev);
      if (av === bv) return a.dataset.ticker.localeCompare(b.dataset.ticker);
      return av < bv ? -dir : dir;
    }}
    if (key === 'ticker') {{
      const c = a.dataset.ticker.localeCompare(b.dataset.ticker);
      return dir === 1 ? c : -c;
    }}
    const av = parseFloat(a.dataset[key]);
    const bv = parseFloat(b.dataset[key]);
    if (av === bv) return a.dataset.ticker.localeCompare(b.dataset.ticker);
    return av < bv ? -dir : dir;
  }}

  function renderTable() {{
    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.sort(cmpRows);
    rows.forEach(tr => tbody.appendChild(tr));
    document.querySelectorAll('thead th').forEach(th => {{
      const active = th.dataset.key === sortKey;
      th.classList.toggle('sorted', active);
      const ind = th.querySelector('.sort-ind');
      if (ind) ind.textContent = active ? (sortDir === 'asc' ? '▲' : '▼') : '';
    }});
    // keep active row highlight after re-order
    const cur = select.value;
    tbody.querySelectorAll('tr').forEach(tr => {{
      tr.classList.toggle('active', tr.dataset.ticker === cur);
    }});
  }}

  DATA.rows.forEach((row) => tbody.appendChild(buildRow(row)));
  document.querySelectorAll('thead th[data-key]').forEach(th => {{
    th.addEventListener('click', () => {{
      const key = th.dataset.key;
      if (sortKey === key) {{
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      }} else {{
        sortKey = key;
        sortDir = key === 'ticker' ? 'asc' : 'desc';
      }}
      renderTable();
    }});
  }});
  renderTable();

  const chart = LightweightCharts.createChart(chartEl, {{
    autoSize: true,
    layout: {{
      background: {{ color: '#12151c' }},
      textColor: '#9aa3b5',
      attributionLogo: false,
    }},
    grid: {{
      vertLines: {{ color: '#1e2430' }},
      horzLines: {{ color: '#1e2430' }},
    }},
    rightPriceScale: {{ borderColor: '#2a3142' }},
    timeScale: {{
      borderColor: '#2a3142',
      timeVisible: false,
    }},
    crosshair: {{ mode: LightweightCharts.CrosshairMode.Normal }},
  }});

  const candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {{
    upColor: '#26a69a',
    downColor: '#ef5350',
    borderUpColor: '#26a69a',
    borderDownColor: '#ef5350',
    wickUpColor: '#26a69a',
    wickDownColor: '#ef5350',
  }});

  const volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {{
    priceFormat: {{ type: 'volume' }},
    priceScaleId: 'volume',
  }});
  chart.priceScale('volume').applyOptions({{
    scaleMargins: {{ top: 0.78, bottom: 0 }},
  }});
  chart.priceScale('right').applyOptions({{
    scaleMargins: {{ top: 0.08, bottom: 0.22 }},
  }});

  let priceLine = null;

  function setLogo(url) {{
    logoEl.classList.remove('show');
    logoEl.removeAttribute('src');
    if (!url) return;
    logoEl.onload = () => logoEl.classList.add('show');
    logoEl.onerror = () => {{
      logoEl.classList.remove('show');
      logoEl.removeAttribute('src');
    }};
    logoEl.src = url;
  }}

  function selectTicker(ticker) {{
    const pack = DATA.series[ticker];
    if (!pack) return;
    select.value = ticker;
    tbody.querySelectorAll('tr').forEach(tr => {{
      tr.classList.toggle('active', tr.dataset.ticker === ticker);
    }});

    const m = pack.meta;
    document.getElementById('chartSym').textContent = ticker;
    document.getElementById('chartCompany').textContent = m.company || '';
    const secParts = [];
    if (m.sector) secParts.push(m.sector);
    if (m.subsector) secParts.push(m.subsector);
    document.getElementById('chartSector').textContent = secParts.join(' · ');
    setLogo(m.logoUrl || '');

    document.getElementById('chartStats').innerHTML = [
      '<span>Preço <b>' + m.price_fmt + '</b></span>',
      '<span>Máx. 52s <b>' + m.high_fmt + '</b></span>',
      '<span>Acima <b class="' + (m.pct_above >= 0 ? 'pos' : 'neg') + '">' + m.acima_fmt + '</b></span>',
      '<span>Liq. 21d <b>' + m.liq_fmt + ' mi</b></span>',
      '<span>Desde últ. <b>' + m.desde_fmt + '</b></span>',
    ].join('');

    candleSeries.setData(pack.candles);
    volumeSeries.setData(pack.volumes);
    if (priceLine) {{
      candleSeries.removePriceLine(priceLine);
      priceLine = null;
    }}
    priceLine = candleSeries.createPriceLine({{
      price: pack.high52_ex,
      color: '#5b8def',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Máx. 52s',
    }});
    chart.timeScale().fitContent();
  }}

  select.addEventListener('change', () => selectTicker(select.value));

  const initial = DATA.default_ticker || (DATA.rows[0] && DATA.rows[0].ticker);
  if (initial) selectTicker(initial);
  window.__b3SelectTicker = selectTicker;
  window.__b3Data = DATA;
  window.__b3ChartReady = true;
}})();
</script>
</body>
</html>
"""
    out_path.write_text(html, encoding="utf-8")
    write_nojekyll(SITE_DIR)
    log.info("Wrote chart HTML %s (%.1f KB)", out_path, out_path.stat().st_size / 1024)
    return out_path


def write_fallback_index(message: str, run_at: datetime) -> None:
    """Minimal index.html if the interactive chart cannot be generated."""
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    body = html_lib.escape(message)
    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Monitor B3</title>
<style>
  body {{ font-family: Inter, system-ui, sans-serif; background: #12151c; color: #e6eaf2;
    max-width: 840px; margin: 40px auto; padding: 0 16px; line-height: 1.45; }}
  pre {{ white-space: pre-wrap; background: #1a1f2b; padding: 16px; border-radius: 8px; }}
  .muted {{ color: #9aa3b5; font-size: 13px; }}
</style>
</head>
<body>
<h1>Monitor B3: rompimento da máxima de 52 semanas</h1>
<p>Ferramenta educacional. Não é recomendação de investimento.</p>
<p class="muted">{html_lib.escape(run_at.isoformat())}</p>
<pre>{body}</pre>
</body>
</html>
"""
    LAST_CHART_PATH.write_text(html, encoding="utf-8")
    write_nojekyll(SITE_DIR)
    log.info("Wrote fallback %s", LAST_CHART_PATH)


def render_chart_preview_png(
    html_path: Path,
    run_at: datetime,
    tickers: list[str] | None = None,
) -> Path | None:
    """Headless screenshots of #previewCapture via a single Playwright page.

    Each ticker (table order) -> previews/YYYY-MM-DD/HH-MM/NN_TICKER.png
    (America/Sao_Paulo clock). Also copies the first success to last_preview.png.
    Writes last_previews.json with paths relative to the site root.
    """
    if SKIP_PNG:
        log.info("SKIP_PNG set — not taking Playwright screenshots")
        LAST_PREVIEWS_JSON.write_text("[]\n", encoding="utf-8")
        return None

    run_dir = preview_run_dir(SITE_DIR, run_at)
    run_dir.mkdir(parents=True, exist_ok=True)
    tickers = list(tickers or [])
    previews: list[dict] = []
    top_png: Path | None = None
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        log.warning("Playwright not available for PNG preview: %s", e)
        LAST_PREVIEWS_JSON.write_text("[]\n", encoding="utf-8")
        return None

    uri = html_path.resolve().as_uri()
    launch_args = ["--disable-dev-shm-usage"]
    if os.environ.get("GITHUB_ACTIONS"):
        launch_args.append("--no-sandbox")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=launch_args)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 820})
                page.goto(uri, wait_until="domcontentloaded", timeout=90000)
                page.wait_for_function("window.__b3ChartReady === true", timeout=30000)
                # Allow CDN script + first paint + optional logo
                page.wait_for_timeout(2500)
                page.wait_for_selector("#chart canvas", timeout=20000)
                page.wait_for_timeout(800)
                el = page.locator("#previewCapture")

                available = set(
                    page.evaluate("Object.keys((window.__b3Data||{}).series||{})")
                    or []
                )
                for idx, t in enumerate(tickers, start=1):
                    if available and t not in available:
                        log.warning("No chart data for %s — skipping per-ticker PNG", t)
                        continue
                    try:
                        page.evaluate("(t) => window.__b3SelectTicker(t)", t)
                        page.wait_for_function(
                            """(t) => {
                                if (document.getElementById('chartSym').textContent !== t) return false;
                                const img = document.getElementById('chartLogo');
                                return !img.getAttribute('src') || img.complete;
                            }""",
                            arg=t,
                            timeout=5000,
                        )
                        page.evaluate(
                            "() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))"
                        )
                        page.wait_for_timeout(120)
                        rel = preview_relpath(run_at, idx, t)
                        png = SITE_DIR / rel
                        png.parent.mkdir(parents=True, exist_ok=True)
                        el.screenshot(path=str(png))
                        previews.append({"ticker": t, "path": rel})
                        if top_png is None:
                            top_png = png
                    except Exception as e:
                        log.warning("Per-ticker PNG failed for %s: %s", t, e)
            finally:
                browser.close()
    except Exception as e:
        log.exception("PNG preview failed: %s", e)
    finally:
        try:
            LAST_PREVIEWS_JSON.write_text(
                json.dumps(previews, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            log.info(
                "Wrote %s (%d per-ticker PNGs under %s)",
                LAST_PREVIEWS_JSON,
                len(previews),
                run_dir,
            )
        except Exception as e:
            log.warning("Could not write %s: %s", LAST_PREVIEWS_JSON, e)

    if top_png is None:
        return None

    try:
        shutil.copyfile(top_png, LAST_PREVIEW_PATH)
    except Exception as e:
        log.warning("Could not copy last_preview.png: %s", e)

    log.info(
        "Wrote preview PNG %s (%.1f KB) and %s",
        top_png,
        top_png.stat().st_size / 1024,
        LAST_PREVIEW_PATH,
    )
    return top_png



def render_message(
    run_at: datetime,
    prev_state: dict | None,
    universe_size: int,
    passed_liq: int,
    passed_final: list[dict],
    failed: list[str],
    market_open: bool,
) -> str:
    prev_prices: dict[str, float] = {}
    if prev_state and isinstance(prev_state.get("prices"), dict):
        prev_prices = {k: float(v) for k, v in prev_state["prices"].items()}

    if prev_state and prev_state.get("run_at"):
        try:
            prev_dt = datetime.fromisoformat(prev_state["run_at"])
            if prev_dt.tzinfo is None:
                prev_dt = prev_dt.replace(tzinfo=TZ)
            else:
                prev_dt = prev_dt.astimezone(TZ)
            prev_label = prev_dt.strftime("%d/%m %H:%M")
        except (TypeError, ValueError):
            prev_label = "nenhuma"
            prev_prices = {}
    else:
        prev_label = "nenhuma"

    lines: list[str] = []
    lines.append("**Monitor B3: rompimento da máxima de 52 semanas**")
    lines.append(
        f"{run_at.strftime('%d/%m/%Y %H:%M')} · Universo: {universe_size} · "
        f"Liquidez OK: {passed_liq} · Romperam: {len(passed_final)} · "
        f"Rodada anterior: {prev_label}"
    )
    lines.append("")
    lines.append(
        "| Ticker | Preço | Máx. 52s | Acima | Liq. 21d (R$ mi) | Desde última rodada |"
    )
    lines.append(
        "|--------|------:|---------:|------:|-----------------:|--------------------:|"
    )

    for r in passed_final:
        t = r["ticker"]
        price = r["price"]
        high = r["high52_ex"]
        pct = r["pct_above"] or 0.0
        liq_mi = int(round(r["liq21"] / 1e6))

        if t in prev_prices and prev_prices[t] > 0:
            chg = price / prev_prices[t] - 1.0
            desde = fmt_pct(chg, 1)
        else:
            desde = "-"

        lines.append(
            f"| {t} | {fmt_number(price, 2)} | {fmt_number(high, 2)} | "
            f"{fmt_pct(pct, 1)} | {fmt_number(liq_mi, 0)} | {desde} |"
        )

    mode = "intraday" if market_open else "fechamento"
    fail_txt = ", ".join(failed) if failed else "nenhum"
    lines.append("")
    lines.append(
        f"_Fontes: brapi.dev (universo) + yfinance ({mode}, auto_adjust). "
        f"Falhas: {fail_txt}._"
    )
    lines.append("")
    lines.append(
        "_Ferramenta educacional. Não constitui recomendação de investimento, "
        "oferta ou solicitação de compra ou venda de valores mobiliários._"
    )
    return "\n".join(lines) + "\n"


def run(config_path: Path = CONFIG_PATH, out_path: Path | None = None) -> dict:
    cfg = load_config(config_path)
    filters = cfg.get("filters", {})
    yf_cfg = cfg.get("yfinance", {})
    if out_path is None:
        out_path = OUT_PATH

    liq21_min = float(filters.get("liq21_min_brl", 5_000_000))
    liq_n = int(filters.get("liq_lookback_sessions", 21))
    high_n = int(filters.get("high_lookback_sessions", 252))
    period = yf_cfg.get("period", "13mo")
    auto_adjust = bool(yf_cfg.get("auto_adjust", True))
    chunk_size = int(yf_cfg.get("chunk_size", 40))
    threads = bool(yf_cfg.get("threads", True))

    run_started = datetime.now(TZ)
    today = run_started.strftime("%Y-%m-%d")
    market_open = is_market_open(run_started)
    log.info("Run at %s | market_open=%s | today=%s", run_started.isoformat(), market_open, today)
    log.info("SITE_DIR=%s CACHE_DIR=%s", SITE_DIR, CACHE_DIR)

    hydrate_state_from_pages()
    prev_state = load_json(STATE_PATH)
    daily_cache = load_json(DAILY_CACHE_PATH)
    frames: dict[str, pd.DataFrame] | None = None

    cache_ok = (
        isinstance(daily_cache, dict)
        and daily_cache.get("date") == today
        and isinstance(daily_cache.get("refs"), dict)
        and len(daily_cache["refs"]) > 0
    )

    if cache_ok:
        refs = daily_cache["refs"]
        universe = daily_cache.get("universe") or list(refs.keys())
        failed = list(daily_cache.get("failed") or [])
        insufficient = int(daily_cache.get("insufficient_history") or 0)
        fetched_ok = len(refs)
        if market_open:
            log.info(
                "Using daily_cache.json (%d refs) — fetching live prices only",
                len(refs),
            )
            candidates = [t for t, r in refs.items() if r.get("passes_liq")] or list(refs.keys())
            live = fetch_live_prices(candidates, chunk_size=chunk_size)
            prices = {}
            for t, r in refs.items():
                if t in live:
                    prices[t] = live[t]
                elif "price_close" in r:
                    prices[t] = float(r["price_close"])
        else:
            log.info(
                "Using daily_cache.json (%d refs) — market closed, using cached closes",
                len(refs),
            )
            prices = {t: float(r["price_close"]) for t, r in refs.items()}
        results = evaluate_from_refs(refs, prices, liq21_min)
    else:
        log.info("No valid daily cache for %s — full history download", today)

        universe = fetch_universe(cfg)
        tickers_sa = [f"{t}.SA" for t in universe]
        frames, failed = download_history(
            tickers_sa,
            period=period,
            auto_adjust=auto_adjust,
            chunk_size=chunk_size,
            threads=threads,
        )
        got = set(frames)
        for t in universe:
            if t not in got and t not in failed:
                failed.append(t)
        failed = sorted(set(failed))

        if not frames:
            log.error(
                "yfinance returned no OHLCV for the entire universe "
                "(%d tickers, %d reported failed). "
                "GitHub-hosted runners are sometimes blocked by Yahoo Finance (HTTP 403/429). "
                "Failing this job WITHOUT uploading a Pages artifact so the previous site stays online. "
                "Retry later via workflow_dispatch, or run locally: python screener.py",
                len(universe),
                len(failed),
            )
            raise RuntimeError(
                "yfinance returned no data — refusing to publish a broken site"
            )

        daily_cache = build_daily_cache(
            universe=universe,
            frames=frames,
            failed=failed,
            liq21_min=liq21_min,
            liq_n=liq_n,
            high_n=high_n,
            today=today,
            market_open=market_open,
        )
        save_json(DAILY_CACHE_PATH, daily_cache)
        log.info("Wrote %s (%d refs)", DAILY_CACHE_PATH, len(daily_cache["refs"]))

        refs = daily_cache["refs"]
        insufficient = int(daily_cache.get("insufficient_history") or 0)
        fetched_ok = len(frames)

        if market_open:
            candidates = [t for t, r in refs.items() if r.get("passes_liq")] or list(refs.keys())
            live = fetch_live_prices(candidates, chunk_size=chunk_size)
            prices = {}
            for t, r in refs.items():
                if t in live:
                    prices[t] = live[t]
                else:
                    prices[t] = float(r["price_close"])
        else:
            prices = {t: float(r["price_close"]) for t, r in refs.items()}

        results = evaluate_from_refs(refs, prices, liq21_min)

    passed_liq_rows = [r for r in results if r["passes_liq"]]
    passed_final = [r for r in results if r["passes"]]
    passed_final.sort(
        key=lambda r: (r["pct_above"] is not None, r["pct_above"] or 0),
        reverse=True,
    )

    data_dates = [r["data_as_of"] for r in results if r.get("data_as_of")]
    data_as_of = max(data_dates) if data_dates else today

    run_finished = datetime.now(TZ)
    message = render_message(
        run_at=run_finished,
        prev_state=prev_state,
        universe_size=len(universe),
        passed_liq=len(passed_liq_rows),
        passed_final=passed_final,
        failed=failed,
        market_open=market_open,
    )
    MESSAGE_PATH.write_text(message, encoding="utf-8")
    log.info("Wrote %s", MESSAGE_PATH)

    # Interactive chart HTML + static PNG preview for passing tickers
    try:
        header_line = message.splitlines()[1] if len(message.splitlines()) > 1 else ""
        pass_tickers = [r["ticker"] for r in passed_final]
        meta_by_ticker = ensure_ticker_meta(pass_tickers)
        table_rows = build_chart_table_rows(passed_final, prev_state, meta_by_ticker)
        ohlcv_by_ticker = load_chart_ohlcv(
            tickers=pass_tickers,
            frames=frames,
            period=period,
            auto_adjust=auto_adjust,
            chunk_size=chunk_size,
            threads=threads,
        )
        chart_path = write_monitor_chart(
            run_at=run_finished,
            header_line=header_line,
            table_rows=table_rows,
            ohlcv_by_ticker=ohlcv_by_ticker,
        )
        render_chart_preview_png(chart_path, run_finished, tickers=pass_tickers)
    except Exception as e:
        log.exception("Chart HTML/PNG generation failed: %s", e)
        if not LAST_CHART_PATH.exists():
            try:
                write_fallback_index(message, run_finished)
            except Exception as e2:
                log.warning("Fallback index.html failed: %s", e2)

    try:
        removed = prune_preview_days(PREVIEWS_DIR, PREVIEW_KEEP_DAYS, run_finished.date())
        if removed:
            log.info("Pruned old preview days: %s", ", ".join(removed))
    except Exception as e:
        log.warning("Preview prune failed: %s", e)

    # Persist previous-run state (only final passers' prices)
    new_state = {
        "run_at": run_finished.isoformat(),
        "prices": {r["ticker"]: r["price"] for r in passed_final},
    }
    save_json(STATE_PATH, new_state)
    log.info("Wrote %s (%d prices)", STATE_PATH, len(new_state["prices"]))

    payload = {
        "metadata": {
            "run_started": run_started.isoformat(),
            "run_finished": run_finished.isoformat(),
            "timezone": "America/Sao_Paulo",
            "market_open": market_open,
            "data_as_of": data_as_of,
            "universe_source": "https://brapi.dev/api/v2/tickers?type=stock + config bdr_allowlist",
            "price_source": "yfinance",
            "auto_adjust": auto_adjust,
            "period": period,
            "liq21_min_brl": liq21_min,
            "high_lookback_sessions": high_n,
            "liq_lookback_sessions": liq_n,
            "universe_size": len(universe),
            "fetched_ok": fetched_ok,
            "failed_count": len(failed),
            "failed_tickers": failed,
            "insufficient_history": insufficient,
            "evaluated": len(results),
            "passed_liquidity": len(passed_liq_rows),
            "passed_final": len(passed_final),
            "prev_run_at": (prev_state or {}).get("run_at"),
            "preview_dir": "previews/%s/%s" % preview_run_parts(run_finished),
            "disclaimer": "Ferramenta educacional. Não é recomendação de investimento.",
        },
        "passing": [
            {
                "ticker": r["ticker"],
                "price": r["price"],
                "high52_ex": r["high52_ex"],
                "pct_above": r["pct_above"],
                "liq21": r["liq21"],
                "liq21_mi": int(round(r["liq21"] / 1e6)),
                "data_as_of": r["data_as_of"],
                "chg_vs_prev": (
                    round(r["price"] / prev_state["prices"][r["ticker"]] - 1.0, 6)
                    if prev_state
                    and isinstance(prev_state.get("prices"), dict)
                    and r["ticker"] in prev_state["prices"]
                    and prev_state["prices"][r["ticker"]]
                    else None
                ),
            }
            for r in passed_final
        ],
    }
    save_json(out_path, payload)

    log.info(
        "Done. universe=%d ok=%d failed=%d liq=%d final=%d",
        len(universe),
        fetched_ok,
        len(failed),
        len(passed_liq_rows),
        len(passed_final),
    )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="B3 liquidity + 52w breakout screener")
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--out", type=Path, default=None, help="Override last_run.json path")
    parser.add_argument("--site-dir", type=Path, default=None, help="Pages publish directory")
    parser.add_argument("--cache-dir", type=Path, default=None, help="state/daily_cache directory")
    parser.add_argument("--skip-png", action="store_true", help="Skip Playwright screenshots")
    args = parser.parse_args()
    configure_paths(
        site_dir=args.site_dir,
        cache_dir=args.cache_dir,
        skip_png=True if args.skip_png else None,
    )
    out_path = args.out.resolve() if args.out else OUT_PATH
    try:
        run(config_path=args.config, out_path=out_path)
    except Exception:
        log.exception("Hard failure — screener aborted")
        print(f"OUTPUT last_message.md={MESSAGE_PATH}", flush=True)
        print(f"OUTPUT last_preview.png={LAST_PREVIEW_PATH}", flush=True)
        print(f"OUTPUT index.html={LAST_CHART_PATH}", flush=True)
        print(f"OUTPUT last_previews.json={LAST_PREVIEWS_JSON}", flush=True)
        return 1
    print(f"OUTPUT last_message.md={MESSAGE_PATH}", flush=True)
    print(f"OUTPUT last_preview.png={LAST_PREVIEW_PATH}", flush=True)
    print(f"OUTPUT index.html={LAST_CHART_PATH}", flush=True)
    print(f"OUTPUT last_run.json={out_path}", flush=True)
    print(f"OUTPUT last_previews.json={LAST_PREVIEWS_JSON}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
