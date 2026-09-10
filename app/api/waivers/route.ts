import { getServerClient } from "../../../lib/supabase";

// GET /api/waivers?league=l1 -> top available free agents for that league,
// ranked by weekly projection, enriched, with an "upgrade" flag when a player
// out-projects your weakest starter at their position.

interface Ref {
  name: string;
  pos: string;
  team: string | null;
}

const BYE_WEEKS: Record<string, number> = {
  KC: 5, CAR: 5, MIA: 6, CIN: 6, DET: 6, MIN: 6, BUF: 7, LAC: 7, WAS: 7,
  JAX: 7, NYG: 8, NO: 8, SF: 8, HOU: 8, TEN: 9, PIT: 9, DEN: 10, PHI: 10,
  CHI: 10, TB: 10, NE: 11, CLE: 11, SEA: 11, GB: 11, ATL: 11, LAR: 11,
  IND: 13, NYJ: 13, LV: 13, BAL: 13, DAL: 14, ARI: 14,
};

export async function GET(request: Request) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);
  const league = searchParams.get("league") || "l1";

  const [
    { data: waivers, error: wErr },
    { data: players, error: plErr },
    { data: depth, error: dErr },
    { data: rookies, error: rErr },
    { data: myPicks, error: mErr },
  ] = await Promise.all([
    supabase
      .from("waivers")
      .select("player_id, proj, pct_owned")
      .eq("league", league)
      .order("proj", { ascending: false, nullsFirst: false }),
    supabase.from("players").select("id, name, pos, team, injury"),
    supabase.from("depth_chart").select("id, name, pos, team"),
    supabase.from("rookies").select("id, name, pos, team"),
    supabase
      .from("draft_picks")
      .select("player_id, proj, starter")
      .eq("league", league)
      .eq("status", "mine"),
  ]);

  if (wErr || plErr || dErr || rErr || mErr) {
    return Response.json(
      { error: (wErr || plErr || dErr || rErr || mErr)!.message },
      { status: 500 }
    );
  }

  const ref: Record<string, Ref> = {};
  const put = (id: string, name: string, pos: string, team: string | null) => {
    ref[id] = { name, pos, team };
  };
  (rookies || []).forEach((p) => put(p.id, p.name, p.pos, p.team));
  (depth || []).forEach((p) => put(p.id, p.name, p.pos, p.team));
  (players || []).forEach((p) => put(p.id, p.name, p.pos, p.team));

  const injuryById: Record<string, string | null> = Object.fromEntries(
    (players || []).map((p) => [p.id, p.injury])
  );

  // Weakest starter projection per position = the bar a pickup must clear.
  const minStarterProjByPos: Record<string, number> = {};
  (myPicks || []).forEach((pk) => {
    if (!pk.starter || pk.proj == null) return;
    const pos = ref[pk.player_id]?.pos;
    if (!pos) return;
    if (
      minStarterProjByPos[pos] === undefined ||
      pk.proj < minStarterProjByPos[pos]
    ) {
      minStarterProjByPos[pos] = pk.proj;
    }
  });

  const list = (waivers || []).map((w) => {
    const r = ref[w.player_id];
    const team = r?.team ?? null;
    const pos = r?.pos || "?";
    const thresh = minStarterProjByPos[pos];
    return {
      id: w.player_id,
      name: r?.name || w.player_id,
      pos,
      team,
      bye: team ? BYE_WEEKS[team] ?? null : null,
      injury: injuryById[w.player_id] || null,
      proj: w.proj,
      pct_owned: w.pct_owned,
      upgrade: w.proj != null && thresh !== undefined && w.proj > thresh,
    };
  });

  return Response.json({ list });
}
