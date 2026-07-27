// ============================================================
// One-time (re-runnable) seed for the `coaches` table.
//
// This is a CURATED SNAPSHOT, not a live pull — there's no free
// structured API for NFL coaching staffs. Data captured 2026-07-20 from:
//   - Wikipedia, "List of current National Football League head coaches"
//   - Yahoo Sports, "Full list of 10 new NFL head coach hires (2026)"
//   - Wikipedia, "List of current NFL offensive/defensive coordinators"
//   - gridironexperts.com NFL coaches list (cross-check)
// Head coaches verified across 3 sources. OCs agree across 2 independent
// sources (32/32); DCs agree 31/32. Tampa Bay's DC is left null because
// sources conflicted (Bowles / Danny Smith / George Edwards).
// `is_new: true` = hired as head coach for the 2026 season.
//
// Re-run after a coaching change:  node --env-file=.env.local scripts/seed-coaches.mjs
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Team abbreviations match Sleeper's (players.team).
// ============================================================

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const COACHES = [
  { team: "BUF", head_coach: "Joe Brady", hired: 2026, is_new: true, off_coordinator: "Pete Carmichael", def_coordinator: "Jim Leonhard" },
  { team: "MIA", head_coach: "Jeff Hafley", hired: 2026, is_new: true, off_coordinator: "Bobby Slowik", def_coordinator: "Sean Duggan" },
  { team: "NE", head_coach: "Mike Vrabel", hired: 2025, is_new: false, off_coordinator: "Josh McDaniels", def_coordinator: "Zak Kuhr" },
  { team: "NYJ", head_coach: "Aaron Glenn", hired: 2025, is_new: false, off_coordinator: "Frank Reich", def_coordinator: "Brian Duker" },
  { team: "BAL", head_coach: "Jesse Minter", hired: 2026, is_new: true, off_coordinator: "Declan Doyle", def_coordinator: "Anthony Weaver" },
  { team: "CIN", head_coach: "Zac Taylor", hired: 2019, is_new: false, off_coordinator: "Dan Pitcher", def_coordinator: "Al Golden" },
  { team: "CLE", head_coach: "Todd Monken", hired: 2026, is_new: true, off_coordinator: "Travis Switzer", def_coordinator: "Mike Rutenberg" },
  { team: "PIT", head_coach: "Mike McCarthy", hired: 2026, is_new: true, off_coordinator: "Brian Angelichio", def_coordinator: "Patrick Graham" },
  { team: "HOU", head_coach: "DeMeco Ryans", hired: 2023, is_new: false, off_coordinator: "Nick Caley", def_coordinator: "Matt Burke" },
  { team: "IND", head_coach: "Shane Steichen", hired: 2023, is_new: false, off_coordinator: "Jim Bob Cooter", def_coordinator: "Lou Anarumo" },
  { team: "JAX", head_coach: "Liam Coen", hired: 2025, is_new: false, off_coordinator: "Grant Udinski", def_coordinator: "Anthony Campanile" },
  { team: "TEN", head_coach: "Robert Saleh", hired: 2026, is_new: true, off_coordinator: "Brian Daboll", def_coordinator: "Gus Bradley" },
  { team: "DEN", head_coach: "Sean Payton", hired: 2023, is_new: false, off_coordinator: "Davis Webb", def_coordinator: "Vance Joseph" },
  { team: "KC", head_coach: "Andy Reid", hired: 2013, is_new: false, off_coordinator: "Eric Bieniemy", def_coordinator: "Steve Spagnuolo" },
  { team: "LV", head_coach: "Klint Kubiak", hired: 2026, is_new: true, off_coordinator: "Andrew Janocko", def_coordinator: "Rob Leonard" },
  { team: "LAC", head_coach: "Jim Harbaugh", hired: 2024, is_new: false, off_coordinator: "Mike McDaniel", def_coordinator: "Chris O'Leary" },
  { team: "DAL", head_coach: "Brian Schottenheimer", hired: 2025, is_new: false, off_coordinator: "Klayton Adams", def_coordinator: "Christian Parker" },
  { team: "NYG", head_coach: "John Harbaugh", hired: 2026, is_new: true, off_coordinator: "Matt Nagy", def_coordinator: "Dennard Wilson" },
  { team: "PHI", head_coach: "Nick Sirianni", hired: 2021, is_new: false, off_coordinator: "Sean Mannion", def_coordinator: "Vic Fangio" },
  { team: "WAS", head_coach: "Dan Quinn", hired: 2024, is_new: false, off_coordinator: "David Blough", def_coordinator: "Daronte Jones" },
  { team: "CHI", head_coach: "Ben Johnson", hired: 2025, is_new: false, off_coordinator: "Press Taylor", def_coordinator: "Dennis Allen" },
  { team: "DET", head_coach: "Dan Campbell", hired: 2021, is_new: false, off_coordinator: "Drew Petzing", def_coordinator: "Kelvin Sheppard" },
  { team: "GB", head_coach: "Matt LaFleur", hired: 2019, is_new: false, off_coordinator: "Adam Stenavich", def_coordinator: "Jonathan Gannon" },
  { team: "MIN", head_coach: "Kevin O'Connell", hired: 2022, is_new: false, off_coordinator: "Wes Phillips", def_coordinator: "Brian Flores" },
  { team: "ATL", head_coach: "Kevin Stefanski", hired: 2026, is_new: true, off_coordinator: "Tommy Rees", def_coordinator: "Jeff Ulbrich" },
  { team: "CAR", head_coach: "Dave Canales", hired: 2024, is_new: false, off_coordinator: "Brad Idzik", def_coordinator: "Ejiro Evero" },
  { team: "NO", head_coach: "Kellen Moore", hired: 2025, is_new: false, off_coordinator: "Doug Nussmeier", def_coordinator: "Brandon Staley" },
  { team: "TB", head_coach: "Todd Bowles", hired: 2022, is_new: false, off_coordinator: "Zac Robinson", def_coordinator: null },
  { team: "ARI", head_coach: "Mike LaFleur", hired: 2026, is_new: true, off_coordinator: "Nathaniel Hackett", def_coordinator: "Nick Rallis" },
  { team: "LAR", head_coach: "Sean McVay", hired: 2017, is_new: false, off_coordinator: "Nathan Scheelhaase", def_coordinator: "Chris Shula" },
  { team: "SF", head_coach: "Kyle Shanahan", hired: 2017, is_new: false, off_coordinator: "Klay Kubiak", def_coordinator: "Raheem Morris" },
  { team: "SEA", head_coach: "Mike Macdonald", hired: 2024, is_new: false, off_coordinator: "Brian Fleury", def_coordinator: "Aden Durde" },
];

async function main() {
  const rows = COACHES.map((c) => ({
    ...c,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("coaches").upsert(rows);
  if (error) throw error;

  const newCount = COACHES.filter((c) => c.is_new).length;
  console.log(`Seeded ${rows.length} coaches (${newCount} new for 2026).`);
}

main().catch((e) => {
  console.error("Coach seed failed:", e);
  process.exit(1);
});
