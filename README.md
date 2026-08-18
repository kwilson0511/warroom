# War Room 🏈

A personal fantasy football draft board and season tracker, built with Next.js + Supabase.

## What it does

- **Draft board** — players in tiers by ADP, with position filters and search
- **Favorites** — shared and synced across devices
- **Rookie tracker** and **curated sleeper picks**
- **Team hub** — open a team to see its coaching staff, depth chart, and news
- **Injury report** and a **league-wide news feed** that floats injury/transaction items to the top
- **Per-player news** — click a player to see (or search) the latest reporting

## How the data stays fresh

- **Daily auto-refresh:** a GitHub Action (`.github/workflows/refresh.yml`) runs `scripts/refresh.mjs` every morning, pulling players, rookies, depth charts, injuries, and news from the [Sleeper API](https://docs.sleeper.com) + RSS feeds into Supabase.
- **Curated data** (opinion snapshots — re-run manually near the draft):
  - Coaching staffs: `node --env-file=.env.local scripts/seed-coaches.mjs`
  - Sleeper picks: `node --env-file=.env.local scripts/seed-sleepers.mjs`
  - K/DEF rankings live in the `DEF_RANK` / `K_RANK` lists in `scripts/refresh.mjs`

## Run locally

1. Copy `.env.example` to `.env.local` and fill in your Supabase URL + service-role key
2. `npm install`
3. `npm run dev` → open http://localhost:3000/board

## Database

Run `sql/schema.sql` once on a fresh Supabase project to create every table.

## Deploy

Hosted on Vercel, auto-deploys on every push to `main`. The service-role key is set
in Vercel's environment variables and GitHub Actions secrets — never committed.
