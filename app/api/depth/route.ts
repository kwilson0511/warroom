import { getServerClient } from "../../../lib/supabase";

// GET /api/depth?team=BUF -> that team's depth chart, starters first.

export async function GET(request: Request) {
  const supabase = getServerClient();
  const { searchParams } = new URL(request.url);
  const team = searchParams.get("team");

  let query = supabase
    .from("depth_chart")
    .select("*")
    .order("depth_order", { ascending: true });

  if (team) query = query.eq("team", team);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ depth: data });
}
