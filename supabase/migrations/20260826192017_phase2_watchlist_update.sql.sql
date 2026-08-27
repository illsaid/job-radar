/*
# Phase 2: Replace test watchlist with real candidate search universe

1. Disable (do NOT delete) existing adapter-test companies:
   - Stripe, AngelList (Wellfound), Ashby, SmartRecruiters
   These are set enabled=false so they remain in the database for reference
   but are no longer polled.

2. Add P1 priority companies (entertainment / media / creative-AI focus):
   - Tubi (Greenhouse)
   - Wrapbook (Ashby)
   - NBCUniversal (SmartRecruiters)
   - Skydance (Lever)
   - Whalar Group (Greenhouse)
   - A24 (Greenhouse)
   - ATTN (Greenhouse)
   - Spotter (Greenhouse)
   - NFL (Greenhouse)
   - HeyGen (Greenhouse)
   - Runway (Ashby)
   - ElevenLabs (Ashby)

3. Add P2 priority companies:
   - BuzzFeed (Greenhouse)
   - Forbes (Greenhouse)
   - Select Management Group (Greenhouse)

4. All new companies are inserted with enabled=true and will be polled.
   Idempotent: uses ON CONFLICT DO NOTHING on the (name) column to avoid
   duplicates on re-runs.

5. No schema changes — uses existing companies table structure.
*/

-- Disable test companies (do not delete)
UPDATE companies SET enabled = false WHERE name IN ('Stripe', 'AngelList (Wellfound)', 'Ashby', 'SmartRecruiters');

-- P1 companies
INSERT INTO companies (name, careers_url, ats_type, ats_identifier, priority, enabled, tags, notes)
VALUES
  ('Tubi', 'https://job-boards.greenhouse.io/tubitv', 'greenhouse', 'tubitv', 1, true,
   ARRAY['entertainment','streaming','production','los-angeles'],
   'P1 — Greenhouse board tubitv'),
  ('Wrapbook', 'https://jobs.ashbyhq.com/wrapbook', 'ashby', 'wrapbook', 1, true,
   ARRAY['production-tech','ai','operations','remote'],
   'P1 — Ashby board wrapbook'),
  ('NBCUniversal', 'https://jobs.smartrecruiters.com/NBCUniversal3', 'smartrecruiters', 'NBCUniversal3', 1, true,
   ARRAY['entertainment','studio','production','los-angeles'],
   'P1 — SmartRecruiters board NBCUniversal3'),
  ('Skydance', 'https://jobs.lever.co/skydance', 'lever', 'skydance', 1, true,
   ARRAY['entertainment','studio','production','los-angeles'],
   'P1 — Lever board skydance'),
  ('Whalar Group', 'https://job-boards.greenhouse.io/whalarinc', 'greenhouse', 'whalarinc', 1, true,
   ARRAY['creator-economy','agency','production','operations','los-angeles'],
   'P1 — Greenhouse board whalarinc'),
  ('A24', 'https://job-boards.greenhouse.io/a24', 'greenhouse', 'a24', 1, true,
   ARRAY['entertainment','studio','production','los-angeles'],
   'P1 — Greenhouse board a24'),
  ('ATTN', 'https://job-boards.greenhouse.io/attn', 'greenhouse', 'attn', 1, true,
   ARRAY['digital-media','production','agency','los-angeles'],
   'P1 — Greenhouse board attn'),
  ('Spotter', 'https://job-boards.greenhouse.io/spotter', 'greenhouse', 'spotter', 1, true,
   ARRAY['creator-economy','digital-media','operations','los-angeles'],
   'P1 — Greenhouse board spotter'),
  ('NFL', 'https://job-boards.greenhouse.io/nflcareers', 'greenhouse', 'nflcareers', 1, true,
   ARRAY['sports-media','production','digital-media','los-angeles'],
   'P1 — Greenhouse board nflcareers'),
  ('HeyGen', 'https://job-boards.greenhouse.io/heygen', 'greenhouse', 'heygen', 1, true,
   ARRAY['creative-ai','video','workflow','los-angeles'],
   'P1 — Greenhouse board heygen'),
  ('Runway', 'https://jobs.ashbyhq.com/runway-ml', 'ashby', 'runway-ml', 1, true,
   ARRAY['creative-ai','video','media-technology'],
   'P1 — Ashby board runway-ml'),
  ('ElevenLabs', 'https://jobs.ashbyhq.com/elevenlabs', 'ashby', 'elevenlabs', 1, true,
   ARRAY['creative-ai','audio','media-technology'],
   'P1 — Ashby board elevenlabs')
ON CONFLICT DO NOTHING;

-- P2 companies
INSERT INTO companies (name, careers_url, ats_type, ats_identifier, priority, enabled, tags, notes)
VALUES
  ('BuzzFeed', 'https://job-boards.greenhouse.io/buzzfeed', 'greenhouse', 'buzzfeed', 2, true,
   ARRAY['digital-media','studio','production','los-angeles'],
   'P2 — Greenhouse board buzzfeed'),
  ('Forbes', 'https://job-boards.greenhouse.io/forbes', 'greenhouse', 'forbes', 2, true,
   ARRAY['media','creator-economy','ai-operations'],
   'P2 — Greenhouse board forbes'),
  ('Select Management Group', 'https://job-boards.greenhouse.io/selectmanagementgroup', 'greenhouse', 'selectmanagementgroup', 2, true,
   ARRAY['creator-economy','talent','production','los-angeles'],
   'P2 — Greenhouse board selectmanagementgroup')
ON CONFLICT DO NOTHING;
