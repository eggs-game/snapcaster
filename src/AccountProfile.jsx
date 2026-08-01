import React, { useEffect, useState } from "react";
import { Download, Plus, Trash2, UserRound, X } from "lucide-react";
import {
  accountAvatarUrl,
  accountDisplayName,
  cancelAccountDeletion,
  createSavedCommanderDeck,
  deleteSavedCommanderDeck,
  exportMyAccountData,
  finalizeAccountDeletion,
  getAccountDeletionStatus,
  getSocialDashboard,
  getMyModerationCases,
  getMyReceivedReviews,
  getMySentReviews,
  getMyGameHistory,
  listSavedCommanderDecks,
  requestAccountDeletion,
  removeFriend,
  reportPlayerReview,
  searchPublicProfiles,
  sendFriendRequest,
  setMyGameVisibility,
  submitModerationAppeal,
  updateMyPlayerReview,
} from "./account.js";
import { isCommanderCard, isValidCommanderPartner } from "./cardSearch.js";
import { roomCapability, submitGameCorrection } from "./gameRooms.js";

function savedDeviceLabel(value) {
  if (!value) return "No device saved";
  return `Saved device · ${value.slice(0, 8)}…`;
}

function timingLabel(milliseconds) {
  const seconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000));
  if (!seconds) return "0s";
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function scryfallCardImage(scryfallId, cardName) {
  const params = new URLSearchParams({ format: "image", version: "normal" });
  if (scryfallId) return `https://api.scryfall.com/cards/${encodeURIComponent(scryfallId)}?${params}`;
  params.set("exact", cardName || "");
  return `https://api.scryfall.com/cards/named?${params}`;
}

function useNamedCardFallback(event, cardName) {
  const image = event.currentTarget;
  if (image.dataset.namedFallback) {
    image.hidden = true;
    return;
  }
  image.dataset.namedFallback = "true";
  image.src = scryfallCardImage(null, cardName);
}

export default function AccountProfile({
  account,
  onClose,
  onSave,
  onDecksChange,
  page = false,
  view = "profile",
}) {
  const [displayName, setDisplayName] = useState(() => accountDisplayName(account));
  const [theme, setTheme] = useState(account?.preferences?.theme || "dark");
  const [preferredCameraId, setPreferredCameraId] = useState(account?.preferences?.preferred_camera_id || "");
  const [preferredMicrophoneId, setPreferredMicrophoneId] = useState(account?.preferences?.preferred_microphone_id || "");
  const [appearOffline, setAppearOffline] = useState(Boolean(account?.preferences?.appear_offline));
  const [showRecentGames, setShowRecentGames] = useState(account?.preferences?.show_recent_games !== false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeProfileTab, setActiveProfileTab] = useState("decks");
  const [decks, setDecks] = useState([]);
  const [deckLabel, setDeckLabel] = useState("");
  const [commanderName, setCommanderName] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [deckSaving, setDeckSaving] = useState(false);
  const [social, setSocial] = useState({ friends: [], notifications: [] });
  const [friendQuery, setFriendQuery] = useState("");
  const [friendResults, setFriendResults] = useState([]);
  const [receivedReviews, setReceivedReviews] = useState([]);
  const [sentReviews, setSentReviews] = useState([]);
  const [moderationCases, setModerationCases] = useState([]);
  const [gameHistory, setGameHistory] = useState([]);
  const [deletionDeadline, setDeletionDeadline] = useState(() => localStorage.getItem("sc-account-deletion-deadline") || "");

  useEffect(() => {
    let active = true;
    listSavedCommanderDecks(account)
      .then((saved) => {
        if (active) setDecks(saved);
      })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load saved commanders."));
      });
    return () => { active = false; };
  }, [account]);

  const refreshSocial = () => getSocialDashboard()
    .then(setSocial)
    .catch((loadError) => setError(String(loadError?.message || "Could not load friends and notifications.")));

  useEffect(() => {
    refreshSocial();
    getMyReceivedReviews().then(setReceivedReviews).catch(() => {});
    getMySentReviews().then(setSentReviews).catch(() => {});
    getMyModerationCases().then(setModerationCases).catch(() => {});
    getMyGameHistory(20).then(setGameHistory).catch(() => {});
    getAccountDeletionStatus().then((status) => {
      if (!status?.execute_after || status.canceled_at || status.completed_at) {
        localStorage.removeItem("sc-account-deletion-deadline");
        setDeletionDeadline("");
        return;
      }
      localStorage.setItem("sc-account-deletion-deadline", status.execute_after);
      setDeletionDeadline(status.execute_after);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const query = friendQuery.trim();
    if (query.length < 2) {
      setFriendResults([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      searchPublicProfiles(query)
        .then((profiles) => {
          const existingFriendIds = new Set(social.friends.map((friend) => friend.id));
          setFriendResults(profiles.filter((profile) => (
            profile.id !== account.user.id && !existingFriendIds.has(profile.id)
          )));
        })
        .catch((searchError) => setError(String(searchError?.message || "Could not search profiles.")));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [account.user.id, friendQuery, social.friends]);

  useEffect(() => {
    if (page || !onClose) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, page]);

  const submit = async (event) => {
    event.preventDefault();
    if (view !== "settings") return;
    setError("");
    setSaving(true);
    try {
      await onSave({
        displayName,
        preferredCameraId,
        preferredMicrophoneId,
        theme,
        appearOffline,
        showRecentGames,
      });
      onClose?.();
    } catch (saveError) {
      setError(String(saveError?.message || "Could not save your profile."));
    } finally {
      setSaving(false);
    }
  };

  const fetchCard = async (name) => {
    const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.trim())}`);
    if (!response.ok) throw new Error(`Could not find “${name.trim()}”.`);
    return response.json();
  };

  const addDeck = async () => {
    if (!deckLabel.trim() || !commanderName.trim()) {
      setError("Give the deck a label and choose its commander.");
      return;
    }
    setError("");
    setDeckSaving(true);
    try {
      const commander = await fetchCard(commanderName);
      if (!isCommanderCard(commander)) throw new Error(`${commander.name} cannot be a Commander.`);
      let partner = null;
      if (partnerName.trim()) {
        partner = await fetchCard(partnerName);
        if (!isValidCommanderPartner(commander, partner)) {
          throw new Error(`${partner.name} is not a legal partner for ${commander.name}.`);
        }
      }
      const saved = await createSavedCommanderDeck(account, {
        label: deckLabel,
        commanderName: commander.name,
        commanderScryfallId: commander.id,
        partnerName: partner?.name,
        partnerScryfallId: partner?.id,
        colorIdentity: [...new Set([...(commander.color_identity || []), ...(partner?.color_identity || [])])],
        sortOrder: decks.length,
      });
      const next = [...decks, saved];
      setDecks(next);
      onDecksChange?.(next);
      setDeckLabel("");
      setCommanderName("");
      setPartnerName("");
    } catch (saveError) {
      setError(String(saveError?.message || "Could not save this Commander deck."));
    } finally {
      setDeckSaving(false);
    }
  };

  const removeDeck = async (deck) => {
    if (!window.confirm(`Remove ${deck.label} from your saved commanders?`)) return;
    try {
      await deleteSavedCommanderDeck(account, deck.id);
      const next = decks.filter((item) => item.id !== deck.id);
      setDecks(next);
      onDecksChange?.(next);
    } catch (deleteError) {
      setError(String(deleteError?.message || "Could not remove this Commander deck."));
    }
  };

  const downloadExport = async () => {
    try {
      const payload = await exportMyAccountData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `snapcast-account-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(String(exportError?.message || "Could not export your account data."));
    }
  };

  return (
    <div
      className={page ? "account-profile-page-content" : "lobby-modal-backdrop account-profile-backdrop"}
      onMouseDown={(event) => {
        if (!page && event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        className={page ? `account-profile account-profile-page-panel account-profile-${view}` : "lobby-modal account-profile"}
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : "true"}
        aria-labelledby={page && view === "settings"
          ? "account-settings-title"
          : page && view === "profile"
            ? "my-profile-title"
            : "account-profile-title"}
      >
        {!page && (
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        )}
        {page && view === "settings" ? (
          <header className="account-page-hero account-settings-hero">
            <div className="account-page-hero-copy">
              <p>Account settings</p>
              <h1 id="account-settings-title">Settings</h1>
              <span>Manage your profile, game devices, preferences, and account data.</span>
            </div>
            <button
              className="primary account-settings-save"
              type="submit"
              form="account-settings-form"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </header>
        ) : page && view === "profile" ? (
          <header className="account-page-hero my-profile-hero">
            <p>My profile</p>
            <h1 id="my-profile-title">{accountDisplayName(account)}</h1>
            {account?.privateAccount?.email && <span>{account.privateAccount.email}</span>}
          </header>
        ) : (
          <header className="account-profile-header">
            <div className="account-profile-avatar">
              {accountAvatarUrl(account) ? (
                <img src={accountAvatarUrl(account)} alt="" />
              ) : (
                <UserRound size={26} />
              )}
            </div>
            <div>
              <p>{view === "settings" ? "Account settings" : view === "friends" ? "Your circle" : "My profile"}</p>
              <h2 id="account-profile-title">{view === "friends" ? "Friends" : accountDisplayName(account)}</h2>
              {account?.privateAccount?.email && <span>{account.privateAccount.email}</span>}
            </div>
          </header>
        )}

        {page && view === "profile" && (
          <div className="account-page-tabs profile-page-tabs" role="tablist" aria-label="Profile sections">
            <button
              id="profile-tab-decks"
              type="button"
              role="tab"
              aria-selected={activeProfileTab === "decks"}
              aria-controls="profile-panel-decks"
              onClick={() => setActiveProfileTab("decks")}
            >
              Decks
            </button>
            <button
              id="profile-tab-game-history"
              type="button"
              role="tab"
              aria-selected={activeProfileTab === "game-history"}
              aria-controls="profile-panel-game-history"
              onClick={() => setActiveProfileTab("game-history")}
            >
              Game history
            </button>
            <button
              id="profile-tab-stats"
              type="button"
              role="tab"
              aria-selected={activeProfileTab === "stats"}
              aria-controls="profile-panel-stats"
              onClick={() => setActiveProfileTab("stats")}
            >
              Stats
            </button>
          </div>
        )}

        <form id={page && view === "settings" ? "account-settings-form" : undefined} onSubmit={submit}>
          {view === "settings" && <div className="account-profile-section">
            <h3>Public profile</h3>
            <label className="modal-field">
              <span>Display name</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={32}
                autoComplete="nickname"
                required
              />
            </label>
            <p className="account-profile-help">
              This is shown on your public profile and wherever your signed-in seat appears.
            </p>
          </div>}

          {view === "settings" && <div className="account-profile-section">
            <h3>Game entry</h3>
            <div className="account-device-row">
              <div>
                <strong>Camera</strong>
                <span>{savedDeviceLabel(preferredCameraId)}</span>
              </div>
              {preferredCameraId && (
                <button type="button" onClick={() => setPreferredCameraId("")}>Clear</button>
              )}
            </div>
            <div className="account-device-row">
              <div>
                <strong>Microphone</strong>
                <span>{savedDeviceLabel(preferredMicrophoneId)}</span>
              </div>
              {preferredMicrophoneId && (
                <button type="button" onClick={() => setPreferredMicrophoneId("")}>Clear</button>
              )}
            </div>
            <p className="account-profile-help">
              Device choices are saved after you enter a game. Clearing one lets your browser choose next time.
            </p>
          </div>}

          {view === "settings" && <div className="account-profile-section">
            <h3>Preferences</h3>
            <label className="modal-field">
              <span>Appearance</span>
              <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">Use system setting</option>
              </select>
            </label>
            <label className="account-check-row">
              <input
                type="checkbox"
                checked={appearOffline}
                onChange={(event) => setAppearOffline(event.target.checked)}
              />
              <span>
                <strong>Appear offline</strong>
                <small>Friends will not see your presence or current game.</small>
              </span>
            </label>
            <label className="account-check-row">
              <input
                type="checkbox"
                checked={showRecentGames}
                onChange={(event) => setShowRecentGames(event.target.checked)}
              />
              <span>
                <strong>Show recent games</strong>
                <small>Include recent completed games on your public profile.</small>
              </span>
            </label>
          </div>}

          {view === "profile" && (!page || activeProfileTab === "decks") && <div
            id={page ? "profile-panel-decks" : undefined}
            className="account-profile-section"
            role={page ? "tabpanel" : undefined}
            aria-labelledby={page ? "profile-tab-decks" : undefined}
          >
            <h3>Saved commanders</h3>
            {decks.length > 0 && (
              <div className="saved-deck-list" aria-label="Saved commander decks">
                {decks.map((deck) => (
                  <article className="saved-deck-row" key={deck.id}>
                    <div className={`saved-deck-card-stack${deck.partner_name ? " is-partner" : ""}`}>
                      <div className="saved-deck-card-placeholder" aria-hidden="true">
                        {(deck.commander_name || "?").slice(0, 1)}
                      </div>
                      <img
                        src={scryfallCardImage(deck.commander_scryfall_id, deck.commander_name)}
                        alt={`${deck.commander_name} card`}
                        loading="lazy"
                        onError={(event) => useNamedCardFallback(event, deck.commander_name)}
                      />
                      {deck.partner_name && (
                        <img
                          src={scryfallCardImage(deck.partner_scryfall_id, deck.partner_name)}
                          alt={`${deck.partner_name} card`}
                          loading="lazy"
                          onError={(event) => useNamedCardFallback(event, deck.partner_name)}
                        />
                      )}
                    </div>
                    <div className="saved-deck-copy">
                      <strong>{deck.label}</strong>
                      <span>{deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ""}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDeck(deck)}
                      aria-label={`Remove ${deck.label}`}
                      data-tooltip="Remove saved deck"
                      data-tooltip-pos="right-top"
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            )}
            <div className="saved-deck-form">
              <label className="modal-field">
                <span>Deck label</span>
                <input value={deckLabel} onChange={(event) => setDeckLabel(event.target.value)} maxLength={48} placeholder="Atraxa counters" />
              </label>
              <label className="modal-field">
                <span>Commander</span>
                <input value={commanderName} onChange={(event) => setCommanderName(event.target.value)} maxLength={120} placeholder="Commander name" />
              </label>
              <label className="modal-field">
                <span>Partner <em>Optional</em></span>
                <input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} maxLength={120} placeholder="Partner or Background" />
              </label>
              <button className="saved-deck-add" type="button" disabled={deckSaving} onClick={addDeck}>
                <Plus size={16} /> {deckSaving ? "Saving…" : "Save commander deck"}
              </button>
            </div>
          </div>}

          {view === "friends" && <div className="account-profile-section">
            <h3>Friends</h3>
            <label className="modal-field profile-friend-search">
              <span>Find a player</span>
              <input
                value={friendQuery}
                onChange={(event) => setFriendQuery(event.target.value)}
                maxLength={32}
                placeholder="Search display names"
              />
            </label>
            {friendResults.length > 0 && (
              <div className="profile-friend-search-results">
                {friendResults.map((profile) => (
                  <div key={profile.id}>
                    <a href={`/profile?id=${encodeURIComponent(profile.id)}`}>{profile.display_name}</a>
                    <button type="button" onClick={async () => {
                      try {
                        await sendFriendRequest(profile.id);
                        setFriendResults((profiles) => profiles.filter((item) => item.id !== profile.id));
                      } catch (requestError) {
                        setError(String(requestError?.message || "Could not send friend request."));
                      }
                    }}>Add friend</button>
                  </div>
                ))}
              </div>
            )}
            <div className="profile-friend-list">
              {social.friends.length ? social.friends.map((friend) => (
                <div className="profile-friend-row" key={friend.id}>
                  <span className={`friend-presence ${friend.status}`} />
                  <a href={`/profile?id=${encodeURIComponent(friend.id)}`}>{friend.display_name}</a>
                  <small>{friend.status === "in_game" ? "In a game" : friend.status === "online" ? "Online" : "Offline"}</small>
                  <button type="button" onClick={async () => {
                    if (!window.confirm(`Remove ${friend.display_name} from your friends?`)) return;
                    await removeFriend(friend.id);
                    refreshSocial();
                  }}>Remove</button>
                </div>
              )) : <p className="account-profile-help">Friends you add will appear here with privacy-aware presence.</p>}
            </div>
          </div>}

          {view === "profile" && (!page || activeProfileTab === "game-history") && <div
            id={page ? "profile-panel-game-history" : undefined}
            className="account-profile-section"
            role={page ? "tabpanel" : undefined}
            aria-labelledby={page ? "profile-tab-game-history" : undefined}
          >
            <h3>Recent game history</h3>
            {gameHistory.length ? (
              <div className="account-history-list">
                {gameHistory.map((game) => (
                  <article key={game.session_id}>
                    <span className={`profile-result ${game.result}`}>{game.result}</span>
                    <div>
                      <strong>{game.commander || "Commander not recorded"}{game.partner ? ` + ${game.partner}` : ""}</strong>
                      <small>{new Date(game.started_at).toLocaleDateString()} · {game.turn_count || 0} turns recorded</small>
                      {game.players?.length > 0 && (
                        <span className="account-history-players">
                          {game.players.map((player, index) => (
                            <React.Fragment key={player.id || `guest-${index}`}>
                              {index > 0 && ", "}
                              {player.id
                                ? <a href={`/profile?id=${encodeURIComponent(player.id)}`}>{player.display_name}</a>
                                : <span>{player.display_name}</span>}
                            </React.Fragment>
                          ))}
                        </span>
                      )}
                      {(game.player_timing?.length > 0 || game.turn_timeline?.length > 0) && (
                        <details className="account-history-timing">
                          <summary>Game timing details</summary>
                          {game.player_timing?.length > 0 && (
                            <div className="account-history-timing-grid">
                              {game.player_timing.map((player) => (
                                <span key={player.participant_id}>
                                  <strong>{player.display_name}</strong>
                                  <small>
                                    {player.turn_count} turns · {timingLabel(player.total_turn_ms)} total · {timingLabel(player.average_turn_ms)} average
                                  </small>
                                </span>
                              ))}
                            </div>
                          )}
                          {game.turn_timeline?.length > 0 && (
                            <ol className="account-turn-timeline">
                              {game.turn_timeline.map((turn) => (
                                <li key={`${turn.turn_number}-${turn.participant_id}`}>
                                  <span>Turn {turn.turn_number}</span>
                                  <strong>{turn.display_name}</strong>
                                  <small>
                                    {turn.commander || "Commander not recorded"}
                                    {turn.partner ? ` + ${turn.partner}` : ""}
                                    {" · "}{turn.ended_at ? timingLabel(turn.elapsed_ms) : "unfinished"}
                                  </small>
                                </li>
                              ))}
                            </ol>
                          )}
                        </details>
                      )}
                    </div>
                    {game.state === "proposed" && roomCapability(game.room_code) && (
                      <button type="button" onClick={async () => {
                        const correctionType = window.prompt("Correction type: result, loss reason, commander, or partner");
                        const normalizedType = String(correctionType || "").trim().toLowerCase();
                        const field = {
                          result: "result",
                          "loss reason": "loss_reason",
                          commander: "commander",
                          partner: "partner",
                        }[normalizedType];
                        if (!field) return;
                        const currentValue = field === "result"
                          ? game.result
                          : field === "commander"
                            ? game.commander || ""
                            : field === "partner"
                              ? game.partner || ""
                              : "";
                        const requestedValue = window.prompt(
                          field === "partner" ? "Correct value (leave empty to remove the partner)" : "Correct value",
                          currentValue,
                        );
                        if (requestedValue === null || (field !== "partner" && !requestedValue.trim())) return;
                        const reason = window.prompt("Why should this game record be corrected?");
                        if (!reason?.trim()) return;
                        const capability = roomCapability(game.room_code);
                        try {
                          await submitGameCorrection({
                            sessionId: game.session_id,
                            membershipId: capability.membershipId,
                            participantToken: capability.participantToken,
                            reason: reason.trim(),
                            proposedSnapshot: { [field]: requestedValue.trim() },
                          });
                          window.alert("Correction submitted for review.");
                        } catch (correctionError) {
                          setError(String(correctionError?.message || "Could not submit this correction."));
                        }
                      }}>Request correction</button>
                    )}
                    {game.state === "final" && (
                      <button type="button" onClick={async () => {
                        try {
                          await setMyGameVisibility(game.session_id, !game.hidden_by_player);
                          setGameHistory((games) => games.map((item) => item.session_id === game.session_id
                            ? { ...item, hidden_by_player: !item.hidden_by_player }
                            : item));
                        } catch (visibilityError) {
                          setError(String(visibilityError?.message || "Could not update game visibility."));
                        }
                      }}>{game.hidden_by_player ? "Show publicly" : "Hide publicly"}</button>
                    )}
                  </article>
                ))}
              </div>
            ) : <p className="account-profile-help">Completed games will appear here after results are recorded.</p>}
          </div>}

          {view === "settings" && <div className="account-profile-section">
            <h3>Account data</h3>
            <div className="account-data-actions">
              <button type="button" onClick={downloadExport}><Download size={16} /> Export my data</button>
              {!deletionDeadline ? (
                <button className="danger" type="button" onClick={async () => {
                  if (!window.confirm("Request account deletion? You will have seven days to cancel before account data is removed or anonymized.")) return;
                  try {
                    const deadline = await requestAccountDeletion();
                    localStorage.setItem("sc-account-deletion-deadline", deadline);
                    setDeletionDeadline(deadline);
                    window.alert(`Deletion requested. It is scheduled after ${new Date(deadline).toLocaleString()}.`);
                  } catch (deleteError) {
                    setError(String(deleteError?.message || "Could not request account deletion."));
                  }
                }}>Request deletion</button>
              ) : (
                <button type="button" onClick={async () => {
                  try {
                    await cancelAccountDeletion();
                    setDeletionDeadline("");
                    window.alert("Your account deletion request was canceled.");
                  } catch (cancelError) {
                    setError(String(cancelError?.message || "Could not cancel account deletion."));
                  }
                }}>Cancel deletion</button>
              )}
              {deletionDeadline && new Date(deletionDeadline) <= new Date() && (
                <button className="danger" type="button" onClick={async () => {
                  if (!window.confirm("Permanently delete this Snapcast account now? This cannot be undone.")) return;
                  try {
                    await finalizeAccountDeletion(account);
                    window.location.href = "/";
                  } catch (finalizeError) {
                    setError(String(finalizeError?.message || "Could not delete this account."));
                  }
                }}>Delete account now</button>
              )}
            </div>
            {deletionDeadline && (
              <p className="account-profile-help">
                Deletion is scheduled after {new Date(deletionDeadline).toLocaleString()}. You can cancel until final deletion begins.
              </p>
            )}
          </div>}

          {view === "notifications" && sentReviews.length > 0 && (
            <div className="account-profile-section">
              <h3>Reviews you sent</h3>
              <div className="received-review-list">
                {sentReviews.map((review) => (
                  <article key={review.id}>
                    <header>
                      <strong>{review.reviewed.display_name}</strong>
                      <span>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
                    </header>
                    {review.comment && <p>{review.comment}</p>}
                    {new Date(review.editable_until) > new Date() && (
                      <button type="button" onClick={async () => {
                        const nextRating = Number(window.prompt("Update rating (1–5)", String(review.rating)));
                        if (!Number.isInteger(nextRating) || nextRating < 1 || nextRating > 5) return;
                        const nextComment = window.prompt("Update private review comment", review.comment || "");
                        if (nextComment === null) return;
                        try {
                          await updateMyPlayerReview(review.id, nextRating, nextComment);
                          setSentReviews((reviews) => reviews.map((item) => item.id === review.id
                            ? { ...item, rating: nextRating, comment: nextComment.trim(), updated_at: new Date().toISOString() }
                            : item));
                        } catch (reviewError) {
                          setError(String(reviewError?.message || "Could not update this review."));
                        }
                      }}>Edit review</button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}

          {view === "notifications" && receivedReviews.length > 0 && (
            <div className="account-profile-section">
              <h3>Private player reviews</h3>
              <div className="received-review-list">
                {receivedReviews.map((review) => (
                  <article key={review.id}>
                    <header>
                      <strong>{review.reviewer.display_name}</strong>
                      <span>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span>
                    </header>
                    {review.comment && <p>{review.comment}</p>}
                    <button type="button" onClick={async () => {
                      const reason = window.prompt("Why are you reporting this review?");
                      if (!reason?.trim()) return;
                      try {
                        await reportPlayerReview(review.id, reason.trim());
                        window.alert("Review reported for moderation.");
                      } catch (reportError) {
                        setError(String(reportError?.message || "Could not report this review."));
                      }
                    }}>Report review</button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {view === "profile" && (!page || activeProfileTab === "game-history") && moderationCases.length > 0 && (
            <div className="account-profile-section">
              <h3>Reports and appeals</h3>
              <div className="received-review-list">
                {moderationCases.map((moderationCase) => (
                  <article key={moderationCase.id}>
                    <header>
                      <strong>{moderationCase.relationship === "reported" ? "Report you submitted" : "Report involving your review"}</strong>
                      <span>{moderationCase.status}</span>
                    </header>
                    <p>{moderationCase.reason}</p>
                    {moderationCase.resolution_note && <p>Decision: {moderationCase.resolution_note}</p>}
                    {moderationCase.appeal && (
                      <p>Appeal: {moderationCase.appeal.status}{moderationCase.appeal.resolution_note ? ` · ${moderationCase.appeal.resolution_note}` : ""}</p>
                    )}
                    {moderationCase.can_appeal && (
                      <button type="button" onClick={async () => {
                        const reason = window.prompt("Explain why this moderation decision should be reviewed again.");
                        if (!reason?.trim()) return;
                        try {
                          await submitModerationAppeal(moderationCase.id, reason.trim());
                          setModerationCases((cases) => cases.map((item) => item.id === moderationCase.id
                            ? { ...item, can_appeal: false, appeal: { status: "open", reason: reason.trim() } }
                            : item));
                        } catch (appealError) {
                          setError(String(appealError?.message || "Could not submit this appeal."));
                        }
                      }}>Appeal decision</button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          )}

          {page && view === "profile" && activeProfileTab === "stats" && (
            <div
              id="profile-panel-stats"
              className="profile-stats-blank"
              role="tabpanel"
              aria-labelledby="profile-tab-stats"
            />
          )}

          {error && <p className="modal-error" role="alert">{error}</p>}
          {view === "settings" && !page && <footer className="modal-actions">
            {!page && <button type="button" onClick={onClose}>Cancel</button>}
            <button className="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : page ? "Save changes" : "Save profile"}
            </button>
          </footer>}
        </form>
      </section>
    </div>
  );
}
