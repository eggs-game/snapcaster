import React, { useEffect, useState } from "react";
import { BarChart3, Clock3, Trophy, UserRound } from "lucide-react";
import SiteFooter from "./SiteFooter.jsx";
import { blockPlayer, getAccountSession, getProfileMatchups, getPublicProfile, sendFriendRequest } from "./account.js";

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function duration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (!total) return "—";
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function turnDuration(milliseconds) {
  const seconds = Math.round((Number(milliseconds) || 0) / 1000);
  if (!seconds) return "—";
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export default function ProfilePage() {
  const profileId = new URLSearchParams(window.location.search).get("id");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState(null);
  const [socialStatus, setSocialStatus] = useState("");
  const [matchups, setMatchups] = useState({ opponents: [], commanders: [] });

  useEffect(() => {
    getAccountSession().then(setViewer).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getPublicProfile(profileId), getProfileMatchups(profileId)])
      .then(([profile, profileMatchups]) => {
        if (!active) return;
        if (!profile) setError("This profile could not be found.");
        else {
          setData(profile);
          setMatchups(profileMatchups);
        }
      })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load this profile."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [profileId]);

  return (
    <main className="profile-page">
      <header className="site-header">
        <a className="site-brand" href="/">Snapcast</a>
        <a className="site-header-link" href="/games/lobbies">Find a game</a>
      </header>
      <section className="profile-page-shell">
        {loading ? (
          <p className="public-games-state">Loading profile…</p>
        ) : error ? (
          <div className="games-empty"><h1>Profile unavailable</h1><p>{error}</p></div>
        ) : (
          <>
            <header className="profile-hero">
              <div className="profile-hero-avatar">
                {data.profile.avatar_url ? <img src={data.profile.avatar_url} alt="" /> : <UserRound size={38} />}
              </div>
              <div>
                <p>Snapcast player</p>
                <h1>{data.profile.display_name}</h1>
                <span>Playing since {new Date(data.profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
              </div>
              {viewer?.user?.id && viewer.user.id !== data.profile.id && (
                <div className="profile-social-actions">
                  {data.relationship === "friend" ? (
                    <button type="button" disabled>Friends</button>
                  ) : (
                    <button type="button" onClick={async () => {
                      try {
                        await sendFriendRequest(data.profile.id);
                        setSocialStatus("Friend request sent");
                      } catch (requestError) {
                        setSocialStatus(String(requestError?.message || "Could not send friend request."));
                      }
                    }}>Add friend</button>
                  )}
                  <button className="danger" type="button" onClick={async () => {
                    if (!window.confirm(`Block ${data.profile.display_name}? This removes friendships, invitations, and future contact.`)) return;
                    try {
                      await blockPlayer(data.profile.id);
                      setSocialStatus("Player blocked");
                    } catch (blockError) {
                      setSocialStatus(String(blockError?.message || "Could not block this player."));
                    }
                  }}>Block</button>
                  {socialStatus && <span role="status">{socialStatus}</span>}
                </div>
              )}
            </header>

            <section className="profile-stat-grid" aria-label="Overall record">
              <StatCard icon={<BarChart3 size={18} />} label="Games" value={data.overall.games} />
              <StatCard icon={<Trophy size={18} />} label="Record" value={`${data.overall.wins}–${data.overall.losses}–${data.overall.draws}`} />
              <StatCard icon={<Trophy size={18} />} label="Win rate" value={percent(data.overall.win_rate)} />
              <StatCard icon={<Clock3 size={18} />} label="Average game" value={duration(data.overall.average_game_seconds)} />
            </section>

            <div className="profile-content-grid">
              <section className="profile-panel">
                <header><h2>Commander record</h2></header>
                {data.commanders.length ? (
                  <div className="profile-record-list">
                    {data.commanders.map((commander) => (
                      <div key={commander.commander_name}>
                        <strong>{commander.commander_name}</strong>
                        <span>
                          {commander.wins}–{commander.losses}–{commander.draws} · {commander.games} games
                          {Number(commander.average_turn_ms) > 0 ? ` · ${turnDuration(commander.average_turn_ms)} average turn` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <p className="profile-empty">No completed Commander games yet.</p>}
              </section>

              <section className="profile-panel">
                <header><h2>Turn timing</h2></header>
                <dl className="profile-timing-list">
                  <div><dt>Average turn</dt><dd>{turnDuration(data.turns.average_turn_ms)}</dd></div>
                  <div><dt>Median turn</dt><dd>{turnDuration(data.turns.median_turn_ms)}</dd></div>
                  <div><dt>Longest turn</dt><dd>{turnDuration(data.turns.longest_turn_ms)}</dd></div>
                  <div><dt>Turns recorded</dt><dd>{data.turns.turns}</dd></div>
                </dl>
              </section>
            </div>

            <section className="profile-panel profile-recent-games">
              <header><h2>Recent games</h2></header>
              {!data.recent_games_visible ? (
                <p className="profile-empty">This player keeps recent games private.</p>
              ) : data.recent_games.length ? (
                <div className="profile-game-list">
                  {data.recent_games.map((game) => (
                    <article key={game.session_id}>
                      <span className={`profile-result ${game.result}`}>{game.result}</span>
                      <div>
                        <strong>{game.commander || "Commander not recorded"}{game.partner ? ` + ${game.partner}` : ""}</strong>
                        <span>{new Date(game.started_at).toLocaleDateString()} · {duration((new Date(game.ended_at) - new Date(game.started_at)) / 1000)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <p className="profile-empty">No recent games to show.</p>}
            </section>

            {(matchups.opponents.length > 0 || matchups.commanders.length > 0) && (
              <div className="profile-content-grid">
                <section className="profile-panel">
                  <header><h2>Frequent opponents</h2></header>
                  <div className="profile-record-list">
                    {matchups.opponents.map((opponent) => (
                      <div key={opponent.id}>
                        <a href={`/profile?id=${encodeURIComponent(opponent.id)}`}>{opponent.display_name}</a>
                        <span>{opponent.wins}–{opponent.losses} · {opponent.games} games</span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="profile-panel">
                  <header><h2>Opposing commanders</h2></header>
                  <div className="profile-record-list">
                    {matchups.commanders.map((commander) => (
                      <div key={commander.commander_name}>
                        <strong>{commander.commander_name}</strong>
                        <span>{commander.wins}–{commander.losses} · {commander.games} games</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <article className="profile-stat-card">
      <span>{icon}</span>
      <div><strong>{value}</strong><small>{label}</small></div>
    </article>
  );
}
