import { getServerClient } from "../../../lib/supabase";

// GET /api/rosters -> your "mine" picks across every league, enriched for the
// My Teams view:
//   - rosters:  { leagueId: [ {player + bye + injury + (RB) handcuff} ] }
//   - exposure: players you roster on 2+ of your teams
//   - week:     current NFL week (to flag byes happening now)

interface RbDepth {
  id: string;
  name: string;
  team: string;
  depth_order: number | null;
}

export async function GET() {
  const supabase = getServerClient();

  const [
    { data: picks, error: pkErr },
    { data: players, error: plErr },
    { data: rbDepth, error: dErr },
    { data: leagues, error: lErr },
  ] = await Promise.all([
    supabase.from("draft_picks").select("league, player_id").eq("status", "mine"),
    supabase.from("players").select("id, name, pos, team, bye, injury"),
    supabase
      .from("depth_chart")
      .select("id, name, team, depth_order")
      .eq("pos", "RB"),
    supabase.from("leagues").select("id, name").order("sort", { ascending: true }),
  ]);

  if (pkErr || plErr || dErr || lErr) {
    return Response.json(
      { error: (pkErr || plErr || dErr || lErr)!.message },
      { status: 500 }
    );
  }

  const playerById: Record<string, Record<string, unknown>> = Object.fromEntries(
    (players || []).map((p) => [p.id, p])
  );

  // team -> RBs sorted by depth order (for handcuffs)
  const rbByTeam: Record<string, RbDepth[]> = {};
  (rbDepth || []).forEach((r) => {
    (rbByTeam[r.team] ||= []).push(r);
  });
  Object.values(rbByTeam).forEach((list) =>
    list.sort((a, b) => (a.depth_order ?? 99) - (b.depth_order ?? 99))
  );

  // picks grouped by league (+ a per-league id set for the handcuff check)
  const idsByLeague: Record<string, string[]> = {};
  const mineSetByLeague: Record<string, Set<string>> = {};
  (picks || []).forEach((pk) => {
    (idsByLeague[pk.league] ||= []).push(pk.player_id);
    (mineSetByLeague[pk.league] ||= new Set()).add(pk.player_id);
  });

  const rosters: Record<string, unknown[]> = {};
  for (const [lg, ids] of Object.entries(idsByLeague)) {
    rosters[lg] = ids.map((id) => {
      const p = playerById[id];
      const entry: Record<string, unknown> = {
        id,
        name: (p?.name as string) || id,
        pos: (p?.pos as string) || "?",
        team: (p?.team as string) || null,
        bye: (p?.bye as number) ?? null,
        injury: (p?.injury as string) || null,
      };
      if (p?.pos === "RB" && p?.team) {
        const list = rbByTeam[p.team as string] || [];
        const idx = list.findIndex((r) => r.id === id);
        let hc: RbDepth | null = null;
        if (idx >= 0 && idx + 1 < list.length) hc = list[idx + 1];
        else if (idx === -1) hc = list.find((r) => r.id !== id) || null;
        if (hc) {
          entry.handcuff = hc.name;
          entry.handcuff_rostered = mineSetByLeague[lg].has(hc.id);
        }
      }
      return entry;
    });
  }

  // exposure: players on 2+ of your teams
  const leagueName: Record<string, string> = Object.fromEntries(
    (leagues || []).map((l) => [l.id, l.name])
  );
  const leaguesByPlayer: Record<string, string[]> = {};
  (picks || []).forEach((pk) => {
    (leaguesByPlayer[pk.player_id] ||= []).push(pk.league);
  });
  const exposure = Object.entries(leaguesByPlayer)
    .filter(([, lgs]) => lgs.length >= 2)
    .map(([id, lgs]) => {
      const p = playerById[id];
      return {
        id,
        name: (p?.name as string) || id,
        pos: (p?.pos as string) || "?",
        team: (p?.team as string) || null,
        leagues: lgs.map((l) => leagueName[l] || l),
      };
    })
    .sort((a, b) => b.leagues.length - a.leagues.length);

  // current NFL week (best-effort, to flag byes happening now)
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
