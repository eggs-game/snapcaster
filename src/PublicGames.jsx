import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Search } from "lucide-react";
import SiteFooter from "./SiteFooter.jsx";
import { listPublicGameRooms } from "./gameRooms.js";

export function scryfallCardImage(scryfallId) {
  const id = String(scryfallId || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) return "";
  return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
}

function commanderArtwork(cards) {
  const seen = new Set();
  return (cards || []).flatMap((card) => [
    { name: card.name, scryfallId: card.scryfall_id },
    { name: card.partner_name, scryfallId: card.partner_scryfall_id },
  ]).filter((card) => {
    const image = scryfallCardImage(card.scryfallId);
    if (!card.name || !image || seen.has(card.scryfallId)) return false;
    seen.add(card.scryfallId);
    card.image = image;
    return true;
  }).slice(0, 5);
}

function commanderDisplayName(value) {
  const label = String(value || "");
  const separator = label.indexOf(" — ");
  return separator >= 0 ? label.slice(separator + 3) : label;
}

function FilterDropdown({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const selected = options.find((option) => option.value === value) || options[0];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (event.type === "pointerdown" && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  const focusOption = (index) => {
    const nextIndex = (index + options.length) % options.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const openMenu = () => {
    setOpen(true);
    window.requestAnimationFrame(() => {
      const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
      focusOption(selectedIndex);
    });
  };

  return (
    <div className="games-filter-dropdown" ref={rootRef}>
      <button
        type="button"
        className="games-filter-trigger"
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="games-filter-menu" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              key={option.value || "all"}
              ref={(node) => { optionRefs.current[index] = node; }}
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusOption(index + 1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusOption(index - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  focusOption(0);
                } else if (event.key === "End") {
                  event.preventDefault();
                  focusOption(options.length - 1);
                } else if (event.key === "Tab") {
                  setOpen(false);
                }
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PublicGameArtwork({ cards, openSeats = 0 }) {
  const artwork = commanderArtwork(cards);
  const placeholders = Array.from({ length: Math.max(0, openSeats) });
  if (!artwork.length && !placeholders.length) return null;
  return (
    <div className="public-game-art" aria-label="Commanders at this table">
      {artwork.map((card, index) => (
        <img
          key={card.scryfallId}
          src={card.image}
          alt={`${card.name} card`}
          title={card.name}
          loading={index > 2 ? "lazy" : "eager"}
          decoding="async"
        />
      ))}
      {placeholders.map((_, index) => (
        <span
          key={`open-seat-${index}`}
          className="public-game-empty-card"
          aria-label="Open player seat"
        />
      ))}
    </div>
  );
}

export function PublicGameCards({ status = null, limit = 6, compact = false }) {
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listPublicGameRooms({ status, limit, openSeatsOnly: status !== "live" })
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
      <PublicGameArtwork cards={game.commander_cards} openSeats={openSeats} />
      <div className="public-game-card-body">
        {isLive && <span className="game-status-badge live">Live</span>}
        <h3>{game.name}</h3>
        <div className="public-game-counts">
          <span>{game.player_count}/{game.seat_limit} players</span>
          <span>{game.visitor_count} {Number(game.visitor_count) === 1 ? "viewer" : "viewers"}</span>
          <span>Bracket {game.bracket}</span>
        </div>
        {game.commanders?.length > 0 && (
          <ul className="public-game-commanders">
            {game.commanders.map((commander, index) => (
              <li key={`${commander}-${index}`}>{commanderDisplayName(commander)}</li>
            ))}
          </ul>
        )}
        <footer>
          {!isLive && (
            <a className={openSeats ? "primary" : "disabled"} href={openSeats ? playerHref : undefined}>
              {openSeats ? "Play" : "Table full"}
            </a>
          )}
          <a href={visitorHref}>Watch <ArrowRight size={15} /></a>
        </footer>
      </div>
    </article>
  );
}

export default function PublicGames() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialView = window.location.pathname.includes("/live") ? "live" : "lobby";
  const [view, setView] = useState(initialView);
  const [bracket, setBracket] = useState(params.get("bracket") || "");
  const [seatLimit, setSeatLimit] = useState(params.get("size") || "4");
  const [search, setSearch] = useState(params.get("q") || "");
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    url.pathname = view === "live" ? "/games/live" : "/games/lobbies";
    bracket ? url.searchParams.set("bracket", bracket) : url.searchParams.delete("bracket");
    seatLimit ? url.searchParams.set("size", seatLimit) : url.searchParams.delete("size");
    search ? url.searchParams.set("q", search) : url.searchParams.delete("q");
    window.history.replaceState({}, "", url);

    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      listPublicGameRooms({
        status: view,
        bracket: bracket ? Number(bracket) : null,
        openSeatsOnly: view === "lobby",
        seatLimit: seatLimit ? Number(seatLimit) : null,
        search,
      })
        .then(setGames)
        .catch((loadError) => setError(String(loadError?.message || "Could not load public games.")))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [view, bracket, seatLimit, search]);

  return (
    <main className="games-directory">
      <header className="site-header">
        <a className="site-brand" href="/">Snapcast</a>
        <nav className="site-header-actions" aria-label="Game actions">
          <a className="site-header-link primary" href="/?action=create">Create game</a>
          <a className="site-header-link" href="/?action=join">Join game</a>
        </nav>
      </header>
      <section className="games-directory-shell">
        <div className="games-directory-heading">
          <h1>Find a commander table</h1>
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
          <FilterDropdown
            label="Bracket"
            value={bracket}
            onChange={setBracket}
            options={[
              { value: "", label: "All brackets" },
              ...[1, 2, 3, 4, 5].map((option) => ({ value: String(option), label: `Bracket ${option}` })),
            ]}
          />
          <FilterDropdown
            label="Player count"
            value={seatLimit}
            onChange={setSeatLimit}
            options={[2, 3, 4, 5, 6].map((option) => ({ value: String(option), label: `${option} players` }))}
          />
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
              setSeatLimit("4");
              setSearch("");
            }}>Reset filters</button>
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}
