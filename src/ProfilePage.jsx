import React, { useEffect, useState } from "react";
import { BarChart3, Check, Clock3, Library, Trophy, UserPlus, UserRound } from "lucide-react";
import AccountProfile from "./AccountProfile.jsx";
import DiscordMark from "./DiscordMark.jsx";
import SiteFooter from "./SiteFooter.jsx";
import SiteHeader from "./SiteHeader.jsx";
import { useConfirmDialog } from "./ConfirmDialog.jsx";
import {
  blockPlayer,
  getAccountSession,
  getProfileMatchups,
  getPublicProfile,
  sendFriendRequest,
  signInWithDiscord,
  signOutAccount,
  updateAccountSettings,
} from "./account.js";

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

function deckArtUrl(deck) {
  const params = new URLSearchParams({ format: "image", version: "art_crop" });
  if (deck?.commander_scryfall_id) {
    return `https://api.scryfall.com/cards/${encodeURIComponent(deck.commander_scryfall_id)}?${params}`;
  }
  params.set("exact", deck?.commander_name || "Magic card");
  return `https://api.scryfall.com/cards/named?${params}`;
}

export default function ProfilePage() {
  const profileId = new URLSearchParams(window.location.search).get("id");
  return profileId ? <PublicProfilePage profileId={profileId} /> : <MyProfilePage />;
}

function MyProfilePage() {
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getAccountSession()
      .then((nextAccount) => {
        if (active) setAccount(nextAccount);
      })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load your account."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const saveProfile = async (values) => {
    const nextAccount = await updateAccountSettings(account, values);
    setAccount(nextAccount);
    localStorage.setItem("sc-name", nextAccount.profile.display_name);
    localStorage.setItem("theme-preference", nextAccount.preferences.theme);
    const preference = nextAccount.preferences.theme;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = preference === "system"
      ? (systemDark ? "dark" : "light")
      : preference;
    document.documentElement.dataset.themePreference = preference;
  };

  return (
    <main className="profile-page account-profile-page">
      <SiteHeader
        account={account}
        accountReady={!loading}
        accountError={error}
        onCreate={() => { window.location.href = "/?action=create"; }}
        onJoin={() => { window.location.href = "/?action=join"; }}
        onSignIn={() => signInWithDiscord({ redirectPath: "/profile" })}
        onSignOut={async () => {
          await signOutAccount();
          window.location.href = "/";
        }}
      />
      <section className="account-profile-page-shell profile-account-page-shell">
        {loading ? (
          <p className="public-games-state">Loading your profile…</p>
        ) : error ? (
          <div className="games-empty"><h1>Profile unavailable</h1><p>{error}</p></div>
        ) : account ? (
          <AccountProfile
            account={account}
            page
            view="profile"
            onSave={saveProfile}
          />
        ) : (
          <div className="games-empty account-profile-sign-in">
            <UserRound size={30} />
            <h1>Sign in to open your profile</h1>
            <p>Your friends, saved commanders, and match history live here.</p>
            <button type="button" onClick={() => signInWithDiscord({ redirectPath: "/profile" })}>Sign in with Discord</button>
          </div>
        )}
      </section>
      <SiteFooter />
    </main>
  );
}

function PublicProfilePage({ profileId }) {
  const confirmAction = useConfirmDialog();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewer, setViewer] = useState(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [socialStatus, setSocialStatus] = useState("");
  const [socialWorking, setSocialWorking] = useState(false);
  const [matchups, setMatchups] = useState({ opponents: [], commanders: [] });

  useEffect(() => {
    let active = true;
    getAccountSession()
      .then((nextViewer) => { if (active) setViewer(nextViewer); })
      .catch(() => {})
      .finally(() => { if (active) setViewerReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getPublicProfile(profileId)
      .then(async (profile) => {
        if (!active) return;
        if (!profile) setError("This profile could not be found.");
        else {
          setData(profile);
          const statsVisible = profile.stats_visible ?? ["self", "friend"].includes(profile.relationship);
          const profileMatchups = statsVisible
            ? await getProfileMatchups(profileId)
            : { opponents: [], commanders: [] };
          if (active) setMatchups(profileMatchups);
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

  const requestFriendship = async () => {
    setSocialStatus("");
    setSocialWorking(true);
    try {
      await sendFriendRequest(data.profile.id);
      setData((current) => ({ ...current, relationship: "outgoing_pending" }));
      setSocialStatus("Friend request sent — they’ll see it in Notifications.");
    } catch (requestError) {
      setSocialStatus(String(requestError?.message || "Could not send friend request."));
    } finally {
      setSocialWorking(false);
    }
  };

  const statsVisible = data && (data.stats_visible ?? ["self", "friend"].includes(data.relationship));

  return (
    <main className="profile-page">
      <SiteHeader
        account={viewer}
        accountReady={viewerReady}
        onCreate={() => { window.location.href = "/?action=create"; }}
        onJoin={() => { window.location.href = "/?action=join"; }}
        onSignIn={() => signInWithDiscord({ redirectPath: window.location.pathname + window.location.search })}
        onSignOut={async () => {
          await signOutAccount();
          window.location.href = "/";
        }}
      />
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
                {data.profile.discord_username && (
                  <span className="account-discord-identity">
                    <DiscordMark />
                    {data.profile.discord_username}
                  </span>
                )}
                <span>Playing since {new Date(data.profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
              </div>
              {viewer?.user?.id !== data.profile.id && (
                <div className="profile-social-actions">
                  {!viewer?.user?.id ? (
                    <button className="primary" type="button" onClick={() => signInWithDiscord({ redirectPath: window.location.pathname + window.location.search })}>
                      <UserPlus size={16} /> Sign in to add friend
                    </button>
                  ) : data.relationship === "friend" ? (
                    <button type="button" disabled><Check size={16} /> Friends</button>
                  ) : data.relationship === "outgoing_pending" ? (
                    <button type="button" disabled><Check size={16} /> Request sent</button>
                  ) : data.relationship === "incoming_pending" ? (
                    <a className="primary" href="/notifications"><UserPlus size={16} /> Respond to request</a>
                  ) : data.relationship === "blocked" ? (
                    <button type="button" disabled>Player blocked</button>
                  ) : (
                    <button className="primary" type="button" disabled={socialWorking} onClick={requestFriendship}>
                      <UserPlus size={16} /> {socialWorking ? "Sending…" : "Add friend"}
                    </button>
                  )}
                  {viewer?.user?.id && data.relationship !== "blocked" && <button className="danger" type="button" onClick={async () => {
                    if (!(await confirmAction({
                      title: `Block ${data.profile.display_name}?`,
                      description: "This removes friendships, invitations, and future contact.",
                      confirmLabel: "Block player",
                      tone: "danger",
                    }))) return;
                    try {
                      await blockPlayer(data.profile.id);
                      setData((current) => ({ ...current, relationship: "blocked", stats_visible: false }));
                      setMatchups({ opponents: [], commanders: [] });
                      setSocialStatus("Player blocked");
                    } catch (blockError) {
                      setSocialStatus(String(blockError?.message || "Could not block this player."));
                    }
                  }}>Block</button>}
                  {socialStatus && <span role="status">{socialStatus}</span>}
                </div>
              )}
            </header>

            {statsVisible && <section className="profile-stat-grid" aria-label="Overall record">
              <StatCard icon={<BarChart3 size={18} />} label="Games" value={data.overall.games} />
              <StatCard icon={<Trophy size={18} />} label="Record" value={`${data.overall.wins}–${data.overall.losses}–${data.overall.draws}`} />
              <StatCard icon={<Trophy size={18} />} label="Win rate" value={percent(data.overall.win_rate)} />
              <StatCard icon={<Clock3 size={18} />} label="Average game" value={duration(data.overall.average_game_seconds)} />
            </section>}

            <section className="profile-panel profile-public-decks" aria-labelledby="public-decks-title">
              <header>
                <div><Library size={18} /><h2 id="public-decks-title">Decks</h2></div>
                <span>{data.decks?.length || 0} saved</span>
              </header>
              {data.decks?.length ? (
                <div className="profile-public-deck-grid">
                  {data.decks.map((deck) => (
                    <a href={`/profile/decks/${encodeURIComponent(deck.id)}`} key={deck.id}>
                      <img src={deckArtUrl(deck)} alt="" loading="lazy" />
                      <span>
                        <strong>{deck.label}</strong>
                        <small>{deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ""}</small>
                        {Number(deck.card_count) > 0 && <em>{deck.card_count} cards</em>}
                      </span>
                    </a>
                  ))}
                </div>
              ) : <p className="profile-empty">No saved decks to show yet.</p>}
            </section>

            {statsVisible && <>
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
            </>}
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
