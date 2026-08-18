import { getServerClient } from "../../../lib/supabase";

// GET  /api/board?league=l1   -> players + GLOBAL favorites + THIS league's picks
// POST /api/board             -> update a favorite (global) or a pick (per-league)
//   { playerId, favorite: bool }                  -> global favorite
//   { league, playerId, status: mine|kyle|taken|available } -> per-league pick
//
// Favorites live in draft_state (shared across leagues). Draft picks live in
// draft_picks, keyed by (league, player_id), because the same player can be
// "mine" in one league and "taken" in another.

export async function GET(request: Request) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);
  const league = searchParams.get("league") || "l1";

  const [
    { data: players, error: pErr },
    { data: favs, error: fErr },
    { data: picks, error: kErr },
  ] = await Promise.all([
    supabase.from("players").select("*").order("adp", { ascending: true }),
    supabase.from("draft_state").select("player_id, favorite"),
    supabase.from("draft_picks").select("player_id, status").eq("league", league),
  ]);

  if (pErr || fErr || kErr) {
    return Response.json(
      { error: (pErr || fErr || kErr)!.message },
      { status: 500 }
    );
  }

  const favById = Object.fromEntries(
    (favs || []).map((f) => [f.player_id, f.favorite])
  );
  const statusById = Object.fromEntries(
    (picks || []).map((k) => [k.player_id, k.status])
  );

  const merged = (players || []).map((p) => ({
    ...p,
    favorite: favById[p.id] ?? false,
    status: statusById[p.id] || "available",
  }));

  return Response.json({ players: merged });
}

export async function POST(request: Request) {
  const supabase = getServerClient();
  const { playerId, favorite, league, status } = await request.json();

  if (!playerId) {
    return Response.json({ error: "playerId is required." }, { status: 400 });
  }

  // Favorite update — global, no league needed.
  if (favorite !== undefined) {
    if (typeof favorite !== "boolean") {
      return Response.json({ error: "favorite must be a boolean." }, { status: 400 });
    }
    const { error } = await supabase.from("draft_state").upsert({
      player_id: playerId,
      favorite,
      updated_at: new Date().toISOString(),
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  // Draft pick update — per league.
  if (status !== undefined) {
    if (!league) {
      return Response.json({ error: "league is required for a pick." }, { status: 400 });
    }
    const valid = ["available", "mine", "kyle", "taken"];
    if (!valid.includes(status)) {
      return Response.json({ error: "Invalid status." }, { status: 400 });
    }
    if (status === "available") {
      // Clear the pick — remove the row.
      const { error } = await supabase
        .from("draft_picks")
        .delete()
        .eq("league", league)
        .eq("player_id", playerId);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      return Response.json({ ok: true });
    }
    const { error } = await supabase.from("draft_picks").upsert({
      league,
      player_id: playerId,
      status,
      updated_at: new Date().toISOString(),
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json(
    { error: "Provide a favorite, or a league + status." },
    { status: 400 }
  );
}
