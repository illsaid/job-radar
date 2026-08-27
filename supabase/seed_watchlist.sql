/*
# Job Radar — Watchlist Seed (Idempotent)

Run this to establish or restore the production watchlist.
Uses ON CONFLICT to upsert — safe to run multiple times.
Disabled test fixtures are included but disabled.

ENABLED (15):
  Tubi, Wrapbook, NBCUniversal, Skydance, Whalar Group, A24, ATTN,
  Spotter, NFL, HeyGen, Runway, ElevenLabs, BuzzFeed, Forbes,
  Select Management Group

DISABLED TEST FIXTURES (4):
  Stripe, AngelList (Wellfound), Ashby, SmartRecruiters
*/

INSERT INTO companies (name, ats_type, ats_identifier, priority, enabled, careers_url, tags)
VALUES
  -- ENABLED
  ('Tubi',                       'greenhouse',      'tubitv',                 1, true, 'https://job-boards.greenhouse.io/tubitv',                  ARRAY['media','streaming']),
  ('Wrapbook',                   'ashby',           'wrapbook',               1, true, 'https://jobs.ashbyhq.com/wrapbook',                        ARRAY['production','entertainment']),
  ('NBCUniversal',               'smartrecruiters', 'NBCUniversal3',          1, true, 'https://jobs.smartrecruiters.com/NBCUniversal3',           ARRAY['media','entertainment']),
  ('Skydance',                   'lever',           'skydance',               1, true, 'https://jobs.lever.co/skydance',                           ARRAY['animation','media']),
  ('Whalar Group',               'greenhouse',      'whalarinc',              1, true, 'https://job-boards.greenhouse.io/whalarinc',               ARRAY['creator','media']),
  ('A24',                        'greenhouse',      'a24',                    1, true, 'https://job-boards.greenhouse.io/a24',                      ARRAY['film','media']),
  ('ATTN',                       'greenhouse',      'attn',                   1, true, 'https://job-boards.greenhouse.io/attn',                     ARRAY['media','content']),
  ('Spotter',                    'greenhouse',      'spotter',                1, true, 'https://job-boards.greenhouse.io/spotter',                  ARRAY['creator','media']),
  ('NFL',                        'greenhouse',      'nflcareers',             1, true, 'https://job-boards.greenhouse.io/nflcareers',               ARRAY['sports','media']),
  ('HeyGen',                     'greenhouse',      'heygen',                 1, true, 'https://job-boards.greenhouse.io/heygen',                   ARRAY['ai','video']),
  ('Runway',                     'ashby',           'runway-ml',              1, true, 'https://jobs.ashbyhq.com/runway-ml',                        ARRAY['ai','video']),
  ('ElevenLabs',                 'ashby',           'elevenlabs',             1, true, 'https://jobs.ashbyhq.com/elevenlabs',                       ARRAY['ai','audio']),
  ('BuzzFeed',                   'greenhouse',      'buzzfeed',               2, true, 'https://job-boards.greenhouse.io/buzzfeed',                 ARRAY['media','content']),
  ('Forbes',                     'greenhouse',      'forbes',                 2, true, 'https://job-boards.greenhouse.io/forbes',                   ARRAY['media','publishing']),
  ('Select Management Group',    'greenhouse',      'selectmanagementgroup',  2, true, 'https://job-boards.greenhouse.io/selectmanagementgroup',   ARRAY['talent','media']),

  -- DISABLED TEST FIXTURES
  ('Stripe',                     'greenhouse',      'stripe',                 1, false, 'https://stripe.com/jobs',                                  ARRAY['fintech','test']),
  ('AngelList (Wellfound)',      'lever',           'angellist',              2, false, 'https://jobs.lever.co/angellist',                           ARRAY['test']),
  ('Ashby',                      'ashby',           'Ashby',                  2, false, 'https://jobs.ashbyhq.com/Ashby',                            ARRAY['test']),
  ('SmartRecruiters',            'smartrecruiters', 'smartrecruiters',        2, false, 'https://careers.smartrecruiters.com/smartrecruiters',       ARRAY['test'])
ON CONFLICT (name) DO UPDATE SET
  ats_type = EXCLUDED.ats_type,
  ats_identifier = EXCLUDED.ats_identifier,
  priority = EXCLUDED.priority,
  enabled = EXCLUDED.enabled,
  careers_url = EXCLUDED.careers_url,
  tags = EXCLUDED.tags,
  updated_at = now();
