"""Série ajustada total-return (proventos + eventos) a partir do Yahoo bruto, com correção de eventos não ajustados.

Por que não usar auto_adjust=True direto: o Yahoo às vezes (a) deixa grupamentos/desdobramentos sem ajustar ou os
aplica na data errada e (b) grava alguns pregões numa escala errada (ex.: XPML11 em jan/2026 aparece 1/103 do preço
por 3 pregões). Como o auto_adjust calcula o fator de cada provento dividindo pelo fechamento anterior, um preço
errado na véspera de um rendimento contamina TODO o histórico anterior (no XPML11 o fator virou 0,135).

Método (determinístico, só fontes gratuitas):
1. Yahoo com auto_adjust=False: OHLC já ajustado pelos desdobramentos que o Yahoo conhece, Volume, Dividends.
2. Saltos diários |ln(C_t/C_{t-1})| ≥ ln 1,5 (alta ≥ 50% ou queda ≥ 33%) são classificados, nesta ordem:
   a. ida-e-volta: dois saltos opostos em até 10 pregões cujo produto fica a menos de 25% de 1 e que são ambos
      ≥ 3× (ou, em até 3 pregões, ambos razões redondas) → trecho em escala errada; o trecho é reescalado pela
      média geométrica dos dois saltos;
   b. evento corporativo da B3 (grupamento, desdobramento, bonificação; dados públicos de sistemaswebb3-listados)
      com data-ex a até 5 pregões e multiplicador esperado a menos de 25% do salto → evento não ajustado; todo o
      histórico anterior é multiplicado pelo multiplicador exato do evento;
   c. razão "redonda" (2, 3, 4, 5, 8, 10, 20, 25, 50, 100, 1000 ou o inverso, a menos de 3%) com o volume mudando na
      proporção inversa (fator 2) → desdobramento/grupamento sem dado de evento; ajuste pela razão redonda;
   d. salto ≥ 3× logo após ≥ 3 pregões sem volume: preço de referência antes da listagem → trecho anterior descartado;
   e. senão: movimento real (se < 3×) ou "quebra não explicada" (≥ 3× num dia). Quebras ficam marcadas e o
      Histórico ignora as janelas que as atravessam.
3. Proventos (dividendos, JCP, rendimentos de FII) do próprio Yahoo, já na base do preço do Yahoo: fator
   (1 − D/C_{véspera}) aplicado a todo o histórico anterior, usando o preço JÁ corrigido. Proventos acima de 30% do
   preço só entram se o preço caiu de forma compatível na data-ex (±15%); senão são erro de escala e ficam de fora
   (registrados no relatório).
Resultado: OHLC total-return (o último fechamento é o preço de tela), Volume em ações na base atual.
"""
from __future__ import annotations

import base64
import json
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import requests

log = logging.getLogger("adjust")

JUMP = math.log(1.5)
BREAK = math.log(3.0)
TOL = math.log(1.25)
ROUND = (2, 3, 4, 5, 8, 10, 20, 25, 50, 100, 1000)
B3_URL = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/"
CLASS_ISIN = {"3": ("ACNOR",), "4": ("ACNPR",), "5": ("ACNPA",), "6": ("ACNPB",), "7": ("ACNPC",), "8": ("ACNPD",),
              "11": ("CDAM", "CTF", "UNT")}
MAX_DIV_YIELD = 0.30


@dataclass
class Fix:
    date: str
    kind: str          # spike | b3_event | round_split | stale_prefix | break | big_move | bad_dividend
    jump: float        # C_t / C_{t-1} no dado bruto (ou D/C para bad_dividend)
    factor: float | None = None
    note: str = ""


@dataclass
class Report:
    fixes: list[Fix] = field(default_factory=list)
    breaks: list[str] = field(default_factory=list)

    @property
    def corrected(self) -> bool:
        return any(f.kind in ("spike", "b3_event", "round_split", "stale_prefix") for f in self.fixes)


# ---------- eventos B3 ----------
def b3_multiplier(label: str, factor: float) -> float | None:
    """Preço depois / preço antes esperado para o evento (fator no formato da B3)."""
    lab = label.upper()
    if lab.startswith("GRUPAMENTO") and factor > 0:
        return 1 / factor                      # 0,01333 = 75 ações viram 1 → preço ×75
    if lab.startswith("DESDOBRAMENTO") or lab.startswith("BONIFICA"):
        return 1 / (1 + factor / 100)          # 100 = +100% de ações (2:1) → preço ÷2
    return None


def _num(s: str) -> float:
    return float(str(s).replace(".", "").replace(",", "."))


def parse_b3_stock_events(payload: dict, ticker: str) -> list[dict]:
    issuer, suffix = ticker[:4], ticker[4:]
    evs = []
    for e in payload.get("stockDividends") or []:
        m = b3_multiplier(e.get("label", ""), _num(e.get("factor", "0")))
        if m is None:
            continue
        try:
            last = pd.to_datetime(e["lastDatePrior"], dayfirst=True)
        except Exception:
            continue
        evs.append({"isin": e.get("isinCode", ""), "label": e["label"], "mult": m, "lastDatePrior": last})
    pref = [e for e in evs if e["isin"][2:6] == issuer and any(c in e["isin"] for c in CLASS_ISIN.get(suffix, ()))]
    out, seen = [], set()
    for e in pref or evs:  # sem ISIN da classe: eventos da empresa (costumam valer para todas as classes)
        k = (e["lastDatePrior"], round(e["mult"], 8))
        if k not in seen:
            seen.add(k)
            out.append(e)
    return out


def fetch_b3_events(tickers: list[str], cache: Path | None = None, ttl_h: float = 20) -> dict[str, list[dict]]:
    """Eventos de ações por ticker (lista vazia se a B3 não responder). Cache por emissor em `cache`."""
    store: dict = {}
    if cache and cache.exists():
        try:
            store = json.loads(cache.read_text())
        except Exception:
            store = {}
    now = time.time()
    issuers = sorted({t[:4] for t in tickers})
    todo = [i for i in issuers if now - store.get(i, {}).get("ts", 0) > ttl_h * 3600]

    def get(code):
        p = base64.b64encode(json.dumps({"issuingCompany": code, "language": "pt-br"}).encode()).decode()
        for attempt in range(2):
            try:
                r = requests.get(B3_URL + p, timeout=20)
                if r.ok:
                    d = r.json()
                    d = d[0] if isinstance(d, list) and d else d
                    return code, {"stockDividends": (d or {}).get("stockDividends") or []}
            except Exception:
                time.sleep(1 + attempt)
        return code, None

    ok = 0
    if todo:
        with ThreadPoolExecutor(8) as ex:
            for code, d in ex.map(get, todo):
                if d is not None:
                    store[code] = {"ts": now, **d}
                    ok += 1
        log.info("B3 eventos: %d/%d emissores atualizados (%d em cache)", ok, len(todo), len(issuers) - len(todo))
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(store))
    out = {}
    for t in tickers:
        d = store.get(t[:4])
        if d:
            evs = parse_b3_stock_events(d, t)
            for e in evs:
                e["lastDatePrior"] = pd.Timestamp(e["lastDatePrior"])
            out[t] = evs
    return out


# ---------- correção ----------
def _is_round(j: float) -> int | None:
    x = j if j >= 1 else 1 / j
    for k in ROUND:
        if abs(math.log(x / k)) < 0.03:
            return k
    return None


def clean(df: pd.DataFrame, events: list[dict] | None = None) -> tuple[pd.DataFrame, Report]:
    """df: Open/High/Low/Close/Volume[/Dividends] do Yahoo com auto_adjust=False. Retorna OHLCV total-return."""
    rep = Report()
    df = df.copy()
    idx = df.index
    dates = idx.tz_localize(None) if getattr(idx, "tz", None) is not None else idx
    c = df["Close"].to_numpy(dtype=float)
    n = len(c)
    scale = np.ones(n)            # multiplicador de preço (inverso no volume)
    if n < 3:
        return df, rep
    lj = np.full(n, np.nan)
    lj[1:] = np.log(c[1:] / c[:-1])
    cand = [i for i in range(1, n) if np.isfinite(lj[i]) and abs(lj[i]) >= JUMP]
    used: set[int] = set()
    start = 0
    vol = df["Volume"].to_numpy(dtype=float) if "Volume" in df else np.zeros(n)
    for i in cand:
        if i in used:
            continue
        d = str(dates[i].date())
        # a. ida-e-volta
        pair = next((j for j in cand if i < j <= i + 10 and j not in used and np.sign(lj[j]) != np.sign(lj[i])
                     and abs(lj[i] + lj[j]) < TOL
                     and ((abs(lj[i]) >= BREAK and abs(lj[j]) >= BREAK)            # escala muito errada (×3 ou mais)
                          or (j - i <= 3 and _is_round(math.exp(lj[i])) and _is_round(math.exp(lj[j]))))), None)
        if pair is not None:
            f = math.exp(-(lj[i] - lj[pair]) / 2)
            scale[i:pair] *= f
            used |= {i, pair}
            rep.fixes.append(Fix(d, "spike", float(math.exp(lj[i])), f, f"{pair - i} pregões em escala errada até {dates[pair - 1].date()}"))
            continue
        # b. evento B3
        hit = None
        for e in events or []:
            pos = int(np.searchsorted(dates, e["lastDatePrior"], side="right"))  # 1º pregão ex
            if abs(pos - i) <= 5 and abs(lj[i] - math.log(e["mult"])) < TOL:
                hit = e
                break
        if hit is not None:
            scale[:i] *= hit["mult"]
            used.add(i)
            rep.fixes.append(Fix(d, "b3_event", float(math.exp(lj[i])), hit["mult"], f"{hit['label']} com data-com {hit['lastDatePrior'].date()}"))
            continue
        # c. razão redonda + volume inverso
        k = _is_round(math.exp(lj[i]))
        if k:
            b, a = vol[max(0, i - 5):i], vol[i:i + 5]
            vb, va = (np.median(b[b > 0]) if (b > 0).any() else np.nan), (np.median(a[a > 0]) if (a > 0).any() else np.nan)
            m = k if lj[i] > 0 else 1 / k
            if np.isfinite(vb) and np.isfinite(va) and abs(math.log((va / vb) * m)) < math.log(2):
                scale[:i] *= m
                used.add(i)
                rep.fixes.append(Fix(d, "round_split", float(math.exp(lj[i])), m, "razão redonda com volume inverso"))
                continue
        # d. prefixo parado: salto ≥ 3× logo após ≥ 3 pregões sem volume = preço de referência antes da
        #    listagem/migração (ex.: NATU3 antes de 02/07/2025, XBCI11 antes de 26/08/2026) → descarta o trecho anterior
        if abs(lj[i]) >= BREAK and i >= 3 and (vol[i - 3:i] == 0).all():
            start = max(start, i)
            used.add(i)
            rep.fixes.append(Fix(d, "stale_prefix", float(math.exp(lj[i])), None, f"{i} pregões sem volume antes: descartados"))
            continue
        # e. sem explicação
        if abs(lj[i]) >= BREAK:
            rep.breaks.append(d)
            rep.fixes.append(Fix(d, "break", float(math.exp(lj[i])), None, "quebra ≥ 3× sem evento que explique"))
        else:
            rep.fixes.append(Fix(d, "big_move", float(math.exp(lj[i])), None, "movimento grande tratado como real"))
    for col in ("Open", "High", "Low", "Close"):
        if col in df:
            df[col] = df[col].to_numpy(dtype=float) * scale
    if "Volume" in df:
        df["Volume"] = df["Volume"].to_numpy(dtype=float) / scale
    if start:
        df, dates, scale = df.iloc[start:], dates[start:], scale[start:]
        n = len(df)
    # proventos → total-return
    cc = df["Close"].to_numpy(dtype=float)
    adj = np.ones(n)
    if "Dividends" in df:
        dv = df["Dividends"].fillna(0).to_numpy(dtype=float) * scale  # mesma base do preço corrigido
        for t in np.nonzero(dv > 0)[0]:
            if t == 0:
                continue
            y = dv[t] / cc[t - 1]
            # provento grande só vale se o preço caiu de forma compatível na data-ex (ex.: redução de capital)
            drop_ok = 0 < y < 1 and abs(math.log(cc[t] / cc[t - 1]) - math.log(1 - y)) < math.log(1.15)
            if not (0 < y < MAX_DIV_YIELD or drop_ok):
                rep.fixes.append(Fix(str(dates[t].date()), "bad_dividend", float(y), None, "provento > 30% do preço: ignorado"))
                continue
            adj[:t] *= 1 - y
    for col in ("Open", "High", "Low", "Close"):
        if col in df:
            df[col] = df[col].to_numpy(dtype=float) * adj
    return df.drop(columns=[x for x in ("Adj Close", "Dividends", "Stock Splits", "Capital Gains") if x in df]), rep


def break_mask(index: pd.Index, breaks: list[str], before: int, after: int) -> pd.Series:
    """True nos pregões cuja janela [t−before, t+after] contém uma quebra não explicada."""
    m = np.zeros(len(index), dtype=bool)
    dates = index.tz_localize(None) if getattr(index, "tz", None) is not None else index
    for b in breaks:
        p = int(np.searchsorted(dates, pd.Timestamp(b)))
        m[max(0, p - after):min(len(m), p + before + 1)] = True
    return pd.Series(m, index=index)
