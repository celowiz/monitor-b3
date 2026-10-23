# Monitor B3 · construtor de telas

Painel educacional em blocos (estilo n8n, React Flow) para montar telas de **ações (incl. units), BDRs da allowlist, ETFs e FIIs do IFIX** combinando filtros e sinais. Toda a filtragem roda no navegador.

**Site:** https://celowiz.github.io/monitor-b3/

**Conteúdo educativo, não é recomendação de investimento.**

## Arquitetura (custo zero)

- `scripts/build_data.py` (GitHub Actions, a cada 30 min nos dias úteis das 10:04 às 18:34 BRT + rodada tardia às 23:47 BRT; pula dias sem pregão na B3 e na NYSE via `b3_calendar.py`/`nyse_calendar.py`) gera:
  - `data/latest.json`: universo + indicadores por ticker, `failedTickers`, horário da rodada e `lastQuoteAt` (hora da última cotação do índice no Yahoo).
  - `data/candles/<TICKER>.json`: ~1 ano de candles diários + SMA50/SMA200/máx. 52s, carregado sob demanda.
  - `data/summary.json` (`web/scripts/summary.ts`, ~2 KB): amplitude e sinais do dia das ações líquidas da B3 (mesmas regras do app), lido pela página [Mercado Hoje](https://celowiz.github.io/mercado-hoje/) do portfólio. Campos de horário: `as_of` (data da barra), `as_of_ts` (data e hora: última cotação do índice ou, se ela não vier, a hora da rodada), `last_quote_at`, `quote_delay_min` (15) e `intraday` (`true` até a rodada de fechamento; `final` = `!intraday`).
- `web/`: Vite + React + TypeScript + `@xyflow/react` + `lightweight-charts`, base `/monitor-b3/`.
- Rodadas agendadas que trazem os mesmos números da publicação anterior (ex.: depois do fechamento) não republicam o Pages: `scripts/fingerprint.py` compara os dados, sem a hora da rodada, com `data/fingerprint.txt` do site no ar.
- Os dados vão **só no artefato do Pages** (nada é commitado a cada rodada). Falha na geração = nada publicado, site anterior continua no ar.
- Telas salvas ficam no `localStorage` do navegador (sem cadastro).

### Horários (dias úteis)

| BRT (America/Sao_Paulo) | cron (UTC) | O quê |
| --- | --- | --- |
| 10:04, 10:34, …, 18:04, 18:34 (a cada 30 min) | `4,34 13-21 * * 1-5` | pregão da B3 e da NYSE: números do dia **parciais** (selo "Intradiário · parcial") até a rodada de fechamento |
| 23:47 | `47 2 * * 2-6` | rodada tardia: barra diária das ações dos EUA, que o Yahoo atrasa depois das 20:00 ET |

Fechamento regular em BRT: B3 e NYSE às 17:00 com Nova York em horário de verão (mar–nov) e às 18:00 no horário padrão (B3 a partir de 03/11/2026). A rodada conta como fechamento a partir de fechamento + 30 min (EUA: nunca antes de 18:15). O GitHub pode atrasar crons em horário de pico.

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
- Durante o pregão a barra de hoje é **parcial**: a página mostra "Intradiário · parcial" com a hora da última cotação em BRT, e o `summary.json` traz `intraday: true`. As cotações do Yahoo têm atraso de ~15 min, mais até ~30 min entre rodadas.
- Liquidez = média de close × volume (aproxima o giro).
- Universo muda com o tempo (viés de sobrevivência); não é backtest.
- brapi free tier e Yahoo podem limitar/falhar: o JSON lista `failedTickers` e o cabeçalho mostra "parcial".

## Rodar localmente

```bash
pip install -r requirements.txt
python scripts/build_data.py --out web/public/data   # --limit 40 para universo reduzido
cd web && npm ci && npm run dev
```

Workflow: `.github/workflows/scan.yml` (PRs e branches só validam e guardam o build como artefato; deploy no Pages só a partir da `main`).

O `screener.py` legado (rompimento de 52s com PNGs) continua no repo para o monitor local, mas não é mais publicado no Pages.
