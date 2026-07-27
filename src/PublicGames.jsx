import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, Eye, Search, Users } from "lucide-react";
import SiteFooter from "./SiteFooter.jsx";
import { listPublicGameRooms } from "./gameRooms.js";

export function PublicGameCards({ status = null, limit = 6, compact = false }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listPublicGameRooms({ status, limit })
      .then((nextGames) => {
        if (active) setGames(nextGames);
      })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load public games."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [status, limit]);

  if (loading) return <p className="public-games-state">Loading public games…</p>;
  if (error) return <p className="public-games-state error">{error}</p>;
  if (!games.length) {
    return <p className="public-games-state">No public {status === "live" ? "live games" : "lobbies"} right now.</p>;
  }
  return (
    <div className={`public-game-grid${compact ? " compact" : ""}`}>
      {games.map((game) => <PublicGameCard key={game.game_id} game={game} />)}
    </div>
  );
}

function PublicGameCard({ game }) {
  const isLive = game.status === "live";
  const openSeats = Math.max(0, game.seat_limit - Number(game.player_count));
  const playerHref = `/?code=${encodeURIComponent(game.code)}`;
  const visitorHref = `/?code=${encodeURIComponent(game.code)}&visitor=1`;
  return (
    <article className="public-game-card">
      <header>
        <span className={`game-status-badge ${game.status}`}>{isLive ? "Live" : "Lobby"}</span>
        <span>Bracket {game.bracket}</span>
      </header>
      <h3>{game.name}</h3>
      <div className="public-game-counts">
        <span><Users size={15} /> {game.player_count}/{game.seat_limit} players</span>
        <span><Eye size={15} /> {game.visitor_count} watching</span>
      </div>
      {game.commanders?.length > 0 && (
        <ul className="public-game-commanders">
          {game.commanders.map((commander, index) => <li key={`${commander}-${index}`}>{commander}</li>)}
        </ul>
      )}
      {game.players?.length > 0 && (
        <div className="public-game-players">
          {game.players.map((player) => (
            <a key={player.id} href={`/profile?id=${encodeURIComponent(player.id)}`}>{player.display_name}</a>
          ))}
        </div>
      )}
      <footer>
        {!isLive && (
          <a className={openSeats ? "primary" : "disabled"} href={openSeats ? playerHref : undefined}>
            {openSeats ? "Join as player" : "Table full"}
          </a>
        )}
        <a href={visitorHref}>{isLive ? "Watch as visitor" : "Join as visitor"} <ArrowRight size={15} /></a>
      </footer>
    </article>
  );
}

export default function PublicGames() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialView = window.location.pathname.includes("/live") ? "live" : "lobby";
  const [view, setView] = useState(initialView);
  const [bracket, setBracket] = useState(params.get("bracket") || "");
  const [openOnly, setOpenOnly] = useState(params.get("open") === "1");
  const [playerCount, setPlayerCount] = useState(params.get("players") || "");
  const [seatLimit, setSeatLimit] = useState(params.get("size") || "");
  const [search, setSearch] = useState(params.get("q") || "");
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    url.pathname = view === "live" ? "/games/live" : "/games/lobbies";
    bracket ? url.searchParams.set("bracket", bracket) : url.searchParams.delete("bracket");
    openOnly && view === "lobby" ? url.searchParams.set("open", "1") : url.searchParams.delete("open");
    playerCount ? url.searchParams.set("players", playerCount) : url.searchParams.delete("players");
    seatLimit ? url.searchParams.set("size", seatLimit) : url.searchParams.delete("size");
    search ? url.searchParams.set("q", search) : url.searchParams.delete("q");
    window.history.replaceState({}, "", url);

    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      listPublicGameRooms({
        status: view,
        bracket: bracket ? Number(bracket) : null,
        openSeatsOnly: view === "lobby" && openOnly,
        playerCount: playerCount ? Number(playerCount) : null,
        seatLimit: seatLimit ? Number(seatLimit) : null,
        search,
      })
        .then(setGames)
        .catch((loadError) => setError(String(loadError?.message || "Could not load public games.")))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [view, bracket, openOnly, playerCount, seatLimit, search]);

  return (
    <main className="games-directory">
      <header className="site-header">
        <a className="site-brand" href="/">Snapcast</a>
        <a className="site-header-link" href="/">Create or join</a>
      </header>
      <section className="games-directory-shell">
        <div className="games-directory-heading">
          <p>Public games</p>
          <h1>Find a Commander table</h1>
          <span>Join an open lobby as a player, or watch a live game as a visitor.</span>
        </div>

        <div className="games-view-tabs" aria-label="Game directory view">
          <button type="button" aria-pressed={view === "lobby"} onClick={() => setView("lobby")}>Game Lobbies</button>
          <button type="button" aria-pressed={view === "live"} onClick={() => setView("live")}>Live Games</button>
        </div>

        <div className="games-filters">
          <label className="games-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search game or commander"
              aria-label="Search game or commander"
            />
          </label>
          <label className="games-bracket-filter">
            <span>Bracket</span>
            <select value={bracket} onChange={(event) => setBracket(event.target.value)}>
              <option value="">All</option>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="games-bracket-filter">
            <span>Players</span>
            <select value={playerCount} onChange={(event) => setPlayerCount(event.target.value)}>
              <option value="">Any count</option>
              {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="games-bracket-filter">
            <span>Table size</span>
            <select value={seatLimit} onChange={(event) => setSeatLimit(event.target.value)}>
              <option value="">Any size</option>
              {[2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value} seats</option>)}
            </select>
          </label>
          {view === "lobby" && (
            <label className="games-open-filter">
              <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
              Open player seats
            </label>
          )}
        </div>

        {loading ? (
          <p className="public-games-state">Loading public games…</p>
        ) : error ? (
          <p className="public-games-state error">{error}</p>
        ) : games.length ? (
          <div className="public-game-grid">
            {games.map((game) => <PublicGameCard key={game.game_id} game={game} />)}
          </div>
        ) : (
          <div className="games-empty">
            <h2>No matching {view === "live" ? "live games" : "lobbies"}</h2>
            <p>Try clearing a filter, or create a public game and be the first table listed.</p>
            <button type="button" onClick={() => {
              setBracket("");
              setOpenOnly(false);
              setPlayerCount("");
              setSeatLimit("");
              setSearch("");
            }}>Reset filters</button>
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
