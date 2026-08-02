import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPaste, Download, ExternalLink, FileUp, LayoutGrid, Link2, List, Minus, Plus, Skull, Trophy, UserRound, X } from "lucide-react";
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
  importSavedDeckFromText,
  importSavedDeckFromUrl,
  listSavedCommanderDecks,
  previewSavedDeckFromUrl,
  requestAccountDeletion,
  removeFriend,
  reportPlayerReview,
  searchPublicProfiles,
  sendFriendRequest,
  submitModerationAppeal,
  updateMyPlayerReview,
} from "./account.js";
import { isCommanderCard, isValidCommanderPartner } from "./cardSearch.js";
import { detectDeckImportInput, summarizeDeckCards } from "./deckImport.js";
import DiscordMark from "./DiscordMark.jsx";
import { accountDiscordName } from "./accountIdentity.js";
import { roomCapability, submitGameCorrection } from "./gameRooms.js";

function savedDeviceLabel(value) {
  if (!value) return "No device saved";
  return `Saved device · ${value.slice(0, 8)}…`;
}

function compactDuration(seconds) {
  if (!(Number(seconds) > 0)) return "—";
  const minutes = Math.max(1, Math.round(Number(seconds) / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function compactTurnDuration(milliseconds) {
  if (!(Number(milliseconds) > 0)) return "—";
  const seconds = Math.max(1, Math.round(Number(milliseconds) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function eliminationReasonLabel(reason) {
  return {
    life: "life total",
    commander_damage: "commander damage",
    poison: "poison counters",
    concede: "concession",
    other: "another cause",
    unknown: "an unknown cause",
  }[reason] || "";
}

function scryfallCardImage(scryfallId, cardName) {
  const params = new URLSearchParams({ format: "image", version: "normal" });
  if (scryfallId) return `https://api.scryfall.com/cards/${encodeURIComponent(scryfallId)}?${params}`;
  params.set("exact", cardName || "");
  return `https://api.scryfall.com/cards/named?${params}`;
}

function scryfallCardArt(scryfallId, cardName) {
  const params = new URLSearchParams({
    format: "image",
    version: "art_crop",
  });
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

function useNamedCardArtFallback(event, cardName) {
  const image = event.currentTarget;
  if (image.dataset.namedFallback) {
    image.remove();
    return;
  }
  image.dataset.namedFallback = "true";
  image.src = scryfallCardArt(null, cardName);
}

const EMPTY_HISTORY_FILTERS = Object.freeze({
  bracket: "",
  commander: "",
  opponentCommander: "",
  player: "",
  result: "",
  dateFrom: "",
  dateTo: "",
});

const COLOR_SORT_ORDER = ["W", "U", "B", "R", "G"];

function deckColorSignature(deck) {
  const colors = new Set(Array.isArray(deck.color_identity) ? deck.color_identity : []);
  return COLOR_SORT_ORDER.filter((color) => colors.has(color)).join("") || "Colorless";
}

function deckAverageCmc(deck) {
  const value = Number(deck.average_cmc);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function uniqueHistoryValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function opponentCommanderNames(game, ownerName) {
  const recorded = (game.opponent_commanders || [])
    .flatMap((entry) => [entry.commander, entry.partner]);
  if (recorded.some(Boolean)) return uniqueHistoryValues(recorded);

  // Older local fixtures predate the structured opponent list. A turn
  // timeline can still provide the same names without parsing UI copy.
  return uniqueHistoryValues((game.turn_timeline || [])
    .filter((turn) => turn.display_name !== ownerName)
    .flatMap((turn) => [turn.commander, turn.partner]));
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
  const [deckView, setDeckView] = useState(() => {
    try {
      return localStorage.getItem(`sc-profile-deck-view:${account?.user?.id || "local"}`) === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const [deckSearch, setDeckSearch] = useState("");
  const [deckSort, setDeckSort] = useState("name");
  const [decks, setDecks] = useState([]);
  const [deckLabel, setDeckLabel] = useState("");
  const [commanderName, setCommanderName] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [deckSaving, setDeckSaving] = useState(false);
  const [deckImporting, setDeckImporting] = useState(false);
  const [deckImportProgress, setDeckImportProgress] = useState("");
  const [deckImportValue, setDeckImportValue] = useState("");
  const [deckImportSourceUrl, setDeckImportSourceUrl] = useState("");
  const [deckImportFileName, setDeckImportFileName] = useState("");
  const [showDeckForm, setShowDeckForm] = useState(false);
  const [showDeckImport, setShowDeckImport] = useState(false);
  const addDeckButtonRef = useRef(null);
  const deckLabelInputRef = useRef(null);
  const importDeckInputRef = useRef(null);
  const importDeckButtonRef = useRef(null);
  const importDeckTextareaRef = useRef(null);
  const [social, setSocial] = useState({ friends: [], notifications: [] });
  const [friendQuery, setFriendQuery] = useState("");
  const [friendResults, setFriendResults] = useState([]);
  const [receivedReviews, setReceivedReviews] = useState([]);
  const [sentReviews, setSentReviews] = useState([]);
  const [moderationCases, setModerationCases] = useState([]);
  const [gameHistory, setGameHistory] = useState([]);
  const [historyFilters, setHistoryFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [deletionDeadline, setDeletionDeadline] = useState(() => {
    try { return localStorage.getItem("sc-account-deletion-deadline") || ""; } catch { return ""; }
  });

  const profileStats = useMemo(() => {
    const games = gameHistory.filter((game) => game.state !== "canceled");
    const wins = games.filter((game) => game.result === "win").length;
    const draws = games.filter((game) => game.result === "draw").length;
    const losses = games.filter((game) => ["loss", "conceded"].includes(game.result));
    const commanderDamageLosses = losses.filter((game) => game.loss_reason === "commander_damage").length;
    const recordedDurations = games.map((game) => Number(game.duration_seconds)).filter((value) => value > 0);
    const recordedTurns = games.map((game) => Number(game.average_turn_ms)).filter((value) => value > 0);
    const commanderCounts = new Map();
    games.forEach((game) => {
      const commander = String(game.commander || "").trim();
      if (commander) commanderCounts.set(commander, (commanderCounts.get(commander) || 0) + 1);
    });
    const [topCommander = "—", topCommanderGames = 0] = [...commanderCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || [];
    const average = (values) => values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : 0;

    return {
      totalGames: games.length,
      wins,
      draws,
      losses: losses.length,
      winRate: games.length ? Math.round((wins / games.length) * 100) : 0,
      averageGameSeconds: average(recordedDurations),
      averageTurnMs: average(recordedTurns),
      topCommander,
      topCommanderGames,
      commanderDamageLosses,
      commanderDamageRate: losses.length ? Math.round((commanderDamageLosses / losses.length) * 100) : 0,
    };
  }, [gameHistory]);

  const historyFilterOptions = useMemo(() => {
    const ownerName = accountDisplayName(account);
    return {
      brackets: [...new Set(gameHistory.map((game) => Number(game.bracket)).filter((value) => value >= 1 && value <= 5))]
        .sort((left, right) => left - right),
      commanders: uniqueHistoryValues(gameHistory.flatMap((game) => [game.commander, game.partner])),
      opponentCommanders: uniqueHistoryValues(gameHistory.flatMap((game) => opponentCommanderNames(game, ownerName))),
      players: uniqueHistoryValues(gameHistory.flatMap((game) => (game.players || []).map((player) => player.display_name))),
    };
  }, [account, gameHistory]);

  const filteredGameHistory = useMemo(() => {
    const ownerName = accountDisplayName(account);
    const fromTime = historyFilters.dateFrom
      ? new Date(`${historyFilters.dateFrom}T00:00:00`).getTime()
      : Number.NEGATIVE_INFINITY;
    const toTime = historyFilters.dateTo
      ? new Date(`${historyFilters.dateTo}T23:59:59.999`).getTime()
      : Number.POSITIVE_INFINITY;

    return gameHistory.filter((game) => {
      const startedAt = new Date(game.started_at).getTime();
      const resultMatches = !historyFilters.result
        || (historyFilters.result === "loss"
          ? ["loss", "conceded"].includes(game.result)
          : game.result === historyFilters.result);
      return resultMatches
        && (!historyFilters.bracket || String(game.bracket || "") === historyFilters.bracket)
        && (!historyFilters.commander || [game.commander, game.partner].includes(historyFilters.commander))
        && (!historyFilters.opponentCommander
          || opponentCommanderNames(game, ownerName).includes(historyFilters.opponentCommander))
        && (!historyFilters.player
          || (game.players || []).some((player) => player.display_name === historyFilters.player))
        && startedAt >= fromTime
        && startedAt <= toTime;
    });
  }, [account, gameHistory, historyFilters]);

  const historyFiltersActive = Object.values(historyFilters).some(Boolean);
  const updateHistoryFilter = (key, value) => {
    setHistoryFilters((current) => ({ ...current, [key]: value }));
  };

  const visibleDecks = useMemo(() => {
    const query = deckSearch.trim().toLocaleLowerCase();
    const matches = query
      ? decks.filter((deck) => [
        deck.label,
        deck.commander_name,
        deck.partner_name,
        deckColorSignature(deck),
      ].some((value) => String(value || "").toLocaleLowerCase().includes(query)))
      : [...decks];

    return matches.sort((left, right) => {
      const nameOrder = String(left.label || left.commander_name || "")
        .localeCompare(String(right.label || right.commander_name || ""), undefined, { sensitivity: "base" });
      if (deckSort === "colors") {
        return deckColorSignature(left).localeCompare(deckColorSignature(right)) || nameOrder;
      }
      if (deckSort === "cmc") {
        return deckAverageCmc(left) - deckAverageCmc(right) || nameOrder;
      }
      return nameOrder;
    });
  }, [deckSearch, deckSort, decks]);

  const deckImportInput = useMemo(() => detectDeckImportInput(deckImportValue), [deckImportValue]);
  const deckImportSummary = useMemo(() => (
    deckImportInput.kind === "deck_text" ? summarizeDeckCards(deckImportInput.cards) : null
  ), [deckImportInput]);

  const closeDeckForm = useCallback(() => {
    setShowDeckForm(false);
    window.requestAnimationFrame(() => addDeckButtonRef.current?.focus());
  }, []);

  const closeDeckImport = useCallback(() => {
    setShowDeckImport(false);
    setError("");
    setDeckImportValue("");
    setDeckImportSourceUrl("");
    setDeckImportFileName("");
    setDeckImportProgress("");
    setDeckLabel("");
    window.requestAnimationFrame(() => importDeckButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    let active = true;
    listSavedCommanderDecks(account)
      .then((saved) => {
        if (!active) return;
        setDecks(saved);
      })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load saved commanders."));
      });
    return () => { active = false; };
  }, [account]);

  const selectDeckView = (viewMode) => {
    setDeckView(viewMode);
    try {
      localStorage.setItem(`sc-profile-deck-view:${account?.user?.id || "local"}`, viewMode);
    } catch { /* the view still changes for this visit */ }
  };

  const refreshSocial = () => getSocialDashboard()
    .then(setSocial)
    .catch((loadError) => setError(String(loadError?.message || "Could not load friends and notifications.")));

  useEffect(() => {
    let active = true;
    getSocialDashboard()
      .then((value) => { if (active) setSocial(value); })
      .catch((loadError) => {
        if (active) setError(String(loadError?.message || "Could not load friends and notifications."));
      });
    getMyReceivedReviews().then((value) => { if (active) setReceivedReviews(value); }).catch(() => {});
    getMySentReviews().then((value) => { if (active) setSentReviews(value); }).catch(() => {});
    getMyModerationCases().then((value) => { if (active) setModerationCases(value); }).catch(() => {});
    getMyGameHistory(100).then((value) => { if (active) setGameHistory(value); }).catch(() => {});
    getAccountDeletionStatus().then((status) => {
      if (!active) return;
      if (!status?.execute_after || status.canceled_at || status.completed_at) {
        try { localStorage.removeItem("sc-account-deletion-deadline"); } catch { /* state remains authoritative */ }
        setDeletionDeadline("");
        return;
      }
      try { localStorage.setItem("sc-account-deletion-deadline", status.execute_after); } catch { /* state remains authoritative */ }
      setDeletionDeadline(status.execute_after);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const query = friendQuery.trim();
    if (query.length < 2) {
      setFriendResults([]);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      searchPublicProfiles(query)
        .then((profiles) => {
          if (!active) return;
          const existingFriendIds = new Set(social.friends.map((friend) => friend.id));
          setFriendResults(profiles.filter((profile) => (
            profile.id !== account.user.id && !existingFriendIds.has(profile.id)
          )));
        })
        .catch((searchError) => {
          if (active) setError(String(searchError?.message || "Could not search profiles."));
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [account.user.id, friendQuery, social.friends]);

  useEffect(() => {
    if (page || !onClose) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, page]);

  useEffect(() => {
    if (!showDeckForm) return undefined;
    deckLabelInputRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeDeckForm();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeDeckForm, showDeckForm]);

  useEffect(() => {
    if (!showDeckImport) return undefined;
    importDeckTextareaRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !deckImporting) closeDeckImport();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeDeckImport, deckImporting, showDeckImport]);

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
      closeDeckForm();
    } catch (saveError) {
      setError(String(saveError?.message || "Could not save this Commander deck."));
    } finally {
      setDeckSaving(false);
    }
  };

  const chooseDeckImportFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      setDeckImportValue(await file.text());
      setDeckImportSourceUrl("");
      setDeckImportFileName(file.name);
      const fallbackLabel = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      if (!deckLabel.trim()) setDeckLabel(fallbackLabel);
    } catch (importError) {
      setError(String(importError?.message || "Could not read this deck file."));
    }
  };

  const pasteDeckImport = async () => {
    setError("");
    try {
      if (!navigator.clipboard?.readText) throw new Error("Clipboard access is not available in this browser.");
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("Your clipboard is empty.");
      setDeckImportValue(text);
      setDeckImportFileName("");
    } catch (clipboardError) {
      setError(String(clipboardError?.message || "Could not read the clipboard. Paste into the box instead."));
    }
  };

  const beginMoxfieldExport = () => {
    if (deckImportInput.kind !== "moxfield_url") return;
    setDeckImportSourceUrl(deckImportInput.source.url);
    setDeckImportValue("");
    setDeckImportFileName("");
    setError("");
    window.requestAnimationFrame(() => importDeckTextareaRef.current?.focus());
  };

  const importCompleteDeck = async () => {
    setError("");
    let saved = null;
    try {
      setDeckImporting(true);
      let names = deckImportSummary?.commanders || [];
      let label = deckLabel.trim();
      let importMode = "text";
      let importUrl = deckImportSourceUrl;
      let archidektPreview = null;

      if (deckImportInput.kind === "moxfield_url") {
        beginMoxfieldExport();
        return;
      }
      if (deckImportInput.kind === "archidekt_url") {
        setDeckImportProgress("Reading the public Archidekt deck…");
        archidektPreview = await previewSavedDeckFromUrl(account, deckImportInput.source.url);
        names = archidektPreview.commanders || [];
        label ||= archidektPreview.name || names[0] || "Imported deck";
        importMode = "url";
        importUrl = archidektPreview.sourceUrl;
      } else if (deckImportInput.kind !== "deck_text") {
        throw new Error(deckImportInput.kind === "invalid_url"
          ? "Paste a public Moxfield or Archidekt deck link."
          : "Paste a deck link, exported deck list, or choose a text file.");
      }
      if (!names.length) throw new Error("The deck list needs a Commander section or a card marked *CMDR*.");

      setDeckImportProgress("Checking the Commander…");
      const commander = await fetchCard(names[0]);
      if (!isCommanderCard(commander)) throw new Error(`${commander.name} cannot be a Commander.`);
      let partner = null;
      if (names[1]) {
        partner = await fetchCard(names[1]);
        if (!isValidCommanderPartner(commander, partner)) {
          throw new Error(`${partner.name} is not a legal partner for ${commander.name}.`);
        }
      }
      label ||= deckImportFileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || commander.name;

      setDeckImportProgress("Creating your deck…");
      saved = await createSavedCommanderDeck(account, {
        label,
        commanderName: commander.name,
        commanderScryfallId: commander.id,
        partnerName: partner?.name,
        partnerScryfallId: partner?.id,
        colorIdentity: [...new Set([...(commander.color_identity || []), ...(partner?.color_identity || [])])],
        sortOrder: decks.length,
      });

      setDeckImportProgress("Adding cards and artwork…");
      const imported = importMode === "url"
        ? await importSavedDeckFromUrl(account, saved.id, importUrl)
        : await importSavedDeckFromText(account, saved.id, deckImportValue, deckImportSourceUrl);
      const complete = {
        ...saved,
        source_provider: imported.sourceProvider,
        source_url: imported.sourceUrl,
        imported_at: new Date().toISOString(),
      };
      const next = [...decks, complete];
      setDecks(next);
      onDecksChange?.(next);
      closeDeckImport();
      window.location.assign(`/profile/decks/${encodeURIComponent(saved.id)}`);
    } catch (importError) {
      if (saved?.id) {
        try {
          await deleteSavedCommanderDeck(account, saved.id);
        } catch {
          setError(`${String(importError?.message || "Could not import this deck.")} The empty deck could not be removed automatically.`);
          return;
        }
      }
      setError(String(importError?.message || "Could not import this deck."));
    } finally {
      setDeckImporting(false);
      setDeckImportProgress("");
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
          : page && view === "friends"
            ? "account-friends-title"
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
        ) : page && view === "friends" ? (
          <header className="account-page-hero account-friends-hero">
            <p>Your circle</p>
            <h1 id="account-friends-title">Friends</h1>
            <span className="account-discord-identity"><DiscordMark />{accountDiscordName(account)}</span>
          </header>
        ) : page && view === "profile" ? (
          <header className="account-page-hero my-profile-hero">
            <h1 id="my-profile-title">{accountDisplayName(account)}</h1>
            <span className="account-discord-identity"><DiscordMark />{accountDiscordName(account)}</span>
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
              <span className="account-discord-identity"><DiscordMark />{accountDiscordName(account)}</span>
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
            <h3 className="profile-tab-heading">Public profile</h3>
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
            <h3 className="profile-tab-heading">Game entry</h3>
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
            <h3 className="profile-tab-heading">Preferences</h3>
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
            <div className="profile-tab-heading-row">
              <h3 className="profile-tab-heading">My decks</h3>
              {page && (
                <div className="profile-tab-heading-actions">
                  <button
                    ref={importDeckButtonRef}
                    className="profile-import-deck"
                    type="button"
                    onClick={() => {
                      setError("");
                      setShowDeckImport(true);
                    }}
                  >
                    <Download size={16} /> Import deck
                  </button>
                  <button
                    ref={addDeckButtonRef}
                    className="profile-add-deck"
                    type="button"
                    onClick={() => {
                      setError("");
                      setShowDeckForm(true);
                    }}
                  >
                    <Plus size={16} /> Add deck
                  </button>
                </div>
              )}
            </div>
            {page && decks.length > 0 && (
              <div className="profile-deck-toolbar" aria-label="Filter and sort decks">
                <div className="profile-deck-filter-controls">
                  <label className="profile-deck-search">
                    <span>Search</span>
                    <input
                      type="search"
                      value={deckSearch}
                      onChange={(event) => setDeckSearch(event.target.value)}
                      placeholder="Search decks or commanders"
                    />
                  </label>
                  <label className="profile-deck-sort">
                    <span>Sort by</span>
                    <select value={deckSort} onChange={(event) => setDeckSort(event.target.value)}>
                      <option value="name">Name</option>
                      <option value="colors">Colors</option>
                      <option value="cmc">Average CMC</option>
                    </select>
                  </label>
                </div>
                <div className="deck-view-toggle" role="group" aria-label="Deck view">
                  <button
                    type="button"
                    aria-label="Grid view"
                    aria-pressed={deckView === "grid"}
                    title="Grid view"
                    onClick={() => selectDeckView("grid")}
                  >
                    <LayoutGrid size={17} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="List view"
                    aria-pressed={deckView === "list"}
                    title="List view"
                    onClick={() => selectDeckView("list")}
                  >
                    <List size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
            {decks.length > 0 && (
              <div className={`saved-deck-list is-${deckView}`} aria-label="Saved commander decks">
                {visibleDecks.map((deck) => (
                  <a
                    className="saved-deck-row"
                    href={`/profile/decks/${encodeURIComponent(deck.id)}`}
                    aria-label={`Open ${deck.label} deck`}
                    key={deck.id}
                  >
                    {deckView === "list" ? (
                      <div className="saved-deck-card-stack is-thumbnail" key="list-thumbnail">
                        <img
                          src={scryfallCardArt(deck.commander_scryfall_id, deck.commander_name)}
                          alt={`${deck.commander_name} art`}
                          loading="lazy"
                          onError={(event) => useNamedCardArtFallback(event, deck.commander_name)}
                        />
                      </div>
                    ) : (
                      <div className={`saved-deck-card-stack${deck.partner_name ? " is-partner" : ""}`} key="grid-cards">
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
                    )}
                    <div className="saved-deck-copy">
                      <strong>{deck.label}</strong>
                      <span>{deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ""}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
            {decks.length > 0 && visibleDecks.length === 0 && (
              <p className="profile-deck-empty">No decks match your search.</p>
            )}
            {!page && <div className="saved-deck-form">
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
            </div>}

            {page && showDeckForm && (
              <div
                className="lobby-modal-backdrop deck-form-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget && !deckSaving) closeDeckForm();
                }}
              >
                <section
                  className="lobby-modal deck-form-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="add-deck-title"
                >
                  <button
                    className="modal-close"
                    type="button"
                    onClick={closeDeckForm}
                    disabled={deckSaving}
                    aria-label="Close add deck"
                  >
                    <X size={20} />
                  </button>
                  <header className="modal-head compact">
                    <h2 id="add-deck-title">Add deck</h2>
                  </header>
                  <div className="modal-fields">
                    <label className="modal-field">
                      <span>Deck label</span>
                      <input
                        ref={deckLabelInputRef}
                        value={deckLabel}
                        onChange={(event) => setDeckLabel(event.target.value)}
                        maxLength={48}
                        placeholder="Atraxa counters"
                      />
                    </label>
                    <label className="modal-field">
                      <span>Commander</span>
                      <input
                        value={commanderName}
                        onChange={(event) => setCommanderName(event.target.value)}
                        maxLength={120}
                        placeholder="Commander name"
                      />
                    </label>
                    <label className="modal-field">
                      <span>Partner <em>Optional</em></span>
                      <input
                        value={partnerName}
                        onChange={(event) => setPartnerName(event.target.value)}
                        maxLength={120}
                        placeholder="Partner or Background"
                      />
                    </label>
                  </div>
                  {error && <p className="modal-error" role="alert">{error}</p>}
                  <footer className="modal-actions">
                    <button type="button" onClick={closeDeckForm} disabled={deckSaving}>Cancel</button>
                    <button className="primary" type="button" disabled={deckSaving} onClick={addDeck}>
                      {deckSaving ? "Saving…" : "Save deck"}
                    </button>
                  </footer>
                </section>
              </div>
            )}

            {page && showDeckImport && (
              <div
                className="lobby-modal-backdrop deck-form-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget && !deckImporting) closeDeckImport();
                }}
              >
                <section
                  className="lobby-modal deck-form-modal deck-import-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="import-deck-title"
                >
                  <button
                    className="modal-close"
                    type="button"
                    onClick={closeDeckImport}
                    disabled={deckImporting}
                    aria-label="Close deck import"
                  >
                    <X size={20} />
                  </button>
                  <header className="modal-head compact deck-import-modal-head">
                    <span className="deck-import-kicker">Bring your collection with you</span>
                    <h2 id="import-deck-title">Import a deck</h2>
                    <p>Paste one link or list. Snapcast detects the source and sets up the whole deck.</p>
                  </header>

                  <div className="deck-import-provider-strip" aria-label="Supported deck sources">
                    <span><strong>M</strong> Moxfield export</span>
                    <span><strong>A</strong> Public Archidekt link</span>
                    <span><FileUp size={15} /> Text file</span>
                  </div>

                  {deckImportSourceUrl && (
                    <div className="deck-import-source-card">
                      <div>
                        <strong>Moxfield deck connected</strong>
                        <span>Now paste the exported list below.</span>
                      </div>
                      <a href={deckImportSourceUrl} target="_blank" rel="noreferrer">
                        Open deck <ExternalLink size={14} />
                      </a>
                    </div>
                  )}

                  <label className="modal-field deck-import-input-field">
                    <span>{deckImportSourceUrl ? "Paste the Moxfield export" : "Deck link or exported list"}</span>
                    <textarea
                      ref={importDeckTextareaRef}
                      value={deckImportValue}
                      onChange={(event) => {
                        setDeckImportValue(event.target.value);
                        setDeckImportFileName("");
                        setError("");
                      }}
                      rows={6}
                      spellCheck="false"
                      placeholder={deckImportSourceUrl
                        ? "Commander\n1 Atraxa, Praetors' Voice *CMDR*\n\nMainboard\n1 Sol Ring #!Ramp"
                        : "https://archidekt.com/decks/…\n\nor paste a Moxfield export"}
                    />
                  </label>

                  <div className="deck-import-input-actions">
                    <button type="button" onClick={pasteDeckImport} disabled={deckImporting}>
                      <ClipboardPaste size={16} /> Paste from clipboard
                    </button>
                    <button type="button" onClick={() => importDeckInputRef.current?.click()} disabled={deckImporting}>
                      <FileUp size={16} /> Choose file
                    </button>
                    <input
                      ref={importDeckInputRef}
                      type="file"
                      accept=".txt,.dec,.dek,text/plain"
                      hidden
                      onChange={chooseDeckImportFile}
                    />
                  </div>

                  {deckImportInput.kind === "moxfield_url" && (
                    <div className="deck-import-detected is-moxfield">
                      <div><strong>Moxfield link detected</strong><span>Moxfield requires its copied export rather than an automatic request.</span></div>
                      <button type="button" onClick={beginMoxfieldExport} disabled={deckImporting}>
                        Continue <ExternalLink size={14} />
                      </button>
                    </div>
                  )}
                  {deckImportSourceUrl && !deckImportValue.trim() && (
                    <p className="deck-import-help">In Moxfield choose <strong>More → Export → Copy for Moxfield</strong>, then return here and use “Paste from clipboard.”</p>
                  )}
                  {deckImportInput.kind === "archidekt_url" && (
                    <div className="deck-import-detected is-archidekt">
                      <Link2 size={18} />
                      <div><strong>Public Archidekt deck detected</strong><span>Its title, Commander, cards, sections, and printings will be imported.</span></div>
                    </div>
                  )}
                  {deckImportSummary && (
                    <div className="deck-import-preview">
                      <div><span>Commander</span><strong>{deckImportSummary.commanders.join(" + ") || "Not identified"}</strong></div>
                      <div><span>Cards</span><strong>{deckImportSummary.totalCards}</strong></div>
                      <div><span>Sections</span><strong>{[deckImportSummary.totals.mainboard && "Main", deckImportSummary.totals.sideboard && "Side", deckImportSummary.totals.maybeboard && "Considering"].filter(Boolean).join(" · ") || "Commander only"}</strong></div>
                    </div>
                  )}

                  {(deckImportInput.kind === "deck_text" || deckImportInput.kind === "archidekt_url") && (
                    <label className="modal-field deck-import-label-field">
                      <span>Deck name <em>Optional</em></span>
                      <input
                        value={deckLabel}
                        onChange={(event) => setDeckLabel(event.target.value)}
                        maxLength={48}
                        placeholder={deckImportFileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim()
                          || deckImportSummary?.commanders[0]
                          || "Use the Archidekt deck name"}
                      />
                    </label>
                  )}

                  {deckImportProgress && <div className="deck-import-progress" role="status"><span aria-hidden="true" /> {deckImportProgress}</div>}
                  {error && <p className="modal-error" role="alert">{error}</p>}
                  <footer className="modal-actions">
                    <button type="button" onClick={closeDeckImport} disabled={deckImporting}>Cancel</button>
                    <button
                      className="primary"
                      type="button"
                      disabled={deckImporting || deckImportInput.kind === "empty"}
                      onClick={importCompleteDeck}
                    >
                      {deckImporting
                        ? "Importing…"
                        : deckImportInput.kind === "moxfield_url"
                          ? "Continue to export"
                          : deckImportInput.kind === "archidekt_url"
                            ? "Import from Archidekt"
                            : deckImportSummary
                              ? `Import ${deckImportSummary.totalCards} cards`
                              : "Import deck"}
                    </button>
                  </footer>
                </section>
              </div>
            )}
          </div>}

          {view === "friends" && <div className="account-profile-section">
            <h3 className="profile-tab-heading">Friends</h3>
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
            <div className="profile-tab-heading-row">
              <h3 className="profile-tab-heading">Recent game history</h3>
            </div>
            {gameHistory.length > 0 && (
              <div className="account-history-filters" aria-label="Filter game history">
                <div className="account-history-filter-grid">
                  <label>
                    <span>Result</span>
                    <select value={historyFilters.result} onChange={(event) => updateHistoryFilter("result", event.target.value)}>
                      <option value="">All results</option>
                      <option value="win">Wins</option>
                      <option value="loss">Losses</option>
                      <option value="draw">Draws</option>
                    </select>
                  </label>
                  <label>
                    <span>Bracket</span>
                    <select value={historyFilters.bracket} onChange={(event) => updateHistoryFilter("bracket", event.target.value)}>
                      <option value="">All brackets</option>
                      {historyFilterOptions.brackets.map((bracket) => (
                        <option value={bracket} key={bracket}>Bracket {bracket}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>My commander</span>
                    <select value={historyFilters.commander} onChange={(event) => updateHistoryFilter("commander", event.target.value)}>
                      <option value="">All commanders</option>
                      {historyFilterOptions.commanders.map((commander) => (
                        <option value={commander} key={commander}>{commander}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Versus commander</span>
                    <select
                      value={historyFilters.opponentCommander}
                      onChange={(event) => updateHistoryFilter("opponentCommander", event.target.value)}
                    >
                      <option value="">All opposing commanders</option>
                      {historyFilterOptions.opponentCommanders.map((commander) => (
                        <option value={commander} key={commander}>{commander}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Player</span>
                    <select value={historyFilters.player} onChange={(event) => updateHistoryFilter("player", event.target.value)}>
                      <option value="">All players</option>
                      {historyFilterOptions.players.map((player) => (
                        <option value={player} key={player}>{player}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={historyFilters.dateFrom}
                      max={historyFilters.dateTo || undefined}
                      onChange={(event) => updateHistoryFilter("dateFrom", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={historyFilters.dateTo}
                      min={historyFilters.dateFrom || undefined}
                      onChange={(event) => updateHistoryFilter("dateTo", event.target.value)}
                    />
                  </label>
                </div>
                <div className="account-history-filter-summary">
                  <span>{filteredGameHistory.length} of {gameHistory.length} games</span>
                  {historyFiltersActive && (
                    <button type="button" onClick={() => setHistoryFilters(EMPTY_HISTORY_FILTERS)}>Clear filters</button>
                  )}
                </div>
              </div>
            )}
            {gameHistory.length ? (
              filteredGameHistory.length ? <div className="account-history-list">
                {filteredGameHistory.map((game) => (
                  <article key={game.session_id}>
                    <span
                      className={`account-history-result ${game.result}`}
                      aria-label={`Result: ${game.result}`}
                      title={game.result === "win" ? "Win" : game.result === "draw" ? "Draw" : "Loss"}
                    >
                      {game.result === "win"
                        ? <Trophy size={20} aria-hidden="true" />
                        : game.result === "draw"
                          ? <Minus size={21} aria-hidden="true" />
                          : <Skull size={20} aria-hidden="true" />}
                    </span>
                    <img
                      className="account-history-commander-art"
                      src={scryfallCardArt(null, game.commander)}
                      alt=""
                      loading="lazy"
                      onError={(event) => { event.currentTarget.hidden = true; }}
                    />
                    <div>
                      <strong>{game.commander || "Commander not recorded"}{game.partner ? ` + ${game.partner}` : ""}</strong>
                      <small className="account-history-meta">
                        {new Date(game.started_at).toLocaleDateString()} · {compactDuration(game.duration_seconds)} · {game.turn_count || 0} game turns
                        {game.my_turn_count != null ? ` · ${game.my_turn_count} yours` : ""}
                        {game.bracket ? ` · Bracket ${game.bracket}` : ""}
                        {eliminationReasonLabel(game.loss_reason) ? ` · Out by ${eliminationReasonLabel(game.loss_reason)}` : ""}
                      </small>
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
                  </article>
                ))}
              </div> : <p className="account-history-empty">No games match these filters.</p>
            ) : <p className="account-profile-help">Completed games will appear here after results are recorded.</p>}
          </div>}

          {view === "settings" && <div className="account-profile-section">
            <h3 className="profile-tab-heading">Account data</h3>
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
              className="profile-stats-panel"
              role="tabpanel"
              aria-labelledby="profile-tab-stats"
            >
              <div className="profile-tab-heading-row">
                <h3 className="profile-tab-heading">Stats</h3>
              </div>
              <div className="profile-stats-grid" aria-label="Game statistics">
                <article className="profile-stat-card">
                  <strong>{profileStats.winRate}%</strong>
                  <small>Win rate</small>
                  <p>{profileStats.wins} wins · {profileStats.draws} draws</p>
                </article>
                <article className="profile-stat-card">
                  <strong>{profileStats.totalGames}</strong>
                  <small>Total games</small>
                  <p>{profileStats.losses} losses recorded</p>
                </article>
                <article className="profile-stat-card">
                  <strong>{compactDuration(profileStats.averageGameSeconds)}</strong>
                  <small>Average game time</small>
                  <p>Across completed games</p>
                </article>
                <article className="profile-stat-card is-commander">
                  <strong>{profileStats.topCommander}</strong>
                  <small>Top commander</small>
                  <p>{profileStats.topCommanderGames} {profileStats.topCommanderGames === 1 ? "game" : "games"} played</p>
                </article>
                <article className="profile-stat-card">
                  <strong>{profileStats.commanderDamageRate}%</strong>
                  <small>Commander damage losses</small>
                  <p>{profileStats.commanderDamageLosses} of {profileStats.losses} losses</p>
                </article>
                <article className="profile-stat-card">
                  <strong>{compactTurnDuration(profileStats.averageTurnMs)}</strong>
                  <small>Average turn length</small>
                  <p>From recorded player turns</p>
                </article>
              </div>
            </div>
          )}

          {error && !showDeckForm && !showDeckImport && <p className="modal-error" role="alert">{error}</p>}
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
