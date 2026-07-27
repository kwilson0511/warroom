import { getServerClient } from "../../../lib/supabase";

// GET  /api/board   -> players joined with their draft status
// POST /api/board   -> { playerId, status } updates one player's status
//
// This route runs on the server, so it can safely use the service
// role key. The browser never sees it.

export async function GET() {
  const supabase = getServerClient();

  const [{ data: players, error: pErr }, { data: state, error: sErr }] =
    await Promise.all([
      supabase.from("players").select("*").order("adp", { ascending: true }),
      supabase.from("draft_state").select("*"),
    ]);

  if (pErr || sErr) {
    return Response.json(
      { error: (pErr || sErr)!.message },
      { status: 500 }
    );
  }

  const stateById = Object.fromEntries(
    (state || []).map((s) => [s.player_id, s])
  );

  const merged = (players || []).map((p) => {
    const st = stateById[p.id];
    return {
      ...p,
      status: st?.status || "available",
      favorite: st?.favorite ?? false,
    };
  });

  return Response.json({ players: merged });
}

export async function POST(request: Request) {
  const supabase = getServerClient();
  const { playerId, status, favorite } = await request.json();

  if (!playerId) {
    return Response.json({ error: "playerId is required." }, { status: 400 });
  }

  const valid = ["available", "mine", "taken"];
  const hasStatus = status !== undefined;
  const hasFavorite = favorite !== undefined;

  if (!hasStatus && !hasFavorite) {
    return Response.json(
      { error: "Provide a status and/or favorite to update." },
      { status: 400 }
    );
  }
  if (hasStatus && !valid.includes(status)) {
    return Response.json({ error: "Invalid status." }, { status: 400 });
  }
  if (hasFavorite && typeof favorite !== "boolean") {
    return Response.json(
      { error: "favorite must be a boolean." },
      { status: 400 }
    );
  }

  // Only the provided fields are written, so toggling favorite never
  // clobbers status (and vice versa) on the shared draft_state row.
  const row: Record<string, unknown> = {
    player_id: playerId,
    updated_at: new Date().toISOString(),
  };
  if (hasStatus) row.status = status;
  if (hasFavorite) row.favorite = favorite;

  const { error } = await supabase.from("draft_state").upsert(row);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
