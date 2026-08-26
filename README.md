# Job Radar

Private single-user job radar for Richard Kuhne. Scans a media/entertainment/AI watchlist for production operations, AI workflow, and creative technology roles. Detects, normalizes, deduplicates, deterministically gates, enriches descriptions, AI-scores, generates application packets, and sends email alerts — all with human review before any application.

**Live dashboard:** https://radar.richardkuhne.com

## Architecture

- **Frontend:** React + Vite + Tailwind CSS, deployed via Cloudflare Pages from GitHub
- **Backend:** Supabase (Postgres, Auth, Edge Functions)
- **Cron:** Cloudflare Worker (every 3 minutes)
- **AI:** OpenAI API for scoring and packet generation

### ATS Adapters (6)
- Greenhouse — list endpoint, description enriched from detail endpoint
- Lever — list endpoint with full descriptions
- Ashby — list endpoint with full descriptions
- SmartRecruiters — list endpoint, description enriched from detail endpoint
- TalentBrew — public server-rendered listing pages, description enriched from detail endpoint
- SuccessFactors Recruiting Marketing — public `sitemap-job.xml` feed with canonical URLs and full descriptions

### Edge Functions (4)
- `poll-jobs` — fetches jobs from all enabled companies, normalizes, deduplicates, detects material changes, invokes downstream pipeline
- `score-jobs` — deterministic prefilter, description enrichment, AI scoring with server-calculated total/recommendation
- `generate-packets` — idempotent application packet generation for 75+ jobs with deterministic verdict
- `send-alerts` — email alerts for 82+ jobs with cutoff and version-aware dedupe

### Pipeline Flow
```
cron → poll-jobs → score-jobs → generate-packets → send-alerts
```
Every polling pass invokes the full downstream pipeline, even with zero new jobs, so pending work is always drained.

## Scoring Thresholds

| Score | Recommendation | Packet | Alert |
|-------|---------------|--------|-------|
| 90+ | EXCEPTIONAL | Yes | Yes |
| 82-89 | APPLY_NOW | Yes | Yes |
| 75-81 | STRONG_REVIEW | Yes | No |
| 65-74 | WATCH | No | No |
| <65 | IGNORE | No | No |

## Commands

```bash
npm install          # install dependencies
npm run dev          # start dev server
npm run typecheck    # type-check
npm run test         # run tests
npm run build        # production build
```

## Deployment

- **Frontend:** Pushes to `main` on GitHub trigger Cloudflare Pages builds
- **Cloudflare Worker:** `cd cloudflare-worker && npx wrangler deploy`
- **Supabase migrations:** Applied via Supabase MCP tools or `supabase/migrations/` directory
- **Edge functions:** Deployed via Supabase MCP `deploy_edge_functions` tool
- **Watchlist seed:** `supabase/seed_watchlist.sql` — idempotent upsert of all companies

## Environment Variables

See `.env.example` for the complete list. Never commit actual values.

## Important Invariants

- No auto-apply — human review is always required
- No fabricated candidate experience
- Geography gate occurs before AI spend
- Filtered jobs do not get description enrichment
- Unchanged polls never clobber workflow status
- Material changes re-enter scoring
- Final numeric score/recommendation are server-deterministic
- Downstream pipeline stages are idempotent/retryable
- Secrets never enter frontend/repo
