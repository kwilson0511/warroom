import { getServerClient } from "../../../lib/supabase";

// GET /api/news             -> most recent news items (default 50)
// GET /api/news?team=CIN    -> recent items tagged to that team
// GET /api/news?player=4984 -> recent items whose player_ids contains that id
// GET /api/news?limit=100   -> raise the cap (1..200) for the global feed
//
// If both team and player are provided, player takes precedence.

export async function GET(request: Request) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team");
  const player = searchParams.get("player");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 200);

  let query = supabase
    .from("news")
    .select("*")
    .order("published", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (player) {
    // player_ids is a text[] column; `contains` maps to the PG @> operator.
    query = query.contains("player_ids", [player]);
  } else if (team) {
    query = query.eq("team", team);
  }

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ news: data });
}
