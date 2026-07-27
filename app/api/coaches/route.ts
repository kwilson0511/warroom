import { getServerClient } from "../../../lib/supabase";

// GET /api/coaches -> all teams' head-coach info (curated snapshot).
// Runs server-side so it uses the service-role key like the other routes.

export async function GET() {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("coaches")
    .select("*")
    .order("team", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ coaches: data });
}
