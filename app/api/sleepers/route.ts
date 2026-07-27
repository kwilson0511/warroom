import { getServerClient } from "../../../lib/supabase";

// GET /api/sleepers -> curated analyst sleeper/breakout picks.

export async function GET() {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("sleepers")
    .select("*")
    .order("pos", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ sleepers: data });
}
