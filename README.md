# Monitor B3 · construtor de telas

Painel educacional em blocos (estilo n8n, React Flow) para montar telas de **ações (incl. units), BDRs da allowlist, ETFs e FIIs do IFIX** combinando filtros e sinais. Toda a filtragem roda no navegador.

**Site:** https://celowiz.github.io/monitor-b3/

**Conteúdo educativo, não é recomendação de investimento.**

## Arquitetura (custo zero)

- `scripts/build_data.py` (GitHub Actions, ~30 min no pregão, dias úteis, pula feriados B3 via `b3_calendar.py`) gera:
  - `data/latest.json`: universo + indicadores por ticker, `failedTickers`, horário da rodada.
  - `data/candles/<TICKER>.json`: ~1 ano de candles diários + SMA50/SMA200/máx. 52s, carregado sob demanda.
- `web/`: Vite + React + TypeScript + `@xyflow/react` + `lightweight-charts`, base `/monitor-b3/`.
- Os dados vão **só no artefato do Pages** (nada é commitado a cada rodada). Falha na geração = nada publicado, site anterior continua no ar.
- Telas salvas ficam no `localStorage` do navegador (sem cadastro).

## Universo

| Tipo | Regra |
| --- | --- |
| Ação | brapi `type=stock`, finais 3/4/5/6 e units (11 com `subType=unit`, ex.: BPAC11, SANB11) |
| BDR | **somente** `bdr_allowlist` do `config.json` |
| ETF | brapi `subType=etf` com giro informado ≥ `fund_prefilter_turnover_brl` + `etf_static` |
| FII | carteira do dia do **IFIX** (API pública B3 `indexProxy/GetPortfolioDay`) |

Carteiras de Ibovespa, IFIX e Small Caps (SMLL) vêm da mesma API pública da B3, com cache em `data/index_constituents.json` (data da carteira incluída). Metadados (nome, setor, subsetor, logo) da brapi, cache em `data/ticker_meta.json`.

## Filtros e sinais

Filtros: tipo de ativo, setor/subsetor, liquidez média 21d (R$, padrão 5 mi), preço mínimo (padrão R$ 1), variação no dia (faixa %), lista de exclusão, posição vs SMA200, índice (Ibovespa / IFIX / Small Caps).

Sinais (combinados com E/OU):
1. **Máx. 52s**: preço > máxima dos 252 pregões anteriores, excluindo a barra de hoje.
2. **Mín. 52s**: preço < mínima dos 252 pregões anteriores, ex-hoje.
3. **Cruzamento SMA 50/200**: golden (SMA50 cruza acima da SMA200 hoje vs ontem) / death / ambos.
4. **Volume anormal**: volume de hoje / média dos 21 pregões anteriores ≥ N× (padrão 2×).
5. **RSI(14) Wilder**: < 30 ou > 70 (configurável), opção "entrou na faixa hoje".
6. **Força relativa 21d**: retorno 21d do ativo − retorno 21d do índice > X pp. Ações, units, BDRs e ETFs vs Ibovespa (`^BVSP`); FIIs vs IFIX usando o ETF **XFIX11** como proxy (o Yahoo não tem série diária do IFIX). Se o proxy falhar, FIIs caem para o Ibovespa.
7. **Gap de abertura**: (abertura hoje − fech. ontem)/fech. ontem, |gap| ≥ X% (padrão 2%), alta/baixa/ambos.
8. **Rompimento de faixa N dias**: fech. > máx. dos N fechamentos anteriores (N = 20/60), opção de perda da mínima.
9. **Sequência**: N fechamentos seguidos em alta (ou baixa) vs o anterior (padrão 3).

## Ressalvas

- Preços yfinance diários com `auto_adjust=True` em tudo (máximas históricas ajustadas por proventos).
- Durante o pregão a barra de hoje é **provisória** (atraso do Yahoo + até ~30 min do Actions).
- Liquidez = média de close × volume (aproxima o giro).
- Universo muda com o tempo (viés de sobrevivência); não é backtest.
- brapi free tier e Yahoo podem limitar/falhar: o JSON lista `failedTickers` e o cabeçalho mostra "parcial".

## Rodar localmente

```bash
pip install -r requirements.txt
python scripts/build_data.py --out web/public/data   # --limit 40 para universo reduzido
cd web && npm ci && npm run dev
```

O `screener.py` legado (rompimento de 52s com PNGs) continua no repo para o monitor local, mas não é mais publicado no Pages.
