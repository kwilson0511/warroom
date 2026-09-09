// GET /api/odds -> this week's Vegas lines per team, with implied team totals.
// Source: ESPN's public scoreboard (no auth). Fetched live so it stays current.
//   teams: { ABBR: { opp, home, total, spread, implied, kickoff } }
//   week:  current NFL week
//
// implied team total = total/2 ± (favorite's line)/2 — Vegas' expected points
// for that offense, the key start/sit signal.

// ESPN uses a few abbreviations that differ from Sleeper's.
const ABBR: Record<string, string> = { WSH: "WAS" };
const norm = (a: string) => ABBR[a] || a;

interface TeamOdds {
  opp: string;
  home: boolean;
  total: number | null;
  spread: number; // this team's spread (negative = favored)
  implied: number | null;
  kickoff: string | null;
}

export async function GET() {
  let data;
  try {
    data = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
      { cache: "no-store" }
    ).then((r) => r.json());
  } catch {
    return Response.json({ week: null, teams: {} });
  }

  const teams: Record<string, TeamOdds> = {};

  for (const ev of data.events || []) {
    const c = ev.competitions?.[0];
    if (!c) continue;
    const home = c.competitors?.find((x: { homeAway: string }) => x.homeAway === "home");
    const away = c.competitors?.find((x: { homeAway: string }) => x.homeAway === "away");
    if (!home || !away) continue;
    const homeAbbr = norm(home.team.abbreviation);
    const awayAbbr = norm(away.team.abbreviation);

    const o = c.odds?.[0] || {};
    const total: number | null = typeof o.overUnder === "number" ? o.overUnder : null;

    // Parse the favorite + line from details, e.g. "DET -7".
    let favAbbr: string | null = null;
    let favBy = 0;
    const m = (o.details || "").match(/^([A-Za-z]{2,4})\s+(-?\d+(?:\.\d+)?)/);
    if (m) {
      favAbbr = norm(m[1].toUpperCase());
      favBy = Math.abs(parseFloat(m[2]));
    }

    const impliedFor = (abbr: string) => {
      if (total == null) return null;
      const half = total / 2;
      if (!favAbbr || favBy === 0) return Math.round(half * 10) / 10;
      const bump = abbr === favAbbr ? favBy / 2 : -favBy / 2;
      return Math.round((half + bump) * 10) / 10;
    };
    const spreadFor = (abbr: string) =>
      !favAbbr ? 0 : abbr === favAbbr ? -favBy : favBy;

    teams[homeAbbr] = {
      opp: awayAbbr,
      home: true,
      total,
      spread: spreadFor(homeAbbr),
      implied: impliedFor(homeAbbr),
      kickoff: ev.date || null,
    };
    teams[awayAbbr] = {
      opp: homeAbbr,
      home: false,
      total,
      spread: spreadFor(awayAbbr),
      implied: impliedFor(awayAbbr),
      kickoff: ev.date || null,
    };
  }

  return Response.json({ week: data.week?.number ?? null, teams });
}
