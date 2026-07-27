// ============================================================
// Seed for the `sleepers` table — curated analyst "sleeper/breakout" picks.
//
// This is OPINION, not fact. Player names captured 2026-07-20 from:
//   - ESPN, "2026 Fantasy Football: Sleepers, Breakouts, Busts"
// Each pick is resolved against the live Sleeper player dump to get the
// authoritative player_id, team, and position (so the board can badge them
// and link to news). Unmatched names are still stored (player_id = null).
//
// Edit the PICKS list to reflect YOUR targets, then re-run:
//   node --env-file=.env.local scripts/seed-sleepers.mjs
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const SOURCE = "ESPN";

// pos is the article's label; team + a corrected pos come from Sleeper on match.
const PICKS = [
  { name: "Tyler Shough", pos: "QB" },
  { name: "C.J. Stroud", pos: "QB" },
  { name: "Jaxson Dart", pos: "QB" },
  { name: "Justin Herbert", pos: "QB" },
  { name: "Brock Purdy", pos: "QB" },
  { name: "Travis Etienne Jr.", pos: "RB" },
  { name: "Cam Skattebo", pos: "RB" },
  { name: "Kyle Monangai", pos: "RB" },
  { name: "Jonathon Brooks", pos: "RB" },
  { name: "Kenny Gainwell", pos: "RB" },
  { name: "Keaton Mitchell", pos: "RB" },
  { name: "Jadarian Price", pos: "RB" },
  { name: "Matthew Golden", pos: "WR" },
  { name: "Wan'Dale Robinson", pos: "WR" },
  { name: "Michael Pittman Jr.", pos: "WR" },
  { name: "Adonai Mitchell", pos: "WR" },
  { name: "Jordyn Tyson", pos: "WR" },
  { name: "Carnell Tate", pos: "WR" },
  { name: "Jalen McMillan", pos: "WR" },
  { name: "Isaiah Likely", pos: "TE" },
  { name: "Terrance Ferguson", pos: "TE" },
  { name: "Kenyon Sadiq", pos: "TE" },
  { name: "Chig Okonkwo", pos: "TE" },
  { name: "Greg Dulcich", pos: "TE" },
  { name: "George Kittle", pos: "TE" },
];

// For picks whose common name differs from Sleeper's full_name.
// (Sleeper already uses "Kenny Gainwell" / "Chig Okonkwo", so no alias needed
// for those — add entries here only when a name genuinely fails to resolve.)
const ALIAS = {};

function normName(s) {
  return s
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(name) {
  return normName(name).replace(/ /g, "-");
}

async function main() {
  console.log("Fetching Sleeper players to resolve names…");
  const res = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
  const raw = await res.json();

  // Build a normalized-name -> player index (active fantasy positions only).
  const index = new Map();
  for (const p of Object.values(raw)) {
    if (!p.active || !["QB", "RB", "WR", "TE", "K"].includes(p.position)) continue;
    const full = p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
    if (full) index.set(normName(full), p);
  }

  const unmatched = [];
  const rows = PICKS.map((pick) => {
    const lookup = normName(ALIAS[pick.name] || pick.name);
    const match = index.get(lookup);
    if (!match) unmatched.push(pick.name);
    return {
      id: slug(pick.name),
      player_id: match ? match.player_id : null,
      name: pick.name,
      pos: match ? match.position : pick.pos,
      team: match ? match.team || "FA" : null,
      source: SOURCE,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from("sleepers").upsert(rows);
  if (error) throw error;

  const matched = rows.filter((r) => r.player_id).length;
  console.log(`Seeded ${rows.length} sleepers (${matched} matched to a player_id).`);
  if (unmatched.length) {
    console.log(`Unmatched (stored without player_id): ${unmatched.join(", ")}`);
  }
}

main().catch((e) => {
  console.error("Sleeper seed failed:", e);
  process.exit(1);
});
