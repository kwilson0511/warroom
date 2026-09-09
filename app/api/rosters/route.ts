import { getServerClient } from "../../../lib/supabase";

// GET /api/rosters?owner=mine|kyle -> that owner's picks across every league,
// enriched for the My Teams / Kyle's Teams view:
//   - rosters:  { leagueId: [ {player + bye + injury + (RB) handcuff} ] }
//   - exposure: players rostered on 2+ of that owner's teams
//   - week:     current NFL week (to flag byes happening now)
//
// Names/teams are resolved from players + depth_chart + rookies so even deep
// bench players (outside the top-325 board) show correctly. Byes are by team.

interface RbDepth {
  id: string;
  name: string;
  team: string;
  depth_order: number | null;
}
interface Ref {
  name: string;
  pos: string;
  team: string | null;
}

// 2026 NFL bye weeks by team (mirrors scripts/refresh.mjs).
const BYE_WEEKS: Record<string, number> = {
  KC: 5, CAR: 5, MIA: 6, CIN: 6, DET: 6, MIN: 6, BUF: 7, LAC: 7, WAS: 7,
  JAX: 7, NYG: 8, NO: 8, SF: 8, HOU: 8, TEN: 9, PIT: 9, DEN: 10, PHI: 10,
  CHI: 10, TB: 10, NE: 11, CLE: 11, SEA: 11, GB: 11, ATL: 11, LAR: 11,
  IND: 13, NYJ: 13, LV: 13, BAL: 13, DAL: 14, ARI: 14,
};

export async function GET(request: Request) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner") === "kyle" ? "kyle" : "mine";

  const [
    { data: picks, error: pkErr },
    { data: players, error: plErr },
    { data: depth, error: dErr },
    { data: rookies, error: rErr },
    { data: leagues, error: lErr },
  ] = await Promise.all([
    supabase.from("draft_picks").select("league, player_id").eq("status", owner),
    supabase.from("players").select("id, name, pos, team, injury"),
    supabase.from("depth_chart").select("id, name, pos, team, depth_order"),
    supabase.from("rookies").select("id, name, pos, team"),
    supabase.from("leagues").select("id, name").order("sort", { ascending: true }),
  ]);

  if (pkErr || plErr || dErr || rErr || lErr) {
    return Response.json(
      { error: (pkErr || plErr || dErr || rErr || lErr)!.message },
      { status: 500 }
    );
  }

  // Name/pos/team lookup — rookies first, then depth chart, then players (most
  // authoritative) overlaid on top.
  const ref: Record<string, Ref> = {};
  const put = (id: string, name: string, pos: string, team: string | null) => {
    ref[id] = { name, pos, team };
  };
  (rookies || []).forEach((p) => put(p.id, p.name, p.pos, p.team));
  (depth || []).forEach((p) => put(p.id, p.name, p.pos, p.team));
  (players || []).forEach((p) => put(p.id, p.name, p.pos, p.team));

  // injury only exists for the top-325 players table
  const injuryById: Record<string, string | null> = Object.fromEntries(
    (players || []).map((p) => [p.id, p.injury])
  );

  // team -> RBs by depth order (handcuffs)
  const rbByTeam: Record<string, RbDepth[]> = {};
  (depth || [])
    .filter((p) => p.pos === "RB")
    .forEach((r) => {
      (rbByTeam[r.team] ||= []).push(r);
    });
  Object.values(rbByTeam).forEach((list) =>
    list.sort((a, b) => (a.depth_order ?? 99) - (b.depth_order ?? 99))
  );

  const idsByLeague: Record<string, string[]> = {};
  const mineSetByLeague: Record<string, Set<string>> = {};
  (picks || []).forEach((pk) => {
    (idsByLeague[pk.league] ||= []).push(pk.player_id);
    (mineSetByLeague[pk.league] ||= new Set()).add(pk.player_id);
  });

  const rosters: Record<string, unknown[]> = {};
  for (const [lg, ids] of Object.entries(idsByLeague)) {
    rosters[lg] = ids.map((id) => {
      const r = ref[id];
      const team = r?.team ?? null;
      const entry: Record<string, unknown> = {
        id,
        name: r?.name || id,
        pos: r?.pos || "?",
        team,
        bye: team ? BYE_WEEKS[team] ?? null : null,
        injury: injuryById[id] || null,
      };
      if (r?.pos === "RB" && team) {
        const list = rbByTeam[team] || [];
        const idx = list.findIndex((x) => x.id === id);
        let hc: RbDepth | null = null;
        if (idx >= 0 && idx + 1 < list.length) hc = list[idx + 1];
        else if (idx === -1) hc = list.find((x) => x.id !== id) || null;
        if (hc) {
          entry.handcuff = hc.name;
          entry.handcuff_rostered = mineSetByLeague[lg].has(hc.id);
        }
      }
      return entry;
    });
  }

  // exposure: players on 2+ of this owner's teams
  const leagueName: Record<string, string> = Object.fromEntries(
    (leagues || []).map((l) => [l.id, l.name])
  );
  const leaguesByPlayer: Record<string, string[]> = {};
  (picks || []).forEach((pk) => {
    (leaguesByPlayer[pk.player_id] ||= []).push(pk.league);
  });
  const exposure = Object.entries(leaguesByPlayer)
    .filter(([, lgs]) => lgs.length >= 2)
    .map(([id, lgs]) => ({
      id,
      name: ref[id]?.name || id,
      pos: ref[id]?.pos || "?",
      team: ref[id]?.team || null,
      leagues: lgs.map((l) => leagueName[l] || l),
    }))
    .sort((a, b) => b.leagues.length - a.leagues.length);

  let week: number | null = null;
  try {
    const st = await fetch("https://api.sleeper.app/v1/state/nfl").then((r) =>
      r.json()
    );
    week = st?.week ?? null;
  } catch {
    week = null;
  }

  return Response.json({ leagues, rosters, exposure, week });
}
