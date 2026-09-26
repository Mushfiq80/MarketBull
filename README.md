# BABull

AI-assisted investment intelligence for equities listed on the
**Dhaka Stock Exchange (DSE)**.

Dashboard-first research: real market and company data, transparent quantitative
scoring, evidence you can inspect, and uncertainty that stays visible.

> Private R&D. Not investment advice. Not a signal service.

---

## What it does

| Surface | Purpose |
|---|---|
| **Market Home** | What is happening: indices, regime, breadth, turnover, sector pulse, movers |
| **Rankings** | Separate short- / medium- / long-term rankings with score, conviction, risk gates, liquidity |
| **FOX Research** | Per-company report: Fundamentals / Opportunity / eXposure, thesis and counter-thesis, scenarios, evidence |
| **Company Intelligence** | Business, financial history, ownership, people, events, governance, peers |
| **Why Moving?** | Market/sector-adjusted move decomposition with ranked candidate explanations |
| **Bull Market Watch** | Regime state, factor contributions, transition-watch checklist |
| **Watchlist & Portfolio** | Holdings, exposure, concentration, stress, thesis-change alerts |
| **Research Chat** | Follow-up questions answered from the same stored evidence, with citations |
| **Data Quality** | Source freshness, ingestion runs, open data-quality issues, model registry |

## The FOX framework

- **F** — Fundamentals: what the business is worth and how healthy it is
- **O** — Opportunity: what could drive revaluation
- **X** — eXposure & Risk: what can go wrong

Each horizon has its own ranking model and target outcome. A separate **Market
Regime Engine** estimates the current market state, kept distinct from any
forecast of future transitions.

---

## Non-negotiable principles

1. **Real data or no data.** No fabricated value ever reaches the research or
   backtest pipeline. Sample data is tagged, banner-marked, and hard-rejected by
   the backtest engine.
2. **Deterministic core, AI at the edges.** All arithmetic, scoring and
   backtesting is deterministic Python. The LLM retrieves, summarises, classifies
   and cites — it never produces a number.
3. **Everything is point-in-time.** Backtests may only see what was knowable at
   the simulated decision time.
4. **No score without its evidence.** Every score opens into its components and
   source documents.
5. **Missing is not zero.**
6. **Observation, not accusation.** Unusual activity is reported statistically;
   wrongdoing only where an authoritative finding exists.
7. **Association is not causation.**

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind v4, shadcn/ui |
| Tables / data | TanStack Table, TanStack Query |
| Charts | `lightweight-charts` (OHLCV) · Recharts (analytics) |
| API | Next.js Route Handlers + Zod |
| Quant & ingestion | Python 3.11, FastAPI, pandas, NumPy, statsmodels, scikit-learn |
| Database | PostgreSQL 16 + pgvector, Drizzle ORM |
| Storage | Local filesystem (dev) → S3-compatible (later) |

Architecture decisions and their reasoning are recorded as ADRs.

---

## Quick start

```bash
cp .env.example .env          # then edit POSTGRES_PASSWORD + QUANT_SERVICE_TOKEN
docker compose up -d postgres

npm install
npm run db:push
npm run db:seed:reference

# terminal 2
cd services/quant && python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# terminal 3
npm run dev
```

- Dashboard → http://localhost:3000
- Quant API docs → http://localhost:8000/docs

### First real data

DSE adapters have **not** been validated against a live response yet. Run the
dry verifier from a machine with internet access before ingesting:

```bash
curl -X POST http://localhost:8000/ingest/dse_eod/verify \
  -H "X-BABull-Token: $QUANT_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-09-01","to":"2026-09-24"}'
```

It fetches, parses and reports field-by-field **without writing to the database**.
Fix the adapter until the report is clean, then freeze a fixture and ingest.

For UI work before real data exists: `npm run db:seed:sample` (everything is then
banner-marked as sample, and backtests refuse to run).

---

## Repository layout

```
apps/web              Next.js app — UI, API routes, domain logic, Drizzle schema
services/quant        Python service — adapters, factors, FOX, regime, backtest
docker/               Postgres init scripts
scripts/              Repo-level tooling
babull-docs/          Internal documentation + design skills  (git-ignored)
```

Internal documentation is intentionally **not** committed. It lives in
`babull-docs/` on the working machine.
