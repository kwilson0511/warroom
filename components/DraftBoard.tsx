"use client";

import { useState, useEffect, useMemo, useCallback } from "react";

/**
 * DraftBoard — Phase 1 + 2.
 *
 * Reads live from your own API routes (which read Supabase):
 *   GET  /api/board          players + shared draft status
 *   POST /api/board          update one player's status
 *   GET  /api/news?team=XXX   news for the selected team
 *
 * Draft status cycles: available -> mine -> taken -> available.
 * Because state lives in Supabase, you and your husband see the
 * same board update on both devices (poll every 8s below).
 */

type Status = "available" | "mine" | "kyle" | "taken";

interface League {
  id: string;
  name: string;
  sort: number;
}

interface Player {
  id: string;
  name: string;
  pos: string;
  team: string;
  adp: number;
  bye: number | null;
  injury: string | null;
  status: Status;
  favorite: boolean;
  rookie: boolean;
  college: string | null;
  updated_at?: string;
}

interface Rookie {
  id: string;
  name: string;
  pos: string;
  team: string;
  college: string | null;
  adp: number;
}

interface Sleeper {
  id: string;
  player_id: string | null;
  name: string;
  pos: string | null;
  team: string | null;
  source: string | null;
}

interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  summary: string | null;
  team: string | null;
  player_ids?: string[];
  published?: string | null;
}

interface Coach {
  team: string;
  head_coach: string;
  hired: number | null;
  is_new: boolean;
  off_coordinator: string | null;
  def_coordinator: string | null;
}

interface DepthEntry {
  id: string;
  name: string;
  pos: string;
  team: string;
  depth_position: string | null;
  depth_order: number | null;
}

// What the news drawer is currently showing: the team overview (a list of
// all teams), a single team's news, or one player's news.
type Drawer =
  | { kind: "teams" }
  | { kind: "team"; team: string }
  | { kind: "player"; id: string; name: string }
  | { kind: "rookies" }
  | { kind: "sleepers" }
  | { kind: "injuries" }
  | { kind: "news" };

// Heuristic: does this article look like breaking injury/transaction news?
const PRIORITY_RE =
  /\b(injur|questionable|doubtful|out for|inactive|ir|pup|acl|mcl|surgery|hamstring|suspend|traded?|trade|sign(ed|s)?|waiv|releas|activat|placed on)\b/i;
function isPriority(n: NewsItem) {
  return PRIORITY_RE.test(`${n.title} ${n.summary || ""}`);
}

// Decode HTML entities + collapse whitespace so titles are consistent for
// both display and de-duplication, regardless of how a feed encoded them.
function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function cleanTitle(s: string | null | undefined) {
  return decodeEntities(s || "").replace(/\s+/g, " ").trim();
}

// Collapse the same headline coming from multiple feeds into one item.
// Keys off the cleaned title so encoded/decoded variants match. Keeps the
// first occurrence (news arrives newest-first).
function dedupeByTitle(items: NewsItem[]) {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const n of items) {
    const key = cleanTitle(n.title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(n);
  }
  return out;
}

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "DEF"];
const STATUS_LABEL: Record<Status, string> = {
  available: "",
  mine: "MINE",
  kyle: "KYLE",
  taken: "TAKEN",
};
const LS_LEAGUE_KEY = "warroom.league"; // remembers league choice per device

function assignTier(adp: number) {
  if (adp <= 3) return 1;
  if (adp <= 8) return 2;
  if (adp <= 18) return 3;
  if (adp <= 36) return 4;
  return 5;
}
const TIER_LABELS: Record<number, string> = {
  1: "Elite — build around",
  2: "Studs",
  3: "Rock-solid starters",
  4: "Value / upside",
  5: "Depth & fliers",
};

export default function DraftBoard() {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState("l1"); // starts at l1 (SSR-safe), then localStorage
  const [pos, setPos] = useState("ALL");
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [rookieOnly, setRookieOnly] = useState(false);
  const [sleeperOnly, setSleeperOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [kyleOnly, setKyleOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [coaches, setCoaches] = useState<Record<string, Coach>>({});
  const [depth, setDepth] = useState<DepthEntry[]>([]);
  const [rookies, setRookies] = useState<Rookie[]>([]);
  const [sleepers, setSleepers] = useState<Sleeper[]>([]);

  const loadBoard = useCallback(async () => {
    try {
      const res = await fetch(`/api/board?league=${encodeURIComponent(league)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPlayers(data.players);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [league]);

  // Restore the last-used league on this device (client-only, after mount so
  // it doesn't mismatch the server-rendered default).
  useEffect(() => {
    const saved = localStorage.getItem(LS_LEAGUE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setLeague(saved);
  }, []);

  // Remember the league choice per device.
  useEffect(() => {
    localStorage.setItem(LS_LEAGUE_KEY, league);
  }, [league]);

  // Load the 3 leagues (names) once.
  useEffect(() => {
    fetch("/api/leagues", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLeagues(d.leagues || []))
      .catch(() => setLeagues([]));
  }, []);

  // Initial load + light polling so both drafters stay in sync. Re-runs when
  // the league changes (loadBoard depends on league), refetching that league.
  // The first load is dispatched via a 0ms timer (rather than called directly)
  // so it isn't a synchronous setState inside the effect body.
  useEffect(() => {
    const kickoff = setTimeout(loadBoard, 0);
    const t = setInterval(loadBoard, 8000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(t);
    };
  }, [loadBoard]);

  // Load news for the drawers that show articles: a team, a player, or the
  // global "news" feed. The other overviews are just lists, so they don't fetch.
  useEffect(() => {
    if (!drawer) return;
    let qs: string | null = null;
    if (drawer.kind === "team") qs = `team=${encodeURIComponent(drawer.team)}`;
    else if (drawer.kind === "player") qs = `player=${encodeURIComponent(drawer.id)}`;
    else if (drawer.kind === "news") qs = `limit=100`;
    if (qs === null) return;
    fetch(`/api/news?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setNews(d.news || []))
      .catch(() => setNews([]));
  }, [drawer]);

  // Coaching staff (curated snapshot) — loaded once for the Teams view.
  useEffect(() => {
    fetch("/api/coaches", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, Coach> = {};
        (d.coaches || []).forEach((c: Coach) => {
          map[c.team] = c;
        });
        setCoaches(map);
      })
      .catch(() => setCoaches({}));
  }, []);

  // A team's depth chart — loaded when a team drawer opens.
  useEffect(() => {
    if (!drawer || drawer.kind !== "team") return;
    fetch(`/api/depth?team=${encodeURIComponent(drawer.team)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => setDepth(d.depth || []))
      .catch(() => setDepth([]));
  }, [drawer]);

  // Full rookie class — loaded once for the Rookies view.
  useEffect(() => {
    fetch("/api/rookies", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRookies(d.rookies || []))
      .catch(() => setRookies([]));
  }, []);

  // Curated sleeper picks — loaded once for the badge, filter, and view.
  useEffect(() => {
    fetch("/api/sleepers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSleepers(d.sleepers || []))
      .catch(() => setSleepers([]));
  }, []);

  // Assign a draft pick for the CURRENT league. Tapping the active status
  // again clears it back to available. Per-league, so it doesn't affect
  // your other leagues.
  async function setPick(player: Player, target: Status) {
    const next: Status = player.status === target ? "available" : target;
    // Optimistic update so taps feel instant.
    setPlayers((ps) =>
      ps!.map((p) => (p.id === player.id ? { ...p, status: next } : p))
    );
    await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ league, playerId: player.id, status: next }),
    }).catch(() => loadBoard()); // reload on failure to resync
  }

  async function renameLeague() {
    const current = leagues.find((l) => l.id === league);
    const name = window.prompt("League name:", current?.name || "");
    if (!name || !name.trim()) return;
    const trimmed = name.trim().slice(0, 40);
    setLeagues((ls) =>
      ls.map((l) => (l.id === league ? { ...l, name: trimmed } : l))
    );
    await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: league, name: trimmed }),
    }).catch(() => {});
  }

  async function toggleFavorite(player: Player) {
    const next = !player.favorite;
    // Optimistic update so the star flips instantly.
    setPlayers((ps) =>
      ps!.map((p) => (p.id === player.id ? { ...p, favorite: next } : p))
    );
    await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: player.id, favorite: next }),
    }).catch(() => loadBoard()); // reload on failure to resync
  }

  // Set of matched sleeper player_ids, for badging/filtering the board.
  const sleeperIds = useMemo(
    () => new Set(sleepers.map((s) => s.player_id).filter(Boolean)),
    [sleepers]
  );

  const filtered = useMemo(() => {
    if (!players) return [];
    return players
      .filter((p) => (pos === "ALL" ? true : p.pos === pos))
      .filter((p) => (favOnly ? p.favorite : true))
      .filter((p) => (rookieOnly ? p.rookie : true))
      .filter((p) => (sleeperOnly ? sleeperIds.has(p.id) : true))
      .filter((p) => (mineOnly ? p.status === "mine" : true))
      .filter((p) => (kyleOnly ? p.status === "kyle" : true))
      .filter((p) =>
        query.trim()
          ? (p.name + p.team).toLowerCase().includes(query.toLowerCase())
          : true
      );
  }, [
    players,
    pos,
    query,
    favOnly,
    rookieOnly,
    sleeperOnly,
    mineOnly,
    kyleOnly,
    sleeperIds,
  ]);

  // Rookie class grouped by position for the dedicated Rookies view.
  const rookiesByPos = useMemo(() => {
    const map: Record<string, Rookie[]> = {};
    rookies.forEach((r) => {
      (map[r.pos] ||= []).push(r);
    });
    return map;
  }, [rookies]);

  // Sleeper picks grouped by position for the dedicated Sleepers view.
  const sleepersByPos = useMemo(() => {
    const map: Record<string, Sleeper[]> = {};
    sleepers.forEach((s) => {
      (map[s.pos || "?"] ||= []).push(s);
    });
    return map;
  }, [sleepers]);

  const tiers = useMemo(() => {
    const map: Record<number, Player[]> = {};
    filtered.forEach((p) => {
      (map[assignTier(p.adp)] ||= []).push(p);
    });
    return map;
  }, [filtered]);

  const mineCount = (players || []).filter((p) => p.status === "mine").length;
  const kyleCount = (players || []).filter((p) => p.status === "kyle").length;
  const favCount = (players || []).filter((p) => p.favorite).length;

  // Clean sequential rank (1..N) by board order — the API returns players
  // already sorted by adp, so index+1 is a gap-free, tie-free overall rank.
  const rankById = useMemo(() => {
    const m: Record<string, number> = {};
    (players || []).forEach((p, i) => {
      m[p.id] = i + 1;
    });
    return m;
  }, [players]);

  // Everyone with a reported injury status, in board (rank) order.
  const injuries = useMemo(
    () => (players || []).filter((p) => p.injury),
    [players]
  );

  // Most recent updated_at across the board — how fresh the data is.
  const lastUpdated = useMemo(() => {
    const ts = (players || []).map((p) => p.updated_at).filter(Boolean) as string[];
    return ts.length ? ts.sort()[ts.length - 1] : null;
  }, [players]);

  // Collapse same-headline articles from multiple feeds into one.
  const dedupedNews = useMemo(() => dedupeByTitle(news), [news]);

  // Player/team news list with priority (injury/transaction) items floated up.
  // Stable sort keeps newest-first order within each group.
  const sortedNews = useMemo(
    () =>
      [...dedupedNews].sort(
        (a, b) => Number(isPriority(b)) - Number(isPriority(a))
      ),
    [dedupedNews]
  );

  // Global feed: a priority group, then everything else grouped by month.
  const newsGroups = useMemo(() => {
    const priority: NewsItem[] = [];
    const byMonth: Record<string, NewsItem[]> = {};
    dedupedNews.forEach((n) => {
      if (isPriority(n)) {
        priority.push(n);
        return;
      }
      const label = n.published
        ? new Date(n.published).toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })
        : "Undated";
      (byMonth[label] ||= []).push(n);
    });
    return { priority, byMonth };
  }, [dedupedNews]);

  // Current team's depth chart grouped by position, starters first.
  const depthByPos = useMemo(() => {
    const m: Record<string, DepthEntry[]> = {};
    [...depth]
      .sort((a, b) => (a.depth_order ?? 99) - (b.depth_order ?? 99))
      .forEach((d) => {
        (m[d.pos] ||= []).push(d);
      });
    return m;
  }, [depth]);

  // Unique teams present on the board (drop free agents), alphabetized.
  const teamList = useMemo(() => {
    const set = new Set<string>();
    (players || []).forEach((p) => {
      if (p.team && p.team !== "FA") set.add(p.team);
    });
    return Array.from(set).sort();
  }, [players]);

  const newsItem = (n: NewsItem) => (
    <li key={n.id}>
      <a href={n.link} target="_blank" rel="noreferrer">
        {isPriority(n) && <em className="news-pri">⚡</em>}
        {cleanTitle(n.title)}
      </a>
      {n.summary && <p className="news-sum">{n.summary}</p>}
      <span className="news-src">{n.source}</span>
    </li>
  );

  return (
    <div className="board">
      <style>{css}</style>

      <header className="masthead">
        <div>
          <span className="eyebrow">The War Room</span>
          <h1>Draft Board</h1>
        </div>
        <div className="masthead-right">
          <span className="tally">{mineCount} mine</span>
          <span className="tally tally--kyle">{kyleCount} Kyle</span>
          <span className="tally tally--fav">★ {favCount} following</span>
          {lastUpdated && (
            <span className="asof">
              data as of {new Date(lastUpdated).toLocaleDateString()}
            </span>
          )}
          {err && <span className="err">Connection issue — retrying…</span>}
        </div>
      </header>

      {/* League selector — draft picks are tracked separately per league. */}
      <div className="league-bar">
        <span className="league-label">League:</span>
        {leagues.map((l) => (
          <button
            key={l.id}
            className={`league-tab ${league === l.id ? "league-tab--on" : ""}`}
            onClick={() => setLeague(l.id)}
          >
            {l.name}
          </button>
        ))}
        <button
          className="league-rename"
          onClick={renameLeague}
          title="Rename this league"
        >
          ✎
        </button>
      </div>

      <div className="controls">
        <div className="pos-filter">
          {POSITIONS.map((p) => (
            <button
              key={p}
              className={`chip ${pos === p ? "chip--on" : ""}`}
              onClick={() => setPos(p)}
            >
              {p}
            </button>
          ))}
          <button
            className={`chip chip--fav ${favOnly ? "chip--on" : ""}`}
            onClick={() => setFavOnly((v) => !v)}
            title="Show only favorited players"
          >
            ★ Favorites
          </button>
          <button
            className={`chip ${rookieOnly ? "chip--on" : ""}`}
            onClick={() => setRookieOnly((v) => !v)}
            title="Show only rookies"
          >
            Rookies
          </button>
          <button
            className={`chip chip--sleeper ${sleeperOnly ? "chip--on" : ""}`}
            onClick={() => setSleeperOnly((v) => !v)}
            title="Show only curated sleeper picks"
          >
            Sleepers
          </button>
          <button
            className={`chip chip--mine ${mineOnly ? "chip--on" : ""}`}
            onClick={() => setMineOnly((v) => !v)}
            title="Show only my picks in this league"
          >
            My Team
          </button>
          <button
            className={`chip chip--kyle ${kyleOnly ? "chip--on" : ""}`}
            onClick={() => setKyleOnly((v) => !v)}
            title="Show only Kyle's picks in this league"
          >
            Kyle
          </button>
        </div>
        <div className="controls-right">
          <input
            className="search"
            placeholder="Find a player or team…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            className="teams-btn"
            onClick={() => setDrawer({ kind: "teams" })}
            title="Browse news by team"
          >
            Teams
          </button>
          <button
            className="teams-btn"
            onClick={() => setDrawer({ kind: "rookies" })}
            title="Browse the full rookie class"
          >
            Rookies
          </button>
          <button
            className="teams-btn"
            onClick={() => setDrawer({ kind: "sleepers" })}
            title="Browse curated sleeper picks"
          >
            Sleepers
          </button>
          <button
            className="teams-btn"
            onClick={() => setDrawer({ kind: "injuries" })}
            title="Latest injury report"
          >
            Injuries
          </button>
          <button
            className="teams-btn"
            onClick={() => setDrawer({ kind: "news" })}
            title="All recent news"
          >
            News
          </button>
        </div>
      </div>

      {!players && !err && <p className="empty">Loading the board…</p>}
      {err && !players && (
        <p className="empty">
          Couldn’t reach the board. Check that the daily refresh has run and your
          Supabase env vars are set.
        </p>
      )}

      {players &&
        [1, 2, 3, 4, 5].map((t) =>
          tiers[t]?.length ? (
            <section key={t} className="tier">
              <div className="tier-head">
                <span className="tier-num">Tier {t}</span>
                <span className="tier-label">{TIER_LABELS[t]}</span>
                <span className="tier-rule" />
              </div>
              <ul className="rows">
                {tiers[t].map((p) => (
                  <li key={p.id} className={`row row--${p.status || "available"}`}>
                    <span className="pick">
                      <button
                        className={`pk pk--m ${p.status === "mine" ? "on" : ""}`}
                        onClick={() => setPick(p, "mine")}
                        title="Mine"
                      >
                        M
                      </button>
                      <button
                        className={`pk pk--k ${p.status === "kyle" ? "on" : ""}`}
                        onClick={() => setPick(p, "kyle")}
                        title="Kyle"
                      >
                        K
                      </button>
                      <button
                        className={`pk pk--t ${p.status === "taken" ? "on" : ""}`}
                        onClick={() => setPick(p, "taken")}
                        title="Taken (someone else)"
                      >
                        T
                      </button>
                    </span>
                    <span className="adp">{rankById[p.id]}</span>
                    <span className={`postag postag--${p.pos}`}>{p.pos}</span>
                    <span className="pname">
                      <button
                        className={`fav ${p.favorite ? "fav--on" : ""}`}
                        onClick={() => toggleFavorite(p)}
                        title={p.favorite ? "Unfollow" : "Follow this player"}
                        aria-pressed={p.favorite}
                      >
                        {p.favorite ? "★" : "☆"}
                      </button>
                      <button
                        className="pname-btn"
                        onClick={() =>
                          setDrawer({ kind: "player", id: p.id, name: p.name })
                        }
                        title="See player news"
                      >
                        {p.name}
                      </button>
                      {STATUS_LABEL[p.status] && (
                        <em className={`badge badge--${p.status}`}>
                          {STATUS_LABEL[p.status]}
                        </em>
                      )}
                      {p.rookie && (
                        <em className="badge badge--rookie" title="Rookie">
                          ROOKIE
                        </em>
                      )}
                      {sleeperIds.has(p.id) && (
                        <em
                          className="badge badge--sleeper"
                          title="Curated sleeper pick"
                        >
                          SLEEPER
                        </em>
                      )}
                    </span>
                    <button
                      className="pteam"
                      onClick={() => setDrawer({ kind: "team", team: p.team })}
                      title="See team news"
                    >
                      {p.team}
                    </button>
                    <span className="pbye">{p.bye ? `bye ${p.bye}` : ""}</span>
                    <span className="pnote">
                      {p.injury
                        ? `Status: ${p.injury}`
                        : p.rookie && p.college
                        ? p.college
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null
        )}

      {/* News drawer */}
      {drawer && (
        <div className="drawer" onClick={() => setDrawer(null)}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h2>
                {drawer.kind === "teams"
                  ? "Teams"
                  : drawer.kind === "rookies"
                  ? "Rookie Class"
                  : drawer.kind === "sleepers"
                  ? "Sleeper Picks"
                  : drawer.kind === "injuries"
                  ? "Injury Report"
                  : drawer.kind === "news"
                  ? "Latest News"
                  : `${drawer.kind === "team" ? drawer.team : drawer.name} — latest`}
              </h2>
              <button className="drawer-close" onClick={() => setDrawer(null)}>
                ✕
              </button>
            </div>

            {drawer.kind === "rookies" ? (
              rookies.length === 0 ? (
                <p className="empty">
                  No rookie data yet — run the daily refresh.
                </p>
              ) : (
                <div className="rookie-view">
                  {["QB", "RB", "WR", "TE", "K"].map((rp) =>
                    rookiesByPos[rp]?.length ? (
                      <section key={rp} className="rookie-group">
                        <div className="tier-head">
                          <span className="tier-num">{rp}</span>
                          <span className="tier-label">
                            {rookiesByPos[rp].length} rookies
                          </span>
                          <span className="tier-rule" />
                        </div>
                        <ul className="rows">
                          {rookiesByPos[rp].map((r, i) => (
                            <li key={r.id} className="rookie-row">
                              <span className="adp">{i + 1}</span>
                              <button
                                className="pname-btn"
                                onClick={() =>
                                  setDrawer({
                                    kind: "player",
                                    id: r.id,
                                    name: r.name,
                                  })
                                }
                                title="See player news"
                              >
                                {r.name}
                              </button>
                              <span className="rookie-team">{r.team}</span>
                              <span className="pnote">{r.college || ""}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null
                  )}
                </div>
              )
            ) : drawer.kind === "sleepers" ? (
              sleepers.length === 0 ? (
                <p className="empty">
                  No sleeper picks yet — run scripts/seed-sleepers.mjs.
                </p>
              ) : (
                <div className="rookie-view">
                  {["QB", "RB", "WR", "TE", "K"].map((sp) =>
                    sleepersByPos[sp]?.length ? (
                      <section key={sp} className="rookie-group">
                        <div className="tier-head">
                          <span className="tier-num">{sp}</span>
                          <span className="tier-label">
                            {sleepersByPos[sp].length} picks
                          </span>
                          <span className="tier-rule" />
                        </div>
                        <ul className="rows">
                          {sleepersByPos[sp].map((s, i) => {
                            const pid = s.player_id;
                            return (
                              <li key={s.id} className="sleeper-row">
                                <span className="adp">{i + 1}</span>
                                {pid ? (
                                  <button
                                    className="pname-btn"
                                    onClick={() =>
                                      setDrawer({
                                        kind: "player",
                                        id: pid,
                                        name: s.name,
                                      })
                                    }
                                    title="See player news"
                                  >
                                    {s.name}
                                  </button>
                                ) : (
                                  <span className="name-static">{s.name}</span>
                                )}
                                <span className="rookie-team">
                                  {s.team || ""}
                                </span>
                                <span className="pnote">{s.source || ""}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ) : null
                  )}
                </div>
              )
            ) : drawer.kind === "injuries" ? (
              injuries.length === 0 ? (
                <p className="empty">No injuries reported right now.</p>
              ) : (
                <div className="rookie-view">
                  <p className="drawer-note">
                    {injuries.length} players with a reported status
                    {lastUpdated
                      ? ` · as of ${new Date(lastUpdated).toLocaleDateString()}`
                      : ""}
                  </p>
                  <ul className="rows">
                    {injuries.map((p) => (
                      <li key={p.id} className="injury-row">
                        <span className="adp">{rankById[p.id]}</span>
                        <button
                          className="pname-btn"
                          onClick={() =>
                            setDrawer({ kind: "player", id: p.id, name: p.name })
                          }
                          title="See player news"
                        >
                          {p.name}
                        </button>
                        <span className="rookie-team">
                          {p.pos} · {p.team}
                        </span>
                        <span className="pnote">{p.injury}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : drawer.kind === "news" ? (
              news.length === 0 ? (
                <p className="empty">No news yet — run the daily refresh.</p>
              ) : (
                <div className="news-view">
                  {newsGroups.priority.length > 0 && (
                    <section className="news-group">
                      <div className="tier-head">
                        <span className="tier-num">⚡ Priority</span>
                        <span className="tier-label">injury &amp; transaction</span>
                        <span className="tier-rule" />
                      </div>
                      <ul className="news-list">
                        {newsGroups.priority.map(newsItem)}
                      </ul>
                    </section>
                  )}
                  {Object.entries(newsGroups.byMonth).map(([month, items]) => (
                    <section key={month} className="news-group">
                      <div className="tier-head">
                        <span className="tier-num">{month}</span>
                        <span className="tier-label">{items.length} articles</span>
                        <span className="tier-rule" />
                      </div>
                      <ul className="news-list">{items.map(newsItem)}</ul>
                    </section>
                  ))}
                </div>
              )
            ) : drawer.kind === "teams" ? (
              teamList.length === 0 ? (
                <p className="empty">No teams on the board yet.</p>
              ) : (
                <div className="team-grid">
                  {teamList.map((t) => {
                    const coach = coaches[t];
                    return (
                      <button
                        key={t}
                        className="team-tile"
                        onClick={() => setDrawer({ kind: "team", team: t })}
                      >
                        <span className="team-tile-abbr">
                          {t}
                          {coach?.is_new && <em className="tag-new">NEW HC</em>}
                        </span>
                        {coach && (
                          <span className="team-tile-coach">
                            {coach.head_coach}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              <>
                {drawer.kind === "team" && (
                  <>
                    <button
                      className="drawer-back"
                      onClick={() => setDrawer({ kind: "teams" })}
                    >
                      ← All teams
                    </button>
                    {coaches[drawer.team] && (
                      <div className="coach-info">
                        <div className="staff-row">
                          <span className="coach-label">Head Coach</span>
                          <span className="coach-name">
                            {coaches[drawer.team].head_coach}
                            {coaches[drawer.team].is_new && (
                              <em className="tag-new">NEW FOR 2026</em>
                            )}
                            {coaches[drawer.team].hired && (
                              <span className="coach-since">
                                since {coaches[drawer.team].hired}
                              </span>
                            )}
                          </span>
                        </div>
                        {coaches[drawer.team].off_coordinator && (
                          <div className="staff-row">
                            <span className="coach-label">Offensive Coord.</span>
                            <span className="coach-name coach-name--sm">
                              {coaches[drawer.team].off_coordinator}
                            </span>
                          </div>
                        )}
                        {coaches[drawer.team].def_coordinator && (
                          <div className="staff-row">
                            <span className="coach-label">Defensive Coord.</span>
                            <span className="coach-name coach-name--sm">
                              {coaches[drawer.team].def_coordinator}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {depth.length > 0 && (
                      <div className="depth-chart">
                        <div className="tier-head">
                          <span className="tier-num">Depth Chart</span>
                          <span className="tier-rule" />
                        </div>
                        {["QB", "RB", "WR", "TE", "K"].map((dp) =>
                          depthByPos[dp]?.length ? (
                            <div key={dp} className="depth-row">
                              <span className="depth-pos">{dp}</span>
                              <span className="depth-players">
                                {depthByPos[dp].map((d, i) => (
                                  <span key={d.id}>
                                    {i > 0 ? " · " : ""}
                                    {d.name}
                                  </span>
                                ))}
                              </span>
                            </div>
                          ) : null
                        )}
                      </div>
                    )}
                  </>
                )}
                <a
                  className="news-search"
                  href={`https://news.google.com/search?q=${encodeURIComponent(
                    (drawer.kind === "team" ? drawer.team : drawer.name) + " NFL"
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  🔍 Search latest news for{" "}
                  {drawer.kind === "team" ? drawer.team : drawer.name} →
                </a>
                {news.length === 0 && (
                  <p className="empty">
                    No articles ingested for{" "}
                    {drawer.kind === "team" ? drawer.team : drawer.name} yet — use
                    the search link above for current reporting.
                  </p>
                )}
                <ul className="news-list">{sortedNews.map(newsItem)}</ul>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const css = `
.board {
  --ink:#1c1a17; --paper:#f2ede3; --paper-line:#e2d9c8;
  --accent:#2f5d50; --amber:#b5691f; --muted:#6d665b; --mine:#2f5d50;
  max-width:960px; margin:0 auto; padding:28px 20px 64px;
  background:var(--paper); color:var(--ink);
  font-family:ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;
}
.board *{box-sizing:border-box;}
.masthead{display:flex;justify-content:space-between;align-items:flex-end;
  border-bottom:2px solid var(--ink);padding-bottom:12px;margin-bottom:20px;flex-wrap:wrap;gap:10px;}
.eyebrow{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);font-weight:700;}
.masthead h1{margin:2px 0 0;font-size:40px;line-height:.95;letter-spacing:-.02em;
  font-family:"Georgia","Times New Roman",serif;font-weight:800;}
.masthead-right{text-align:right;display:flex;flex-direction:column;gap:3px;}
.tally{font-size:12px;color:var(--accent);font-weight:700;}
.tally--kyle{color:#3a6ea5;}
.tally--fav{color:var(--amber);}
.league-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:12px;border-bottom:1px dashed var(--paper-line);}
.league-label{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700;}
.league-tab{border:1px solid var(--paper-line);background:transparent;color:var(--muted);padding:5px 14px;border-radius:2px;font-size:13px;font-weight:700;cursor:pointer;transition:all .12s;}
.league-tab:hover{border-color:var(--accent);color:var(--accent);}
.league-tab--on{background:var(--accent);border-color:var(--accent);color:var(--paper);}
.league-rename{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;padding:4px;}
.league-rename:hover{color:var(--accent);}
.err{font-size:11px;color:var(--amber);}
.asof{font-size:11px;color:var(--muted);}
.controls{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:22px;flex-wrap:wrap;}
.pos-filter{display:flex;gap:6px;flex-wrap:wrap;}
.chip{border:1px solid var(--paper-line);background:transparent;color:var(--muted);
  padding:5px 12px;border-radius:2px;font-size:12px;font-weight:700;letter-spacing:.04em;cursor:pointer;transition:all .12s;}
.chip:hover{border-color:var(--accent);color:var(--accent);}
.chip--on{background:var(--ink);color:var(--paper);border-color:var(--ink);}
.chip--fav.chip--on{background:var(--amber);border-color:var(--amber);color:var(--paper);}
.chip--fav:hover{border-color:var(--amber);color:var(--amber);}
.chip--fav.chip--on:hover{color:var(--paper);}
.chip--sleeper.chip--on{background:#6b4c9a;border-color:#6b4c9a;color:var(--paper);}
.chip--sleeper:hover{border-color:#6b4c9a;color:#6b4c9a;}
.chip--sleeper.chip--on:hover{color:var(--paper);}
.chip--mine.chip--on{background:var(--accent);border-color:var(--accent);color:var(--paper);}
.chip--mine:hover{border-color:var(--accent);color:var(--accent);}
.chip--mine.chip--on:hover{color:var(--paper);}
.chip--kyle.chip--on{background:#3a6ea5;border-color:#3a6ea5;color:var(--paper);}
.chip--kyle:hover{border-color:#3a6ea5;color:#3a6ea5;}
.chip--kyle.chip--on:hover{color:var(--paper);}
.search{border:none;border-bottom:1px solid var(--ink);background:transparent;padding:6px 2px;font-size:14px;color:var(--ink);min-width:200px;outline:none;}
.search::placeholder{color:var(--muted);}
.search:focus{border-bottom-color:var(--accent);}
.controls-right{display:flex;align-items:center;gap:10px;}
.teams-btn{border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:6px 14px;border-radius:2px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:opacity .12s;}
.teams-btn:hover{opacity:.85;}
.tier{margin-bottom:26px;}
.tier-head{display:flex;align-items:baseline;gap:12px;margin-bottom:8px;}
.tier-num{font-family:"Georgia",serif;font-weight:800;font-size:15px;color:var(--accent);}
.tier-label{font-size:12px;color:var(--muted);letter-spacing:.04em;text-transform:uppercase;}
.tier-rule{flex:1;height:1px;background:var(--paper-line);}
.rows{list-style:none;margin:0;padding:0;}
.row{display:grid;grid-template-columns:86px 34px 40px minmax(140px,1.2fr) 52px 58px minmax(0,2fr);
  align-items:center;gap:10px;padding:7px 6px;border-bottom:1px solid var(--paper-line);font-size:14px;}
.row:hover{background:rgba(47,93,80,.05);}
.row--taken{opacity:.45;}
.row--taken .pname{text-decoration:line-through;}
.row--mine{background:rgba(47,93,80,.10);}
.row--kyle{background:rgba(58,110,165,.10);}
.pick{display:flex;gap:3px;}
.pk{width:24px;height:24px;border:1px solid var(--paper-line);border-radius:2px;background:transparent;cursor:pointer;font-size:11px;font-weight:800;color:var(--muted);line-height:1;padding:0;transition:all .1s;}
.pk:hover{border-color:var(--ink);}
.pk--m.on{background:var(--accent);border-color:var(--accent);color:var(--paper);}
.pk--k.on{background:#3a6ea5;border-color:#3a6ea5;color:var(--paper);}
.pk--t.on{background:var(--muted);border-color:var(--muted);color:var(--paper);}
.adp{font-family:"Georgia",serif;font-weight:700;color:var(--muted);text-align:right;font-size:13px;}
.postag{font-size:10px;font-weight:800;letter-spacing:.05em;text-align:center;}
.postag--QB{color:#7a3b8f;}.postag--RB{color:var(--accent);}.postag--WR{color:var(--amber);}
.postag--TE{color:#2b5b86;}.postag--K{color:var(--muted);}.postag--DEF{color:var(--ink);}
.pname{font-weight:700;display:flex;align-items:center;gap:8px;}
.pname-btn{font:inherit;font-weight:700;color:var(--ink);background:none;border:none;padding:0;cursor:pointer;text-align:left;}
.pname-btn:hover{color:var(--accent);text-decoration:underline;text-decoration-color:var(--paper-line);}
.fav{background:none;border:none;padding:0;cursor:pointer;font-size:15px;line-height:1;color:var(--muted);transition:color .12s;}
.fav:hover{color:var(--amber);}
.fav--on{color:var(--amber);}
.badge{font-style:normal;font-size:9px;font-weight:800;letter-spacing:.08em;padding:1px 5px;border-radius:2px;}
.badge--mine{background:var(--mine);color:var(--paper);}
.badge--kyle{background:#3a6ea5;color:var(--paper);}
.badge--taken{background:var(--paper-line);color:var(--muted);}
.badge--rookie{background:#3a6ea5;color:var(--paper);}
.badge--sleeper{background:#6b4c9a;color:var(--paper);}
.pteam{font-size:12px;color:var(--muted);font-weight:600;background:none;border:none;cursor:pointer;text-align:left;padding:0;text-decoration:underline;text-decoration-color:var(--paper-line);}
.pteam:hover{color:var(--accent);}
.pbye{font-size:11px;color:var(--muted);}
.pnote{font-size:12px;color:var(--muted);line-height:1.35;}
.empty{color:var(--muted);font-size:14px;padding:24px 0;}
.drawer{position:fixed;inset:0;background:rgba(28,26,23,.35);display:flex;justify-content:flex-end;z-index:50;}
.drawer-panel{width:min(420px,90vw);height:100%;background:var(--paper);padding:22px;overflow-y:auto;box-shadow:-8px 0 30px rgba(0,0,0,.15);}
.drawer-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--paper-line);padding-bottom:10px;margin-bottom:14px;}
.drawer-head h2{font-family:"Georgia",serif;font-size:22px;margin:0;}
.drawer-close{background:none;border:none;font-size:16px;cursor:pointer;color:var(--muted);}
.drawer-back{background:none;border:none;color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;padding:0 0 12px;letter-spacing:.03em;}
.drawer-back:hover{text-decoration:underline;}
.team-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;}
.team-tile{display:flex;flex-direction:column;align-items:flex-start;gap:3px;border:1px solid var(--paper-line);background:transparent;color:var(--ink);padding:10px;border-radius:2px;cursor:pointer;transition:all .12s;text-align:left;}
.team-tile:hover{border-color:var(--accent);background:rgba(47,93,80,.05);}
.team-tile-abbr{display:flex;align-items:center;gap:6px;font-family:"Georgia",serif;font-weight:800;font-size:14px;letter-spacing:.04em;}
.team-tile-coach{font-size:11px;color:var(--muted);font-weight:600;line-height:1.2;}
.team-tile:hover .team-tile-coach{color:var(--accent);}
.tag-new{font-style:normal;font-size:8px;font-weight:800;letter-spacing:.08em;padding:1px 4px;border-radius:2px;background:var(--amber);color:var(--paper);white-space:nowrap;}
.coach-info{display:flex;flex-direction:column;gap:10px;padding:12px;margin-bottom:14px;background:rgba(47,93,80,.06);border-left:2px solid var(--accent);border-radius:2px;}
.staff-row{display:flex;flex-direction:column;gap:1px;}
.coach-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700;}
.coach-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:"Georgia",serif;font-weight:800;font-size:16px;}
.coach-name--sm{font-size:14px;font-weight:700;}
.coach-since{font-size:11px;color:var(--muted);font-weight:400;font-family:ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif;}
.depth-chart{margin-bottom:16px;}
.depth-row{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--paper-line);}
.depth-pos{font-family:"Georgia",serif;font-weight:800;font-size:13px;color:var(--accent);}
.depth-players{font-size:13px;line-height:1.5;}
.depth-players span:first-child{font-weight:700;}
.rookie-view{display:flex;flex-direction:column;gap:18px;}
.rookie-group .tier-head{margin-bottom:6px;}
.rookie-row{display:grid;grid-template-columns:34px minmax(110px,1.4fr) 44px minmax(0,1.4fr);align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid var(--paper-line);font-size:14px;}
.rookie-row:hover{background:rgba(47,93,80,.05);}
.rookie-team{font-size:12px;color:var(--muted);font-weight:600;}
.sleeper-row{display:grid;grid-template-columns:34px minmax(120px,1.6fr) 44px minmax(0,1fr);align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid var(--paper-line);font-size:14px;}
.sleeper-row:hover{background:rgba(47,93,80,.05);}
.name-static{font-weight:700;color:var(--ink);}
.injury-row{display:grid;grid-template-columns:34px minmax(110px,1.2fr) 90px minmax(0,1.6fr);align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid var(--paper-line);font-size:14px;}
.injury-row:hover{background:rgba(47,93,80,.05);}
.injury-row .pnote{color:var(--amber);}
.drawer-note{font-size:12px;color:var(--muted);margin:0 0 12px;}
.news-search{display:inline-block;margin-bottom:14px;font-size:13px;font-weight:700;color:var(--accent);text-decoration:none;border:1px solid var(--paper-line);padding:6px 12px;border-radius:2px;}
.news-search:hover{border-color:var(--accent);background:rgba(47,93,80,.05);}
.news-view{display:flex;flex-direction:column;gap:18px;}
.news-group .tier-head{margin-bottom:6px;}
.news-pri{font-style:normal;color:var(--amber);margin-right:5px;}
.news-list{list-style:none;margin:0;padding:0;}
.news-list li{padding:12px 0;border-bottom:1px solid var(--paper-line);}
.news-list a{color:var(--ink);font-weight:600;text-decoration:none;font-size:14px;line-height:1.4;}
.news-list a:hover{color:var(--accent);}
.news-sum{font-size:13px;color:var(--muted);margin:6px 0 4px;line-height:1.4;}
.news-src{font-size:11px;color:var(--muted);letter-spacing:.04em;}
@media (max-width:640px){
  .masthead h1{font-size:30px;}
  .row{grid-template-columns:82px 28px 34px 1fr auto;row-gap:2px;}
  .pbye,.pnote{display:none;}
}
`;
