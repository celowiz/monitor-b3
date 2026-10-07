# Monitor B3

Ferramenta educacional que lista ações (e BDRs da allowlist) da B3 com liquidez de 21 pregões acima de R$ 5 milhões **e** preço acima da máxima dos 252 pregões anteriores (excluindo o candle atual).

**Site:** https://celowiz.github.io/monitor-b3/

**Isto não é recomendação de investimento, oferta ou solicitação de compra ou venda de valores mobiliários.** Use só para estudo.

## Como funciona

1. Universo: catálogo público [brapi.dev](https://brapi.dev/api/v2/tickers?type=stock) (`assetType=stock`, papéis `XXXX` + final `3|4|5|6|11`). ETFs, FIIs e BDRs em massa ficam de fora. BDRs entram **somente** pela `bdr_allowlist` em `config.json`.
2. Preços e histórico: [yfinance](https://github.com/ranaroussi/yfinance) (`TICKER.SA`, `auto_adjust`).
3. Filtros (iguais ao scanner local):
   - `liq21 > R$ 5.000.000` (média Close × Volume em 21 sessões)
   - `preço > máxima de 252 sessões`, **sem** o candle que está sendo avaliado
4. GitHub Actions gera o site estático e publica no GitHub Pages (custo zero). Não há Vercel, Railway, APIs pagas nem worker de refresh.

Artefatos estáveis na raiz do site:

| Arquivo | Conteúdo |
| --- | --- |
| `index.html` | Gráfico interativo da última rodada |
| `last_run.json` | Resultado estruturado da última rodada |
| `last_message.md` | Tabela em Markdown |
| `last_previews.json` | Caminhos relativos dos PNGs |
| `previews/YYYY-MM-DD/HH-MM/NN_TICKER.png` | Capturas por ticker (horário `America/Sao_Paulo`) |

Pastas de preview com mais de **7 dias** são apagadas para o artefato do Pages ficar pequeno. Só o `index.html` mais recente é publicado (sem histórico de HTML carimbado).

## Agenda

Workflow [`.github/workflows/scan.yml`](.github/workflows/scan.yml):

- Cron a cada 30 minutos, **segunda a sexta**, cobrindo ~**10:30–17:00** em `America/Sao_Paulo` (BRT = UTC−3; o Brasil não usa horário de verão).
- Também dispara em **Actions → Scan and deploy Pages → Run workflow**.
- Pula fins de semana, feriados B3 de 2026 e a manhã da Quarta-feira de Cinzas (pregão só às 13h). Lista em `b3_calendar.py` (fonte: [calendário B3 2026](https://www.b3.com.br/pt_br/noticias/calendario-de-negociacao-da-b3-confira-o-funcionamento-da-bolsa-em-2026.htm)). **TODO:** incluir 2027 quando a B3 publicar o ofício.

Se o scanner falhar (por exemplo yfinance vazio), o job **não** envia artefato novo: o site anterior permanece no ar.

## Ligar o GitHub Pages (depois do merge)

O repositório precisa publicar **a partir de Actions**, não da pasta `/docs` de um branch.

1. **Settings → Pages → Build and deployment → Source:** `GitHub Actions`.
2. Faça o merge deste PR em `main` (ou já esteja em `main`).
3. **Actions → Scan and deploy Pages → Run workflow** (marque *force* se estiver fora do pregão/feriado e quiser um smoke test).
4. Se o ambiente `github-pages` pedir aprovação (**Settings → Environments**), aprove o primeiro deploy.
5. Abra https://celowiz.github.io/monitor-b3/ (pode levar um ou dois minutos).

Sem o passo 1 o workflow sobe o artefato mas o Pages não serve o site.

## yfinance em runners da nuvem

Yahoo Finance **pode bloquear** IPs de GitHub-hosted runners (HTTP 403/429 / respostas vazias). O workflow:

- registra o erro com clareza e **falha o job**;
- **não** publica um site vazio por cima de uma rodada boa.

Mitigação sem custo: **Run workflow** de novo mais tarde, ou rode localmente (`python screener.py`) para validar dados. `curl_cffi` já está no `requirements.txt` (yfinance 1.7).

Cache do Actions guarda `.cache/` (`state.json`, `daily_cache.json`, `ticker_meta.json`) e `site/previews/`. Se o cache expirar, o scanner tenta reaproveitar `last_run.json` do site publicado para a coluna “desde última rodada”.

## Rodar localmente

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
python screener.py --site-dir site --cache-dir .cache
```

`--skip-png` gera o HTML/JSON sem Chromium. Saída em `site/` (gitignorada).

Testes sem rede:

```bash
python3 -m unittest discover -s tests -v
```

## Aviso

Projeto pessoal / educacional. Dados podem estar atrasados, incompletos ou errados. Não use isto como sinal de compra ou venda.
