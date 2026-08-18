// ============================================================
// Daily refresh job.
// Pulls (1) player/ADP data from Sleeper and (2) news from free
// RSS feeds, and upserts both into Supabase.
//
// Run locally:   node scripts/refresh.mjs
// Run scheduled: see the guide — Netlify scheduled function or
//                a Supabase cron. Both just call this logic once/day.
//
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Requires deps:     @supabase/supabase-js, rss-parser
// ============================================================

import { createClient } from "@supabase/supabase-js";
import Parser from "rss-parser";
import crypto from "node:crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ---- FREE RSS FEEDS ----------------------------------------
// Start with these general fantasy/NFL feeds. They cost nothing.
// To get per-team beat coverage later, add team beat-writer feeds
// or team-specific news feeds here — the pipeline handles the rest.
const FEEDS = [
  { url: "https://www.rotowire.com/rss/news.php?sport=NFL", source: "Rotowire" },
  { url: "https://www.espn.com/espn/rss/nfl/news", source: "ESPN NFL" },
  { url: "https://sports.yahoo.com/nfl/rss.xml", source: "Yahoo NFL" },
  // Higher-volume feeds — more player/injury notes to match against.
  { url: "https://profootballtalk.nbcsports.com/feed/", source: "ProFootballTalk" },
  { url: "https://www.cbssports.com/rss/headlines/nfl/", source: "CBS Sports" },
];

// NFL team abbreviations we try to tag articles with.
const TEAMS = ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN",
  "DET","GB","HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO",
  "NYG","NYJ","PHI","PIT","SF","SEA","TB","TEN","WAS"];

// Rough city/name → abbreviation map for tagging articles by team.
const TEAM_NAMES = {
  Cardinals:"ARI", Falcons:"ATL", Ravens:"BAL", Bills:"BUF", Panthers:"CAR",
  Bears:"CHI", Bengals:"CIN", Browns:"CLE", Cowboys:"DAL", Broncos:"DEN",
  Lions:"DET", Packers:"GB", Texans:"HOU", Colts:"IND", Jaguars:"JAX",
  Chiefs:"KC", Raiders:"LV", Chargers:"LAC", Rams:"LAR", Dolphins:"MIA",
  Vikings:"MIN", Patriots:"NE", Saints:"NO", Giants:"NYG", Jets:"NYJ",
  Eagles:"PHI", Steelers:"PIT", "49ers":"SF", Seahawks:"SEA",
  Buccaneers:"TB", Titans:"TEN", Commanders:"WAS",
};

function tagTeam(text) {
  if (!text) return null;
  for (const [name, abbr] of Object.entries(TEAM_NAMES)) {
    if (text.includes(name)) return abbr;
  }
  for (const abbr of TEAMS) {
    if (new RegExp(`\\b${abbr}\\b`).test(text)) return abbr;
  }
  return null;
}

function hashUrl(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
}

// ---- Player name matching ----------------------------------
// Build one case-insensitive regex per player, matching their FULL name
// as whole words (\b...\b) so "Josh Allen" won't match inside a longer
// word. We precompile once, then test each article's text against all of
// them. Names shorter than 4 chars are skipped to avoid noisy matches.
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPlayerMatchers(players) {
  return players
    .filter((p) => p.name && p.name.length >= 4)
    .map((p) => ({
      id: p.id,
      re: new RegExp(`\\b${escapeRegExp(p.name)}\\b`, "i"),
    }));
}

function tagPlayers(text, matchers) {
  if (!text) return [];
  const ids = [];
  for (const m of matchers) {
    if (m.re.test(text)) ids.push(m.id);
  }
  return ids;
}

function playerName(p) {
  return p.full_name || `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
}

// Decode HTML entities so titles from different feeds match and display
// cleanly (e.g. Yahoo sends "L&#39;Jarius", ProFootballTalk sends "L'Jarius").
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // ampersand last, so it can't re-form an entity
}

// Build a human-readable injury string from Sleeper's separate fields, e.g.
// "Questionable – Knee - ACL (Surgery)". Returns null when there's no status.
function formatInjury(p) {
  if (!p.injury_status) return null;
  let s = p.injury_status;
  if (p.injury_body_part && p.injury_body_part !== "Undisclosed") {
    s += ` – ${p.injury_body_part}`;
  }
  if (p.injury_notes) s += ` (${p.injury_notes})`;
  return s;
}

// Batched upsert — Supabase caps payload sizes.
async function upsertBatched(table, rows) {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 100));
    if (error) throw error;
  }
}

// ---- Sleeper player dump (fetched once, reused for players + rookies) ----
async function fetchSleeperPlayers() {
  console.log("Fetching Sleeper players…");
  const res = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
  return res.json();
}

// ---- Curated K/DEF rankings --------------------------------
// Sleeper doesn't rank kickers or defenses, so we order them from a curated
// consensus. Source: FantasyPros 2026 D/ST & Kicker tiers, captured 2026-07-20.
// Opinion, not fact — re-order these lists to update. DEF is by team abbr;
// K is by player name (matched to Sleeper via normName). Rank drives ADP so
// they sort best-to-worst within position.
const DEF_RANK = [
  "HOU", "DEN", "SEA", "LAR", "PHI", "NE", "MIN", "PIT", "JAX", "LAC",
  "BAL", "GB", "DET", "CLE", "KC", "BUF", "ATL", "SF", "NO", "CHI",
  "IND", "CAR", "NYG", "DAL", "TB", "TEN", "MIA", "WAS", "CIN", "LV",
  "NYJ", "ARI",
];

const K_RANK = [
  "Brandon Aubrey", "Ka'imi Fairbairn", "Cameron Dicker", "Cam Little",
  "Jason Myers", "Eddy Pineiro", "Tyler Loop", "Evan McPherson",
  "Cairo Santos", "Andy Borregales", "Chase McLaughlin", "Jake Bates",
  "Harrison Mevis", "Chris Boswell", "Harrison Butker", "Will Reichard",
  "Wil Lutz", "Charlie Smyth", "Jake Elliott", "Blake Grupe", "Chad Ryland",
  "Ryan Fitzgerald", "Zane Gonzalez", "Joey Slye", "Tyler Bass", "Nick Folk",
  "Daniel Carlson", "Ben Sauls", "Trey Smack", "Jake Moody", "Brandon McManus",
  "Jason Sanders",
];

function normName(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // strip accents (e.g. Piñeiro -> Pineiro)
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const K_RANK_MAP = new Map(K_RANK.map((n, i) => [normName(n), i]));

// ---- 1. Draft board ----------------------------------------
// Skill positions (QB/RB/WR/TE) are ranked by Sleeper search_rank, so we take
// the top ~300. Sleeper does NOT meaningfully rank K or DEF (defenses have no
// rank at all; nearly all kickers default to 999), so a rank cutoff would drop
// them. Instead we pull those by roster presence: every team's defense, and
// starting kickers. They get a nominal ADP so they sort to the late rounds.
async function refreshPlayers(raw) {
  const all = Object.values(raw);
  const now = new Date().toISOString();

  const base = (p) => ({
    id: p.player_id,
    name: playerName(p),
    pos: p.position,
    team: p.team,
    adp: p.search_rank ?? 999,
    bye: p.bye_week ?? null,
    injury: formatInjury(p),
    rookie: p.years_exp === 0,
    college: p.college || null,
    updated_at: now,
  });

  const skill = all
    .filter(
      (p) =>
        p.active &&
        p.team &&
        ["QB", "RB", "WR", "TE"].includes(p.position) &&
        (p.search_rank ?? 9999) < 400
    )
    .map(base)
    .sort((a, b) => a.adp - b.adp)
    .slice(0, 300);

  // Starting kickers (depth_chart_order 1, or unknown). Sleeper leaves most
  // kickers at its 999 default, so treat anything unranked as a nominal 260.
  const kickers = all
    .filter(
      (p) =>
        p.active &&
        p.team &&
        p.position === "K" &&
        (p.depth_chart_order == null || p.depth_chart_order === 1)
    )
    .map((p) => {
      // Rank-based ADP from the curated K list; unranked kickers sort last.
      const rank = K_RANK_MAP.get(normName(playerName(p)));
      return { ...base(p), adp: rank != null ? 275 + rank : 320 };
    });

  // Every team's defense. Sleeper has no full_name for DEF, so build one.
  // ADP comes from the curated DEF_RANK order.
  const defenses = all
    .filter((p) => p.active && p.team && p.position === "DEF")
    .map((p) => {
      const rank = DEF_RANK.indexOf(p.team);
      return {
        ...base(p),
        name: `${p.team} D/ST`,
        adp: 240 + (rank >= 0 ? rank : DEF_RANK.length),
        rookie: false,
        college: null,
      };
    });

  const rows = [...skill, ...kickers, ...defenses];
  await upsertBatched("players", rows);
  console.log(
    `  upserted ${rows.length} players (${skill.length} skill, ${kickers.length} K, ${defenses.length} DEF)`
  );
  return rows;
}

// ---- 1b. Full rookie class (all rookies, not just top-300) --------------
async function refreshRookies(raw) {
  const rows = Object.values(raw)
    .filter(
      (p) =>
        p.active &&
        ["QB", "RB", "WR", "TE", "K"].includes(p.position) &&
        p.years_exp === 0
    )
    .map((p) => ({
      id: p.player_id,
      name: playerName(p),
      pos: p.position,
      team: p.team || "FA",
      college: p.college || null,
      adp: p.search_rank ?? 9999,
      updated_at: new Date().toISOString(),
    }))
    .sort((a, b) => a.adp - b.adp);

  await upsertBatched("rookies", rows);
  console.log(`  upserted ${rows.length} rookies`);
}

// ---- 1c. Depth charts (all rostered players on a depth chart) -----------
async function refreshDepthChart(raw) {
  const now = new Date().toISOString();
  const rows = Object.values(raw)
    .filter(
      (p) =>
        p.active &&
        p.team &&
        ["QB", "RB", "WR", "TE", "K"].includes(p.position) &&
        p.depth_chart_order != null
    )
    .map((p) => ({
      id: p.player_id,
      name: playerName(p),
      pos: p.position,
      team: p.team,
      depth_position: p.depth_chart_position || p.position,
      depth_order: p.depth_chart_order,
      updated_at: now,
    }))
    .sort((a, b) => a.depth_order - b.depth_order);

  await upsertBatched("depth_chart", rows);
  console.log(`  upserted ${rows.length} depth-chart entries`);
}

// ---- 2. News from RSS --------------------------------------
async function refreshNews(players) {
  console.log("Fetching RSS feeds…");
  const parser = new Parser({ timeout: 10000 });
  const matchers = buildPlayerMatchers(players);
  const items = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items.slice(0, 30)) {
        const link = item.link || item.guid;
        if (!link) continue;
        const title = decodeEntities(item.title) || "(untitled)";
        const text = `${title} ${decodeEntities(item.contentSnippet) || ""}`;
        items.push({
          id: hashUrl(link),
          title,
          link,
          source: feed.source,
          team: tagTeam(text),
          player_ids: tagPlayers(text, matchers),
          summary: null, // Claude fills this in a later step (Phase 2b)
          published: item.isoDate ? new Date(item.isoDate).toISOString() : null,
        });
      }
      console.log(`  ${feed.source}: ${parsed.items.length} items`);
    } catch (e) {
      console.warn(`  skipped ${feed.source}: ${e.message}`);
    }
  }

  if (items.length) {
    const { error } = await supabase.from("news").upsert(items);
    if (error) throw error;
  }
  console.log(`  upserted ${items.length} news items`);
}

// ---- run ---------------------------------------------------
async function main() {
  const raw = await fetchSleeperPlayers();
  const players = await refreshPlayers(raw);
  await refreshRookies(raw);
  await refreshDepthChart(raw);
  await refreshNews(players);
  console.log("Refresh complete.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Refresh failed:", e);
    process.exit(1);
  });
