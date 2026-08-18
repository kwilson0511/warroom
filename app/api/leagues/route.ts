import { getServerClient } from "../../../lib/supabase";

// GET  /api/leagues            -> the 3 leagues (id, name), ordered
// POST /api/leagues { id, name } -> rename a league

export async function GET() {
  const supabase = getServerClient();
  const { data, error } = await supabase
    .from("leagues")
    .select("*")
    .order("sort", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ leagues: data });
}

export async function POST(request: Request) {
  const supabase = getServerClient();
  const { id, name } = await request.json();

  if (!id || typeof name !== "string" || !name.trim()) {
    return Response.json(
      { error: "id and a non-empty name are required." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("leagues")
    .update({ name: name.trim().slice(0, 40) })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
