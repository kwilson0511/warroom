-- ============================================================
-- Fantasy Football War Room — Supabase schema
-- Run this in Supabase → SQL Editor → New query → Run.
-- Safe to re-run; uses "if not exists".
-- ============================================================

-- ---- Players (refreshed daily from Sleeper) ----------------
create table if not exists players (
  id          text primary key,          -- Sleeper player_id
  name        text not null,
  pos         text not null,             -- QB / RB / WR / TE / K / DEF
  team        text,
  adp         numeric,                   -- proxy from Sleeper search_rank
  bye         int,
  injury      text,                      -- Sleeper injury_status, if any
  rookie      boolean not null default false,  -- Sleeper years_exp === 0
  college     text,
  updated_at  timestamptz default now()
);

create index if not exists players_adp_idx on players (adp);
create index if not exists players_pos_idx on players (pos);

-- ---- Draft state (shared between you and your husband) -----
-- status: 'available' | 'mine' | 'taken'
create table if not exists draft_state (
  player_id   text primary key references players (id) on delete cascade,
  status      text not null default 'available',
  favorite    boolean not null default false,  -- shared "follow" flag
  updated_at  timestamptz default now()
);

-- ---- News items (refreshed daily from RSS) -----------------
create table if not exists news (
  id          text primary key,          -- hash of the article URL
  title       text not null,
  link        text not null,
  source      text,                      -- which feed it came from
  team        text,                      -- best-guess team tag, may be null
  player_ids  text[] default '{}',       -- player IDs whose names appear in the article
  summary     text,                      -- Claude-generated, filled in later
  published   timestamptz,
  created_at  timestamptz default now()
);

create index if not exists news_team_idx on news (team);
create index if not exists news_published_idx on news (published desc);
-- GIN index supports fast array-containment lookups (player_ids @> '{id}').
create index if not exists news_player_ids_idx on news using gin (player_ids);

-- ---- Rookies (full 2026 class; refreshed daily from Sleeper) ----------
-- Separate from `players` so the top-300 draft board stays clean. Holds
-- every rookie (years_exp === 0) at a fantasy position, relevant or not.
create table if not exists rookies (
  id          text primary key,          -- Sleeper player_id
  name        text not null,
  pos         text,
  team        text,
  college     text,
  adp         numeric,                   -- proxy from Sleeper search_rank
  updated_at  timestamptz default now()
);

create index if not exists rookies_pos_idx on rookies (pos);
create index if not exists rookies_adp_idx on rookies (adp);

-- ---- Sleepers (curated expert picks; seeded by scripts/seed-sleepers.mjs) --
-- Analyst "sleeper/breakout" targets. OPINION, not fact. `player_id` links
-- to a Sleeper id when the name resolves (for board badge + news); it's null
-- for picks that didn't match. `id` is a stable name slug.
create table if not exists sleepers (
  id          text primary key,          -- name slug, e.g. "tyler-shough"
  player_id   text,                      -- Sleeper player_id when matched
  name        text not null,
  pos         text,
  team        text,
  source      text,                      -- where the pick came from
  updated_at  timestamptz default now()
);

create index if not exists sleepers_player_id_idx on sleepers (player_id);

-- ---- Depth charts (full rosters; refreshed daily from Sleeper) ---------
-- One row per rostered player that appears on their team's depth chart.
-- depth_order 1 = starter. Grouped by team + position in the Teams view.
create table if not exists depth_chart (
  id             text primary key,        -- Sleeper player_id
  name           text not null,
  pos            text,                    -- QB / RB / WR / TE / K
  team           text,
  depth_position text,                    -- Sleeper's slot (e.g. RB, LWR, SWR)
  depth_order    int,                     -- 1 = starter, 2 = backup, ...
  updated_at     timestamptz default now()
);

create index if not exists depth_chart_team_idx on depth_chart (team);

-- ---- Coaches (curated snapshot; seeded by scripts/seed-coaches.mjs) ----
-- One row per team. `is_new` marks head coaches hired for the current
-- offseason so the Teams view can badge them.
create table if not exists coaches (
  team            text primary key,      -- team abbreviation, matches players.team
  head_coach      text not null,
  hired           int,                   -- year they became this team's HC
  is_new          boolean not null default false,
  off_coordinator text,                  -- may be null if unresolved
  def_coordinator text,                  -- may be null if unresolved
  updated_at      timestamptz default now()
);

-- ============================================================
-- Row Level Security
-- For a private 2-person tool the simplest safe setup is:
-- keep RLS ON, and let ONLY the service_role key (used by your
-- server-side jobs and API routes) read/write. The service_role
-- key bypasses RLS automatically, so we add no public policies.
-- Never expose the service_role key in client-side code.
-- ============================================================
alter table players     enable row level security;
alter table draft_state enable row level security;
alter table news        enable row level security;
alter table coaches     enable row level security;
alter table rookies     enable row level security;
alter table sleepers    enable row level security;
alter table depth_chart enable row level security;
