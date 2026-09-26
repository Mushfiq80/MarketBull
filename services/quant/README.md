# BABull quant service

The **only** place a financial formula exists in BABull. TypeScript reads stored
results; it never recomputes a metric.

```bash
python -m venv .venv
. .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Docs: http://localhost:8000/docs

## Before ingesting anything

DSE adapters have never seen a live response — the machine this was built on
could not reach dse.com.bd. Validate first:

```bash
curl -X POST http://localhost:8000/ingest/dse_eod/verify \
  -H "X-BABull-Token: $QUANT_SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"from":"2026-09-01","to":"2026-09-24"}'
```

`verify` fetches, parses and reports field-by-field **without writing to the
database**. Work through `babull-docs/10-runbook.md` § First real run.

## The rules this code obeys

1. Point-in-time or nothing — every read takes an `as_of`.
2. Missing is not zero — return `FactorValue.unavailable(...)`.
3. No fabrication — a parser that cannot parse raises.
4. Everything is versioned — weights live in `app/config/models/*.yaml`.
5. Sample data never reaches research — `SampleDataGuard` raises, no override.

See `babull-docs/skills/babull-quant/SKILL.md`.
