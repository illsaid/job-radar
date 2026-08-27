# AGENTS.md — Job Radar Agent Guide

## PROJECT PURPOSE

Private single-user Job Radar for Richard Kuhne. Detect → normalize → dedupe → deterministic gate → description enrichment → AI score → packet/alert → HUMAN REVIEW. Never auto-apply.

## LIVE INFRA

- **Frontend:** https://radar.richardkuhne.com
- **Supabase project ref:** swjyigjjoksqnsnvqtbu
- **Edge base:** https://swjyigjjoksqnsnvqtbu.supabase.co/functions/v1/
- **Cloudflare Worker:** job-radar-cron
- **Cron schedule:** */3 * * * *
- **Worker source:** cloudflare-worker/
- **GitHub:** illsaid/job-radar

## ARCHITECTURE

### Frontend
- React + Vite + Tailwind CSS + Lucide icons
- Deployed via Cloudflare Pages from GitHub main branch
- Supabase anon-key client for data access

### Backend
- Supabase Postgres database
- Supabase Auth (email/password, single user)
- 4 Supabase Edge Functions (Deno runtime)

### ATS Adapters (4)
1. **Greenhouse** — `src/lib/adapters/greenhouse.ts` — list endpoint, description enriched from detail endpoint
2. **Lever** — `src/lib/adapters/lever.ts` — list endpoint with full descriptions
3. **Ashby** — `src/lib/adapters/ashby.ts` — list endpoint with full descriptions
4. **SmartRecruiters** — `src/lib/adapters/smartrecruiters.ts` — list endpoint, description enriched from detail endpoint

### Edge Functions (4)
1. **poll-jobs** — Cron-triggered. Fetches jobs from all enabled companies, normalizes, deduplicates, detects material changes via source_fingerprint, invokes downstream pipeline. Always runs downstream even with 0 new jobs.
2. **score-jobs** — Deterministic prefilter, description enrichment for Greenhouse/SmartRecruiters, AI scoring. Model returns components + penalties only; server calculates total_score and recommendation deterministically.
3. **generate-packets** — Idempotent packet generation for 75+ jobs. Verdict is deterministic from stored score. One current packet per job (unique index on job_id WHERE is_current). Updates when score or job materially changes.
4. **send-alerts** — Email alerts for 82+ jobs. Fails CLOSED if ALERTS_ENABLED not set. Version-aware dedupe via (job_id, source_content_hash, alert_type). Cutoff via ALERTS_ACTIVE_AFTER.

### Pipeline Flow
```
cron → poll-jobs → score-jobs → generate-packets → send-alerts
```

### Database Tables
- `companies` — watchlist (15 enabled, 4 disabled test fixtures)
- `jobs` — normalized job postings
- `job_scores` — AI scores with component breakdown
- `job_snapshots` — historical snapshots for change tracking
- `application_packets` — application packets (one current per job)
- `alerts` — email alert log with version-aware dedupe
- `applications` — manual application tracking
- `system_runs` — cron run logs with pipeline stage failures

## SCORING THRESHOLDS

| Score | Recommendation |
|-------|---------------|
| 90+ | EXCEPTIONAL |
| 82-89 | APPLY_NOW |
| 75-81 | STRONG_REVIEW |
| 65-74 | WATCH |
| <65 | IGNORE |

## PACKET THRESHOLD
75+

## ALERT THRESHOLD
82+ (with 90+ as EXCEPTIONAL)

## IMPORTANT INVARIANTS

- No auto-apply — human review is always required
- No fabricated candidate experience
- Geography gate occurs before AI spend
- Filtered jobs do not get description enrichment
- Unchanged polls never clobber workflow status (only update last_seen_at)
- Material changes (source_fingerprint mismatch) set status='new' and last_material_change_at
- Descriptions must be enriched before scoring when obtainable
- Final numeric score/recommendation are server-deterministic (model returns components only)
- Downstream pipeline stages are idempotent/retryable
- Pipeline stage failures recorded in system_runs.failures_json with stage name
- Secrets never enter frontend/repo

## ENVIRONMENT VARIABLE NAMES

### Frontend
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Supabase / Backend
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_REVIEWER_MODEL`
- `JOB_RADAR_CRON_SECRET`
- `RESEND_API_KEY`
- `ALERT_RECIPIENT`
- `ALERT_FROM`
- `ALERTS_ENABLED`
- `ALERTS_ACTIVE_AFTER`

### Cloudflare Worker
- `JOB_RADAR_CRON_SECRET`

## COMMANDS

```bash
npm install          # install dependencies
npm run dev          # start dev server
npm run typecheck    # type-check (tsc --noEmit)
npm run test         # run tests (vitest)
npm run build        # production build (vite build)
npm run lint         # eslint
```

### Supabase Migration / Deploy Workflow
- Apply schema changes via `mcp__supabase__apply_migration` MCP tool
- Deploy edge functions via `mcp__supabase__deploy_edge_functions` MCP tool
- Never use `npx supabase` CLI — not supported in this environment
- Seed watchlist: run `supabase/seed_watchlist.sql` via `mcp__supabase__execute_sql`

### Cloudflare Worker Deploy
```bash
cd cloudflare-worker && npx wrangler deploy
```

## DEPLOYMENT OWNERSHIP

- Frontend deploys from GitHub through Cloudflare Pages
- Worker deploys from `cloudflare-worker/` via Wrangler
- Supabase functions/migrations must be explicitly deployed/pushed via MCP tools

## KNOWN CURRENT STATE

- 15 enabled companies (Tubi, Wrapbook, NBCUniversal, Skydance, Whalar Group, A24, ATTN, Spotter, NFL, HeyGen, Runway, ElevenLabs, BuzzFeed, Forbes, Select Management Group)
- 4 disabled test fixtures (Stripe, AngelList/Wellfound, Ashby, SmartRecruiters)
- 448 jobs in calibration corpus
- Alerts are DISABLED (RESEND_API_KEY, ALERT_RECIPIENT, ALERT_FROM, ALERTS_ENABLED, ALERTS_ACTIVE_AFTER not yet configured)
- The watchlist is reproducible from `supabase/seed_watchlist.sql`
