import { getServerClient } from "../../../lib/supabase";

// GET /api/rookies -> full 2026 rookie class, best (lowest ADP) first.

export async function GET() {
  const supabase = getServerClient();

  const { data, error } = await supabase
    .from("rookies")
    .select("*")
    .order("adp", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ rookies: data });
}
