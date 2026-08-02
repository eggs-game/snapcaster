import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import { getLocalMockData, isMockAccount, updateLocalMock } from "./localMock.js";
import {
  aggregateDeckCards,
  normalizeDeckBoard,
  parseArchidektDeck,
  parseDeckAttributionUrl,
  parseDeckSourceUrl,
  parseDeckText,
} from "./deckImport.js";
import { ANT_MAN_DECK_TEXT } from "./mockDeckFixtures.js";
export { accountAvatarUrl, accountDisplayName } from "./accountIdentity.js";

const PENDING_GAME_KEY = "sc-pending-game";

async function hydrateAccount(session) {
  if (!session?.user?.id) return null;
  if (session.user.is_anonymous) return null;
  const supabase = getSupabase();
  const [profileResult, preferencesResult, privateResult] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar_url, created_at, updated_at").eq("id", session.user.id).single(),
    supabase.from("account_preferences").select("preferred_camera_id, preferred_microphone_id, theme, appear_offline, show_recent_games").eq("user_id", session.user.id).single(),
    supabase.from("account_private").select("email, email_verified, discord_username").eq("user_id", session.user.id).single(),
  ]);
  const firstError = profileResult.error || preferencesResult.error || privateResult.error;
  if (firstError) throw firstError;
  const {
    provider_token: _providerToken,
    provider_refresh_token: _providerRefreshToken,
    ...safeSession
  } = session;
  return {
    ...safeSession,
    profile: profileResult.data,
    preferences: preferencesResult.data,
    privateAccount: privateResult.data,
  };
}

export async function getAccountSession() {
  const mock = await getLocalMockData();
  if (mock) return structuredClone(mock.account);
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return hydrateAccount(data.session);
}

export function subscribeToAccount(callback) {
  let cancelled = false;
  let unsubscribe = () => {};
  getLocalMockData().then((mock) => {
    if (cancelled) return;
    if (mock) {
      callback(structuredClone(mock.account));
      return;
    }
    if (!isSupabaseConfigured()) return;
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      if (!session || session.user?.is_anonymous) {
        callback(null);
        return;
      }
      hydrateAccount(session)
        .then(callback)
        .catch((error) => callback(null, error));
    });
    unsubscribe = () => data.subscription.unsubscribe();
  });
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function signInWithDiscord({ pendingGame = null, redirectPath = "/" } = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Discord sign-in is not configured for this deployment.");
  }
  if (pendingGame) {
    sessionStorage.setItem(PENDING_GAME_KEY, JSON.stringify(pendingGame));
  } else {
    // A header sign-in is account-only. Clear any abandoned post-game prompt
    // intent so returning from Discord always lands on the home page.
    sessionStorage.removeItem(PENDING_GAME_KEY);
  }
  const safeRedirectPath = String(redirectPath || "/").startsWith("/") ? redirectPath : "/";
  const redirectTo = `${window.location.origin}${safeRedirectPath}`;
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo,
      scopes: "identify email",
    },
  });
  if (error) throw error;
}

export async function signOutAccount() {
  const mock = await getLocalMockData();
  if (mock) return;
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
  sessionStorage.removeItem(PENDING_GAME_KEY);
}

export async function updateAccountSettings(account, {
  displayName,
  preferredCameraId,
  preferredMicrophoneId,
  theme,
  appearOffline,
  showRecentGames,
}) {
  if (!account?.user?.id) throw new Error("Sign in to update your profile.");
  const userId = account.user.id;
  const cleanName = String(displayName || "").trim();
  if (!cleanName || cleanName.length > 32) {
    throw new Error("Your display name must be between 1 and 32 characters.");
  }
  if (isMockAccount(account)) {
    const mock = await updateLocalMock((data) => {
      data.account.profile.display_name = cleanName;
      data.account.preferences = {
        ...data.account.preferences,
        preferred_camera_id: preferredCameraId || null,
        preferred_microphone_id: preferredMicrophoneId || null,
        theme,
        appear_offline: Boolean(appearOffline),
        show_recent_games: Boolean(showRecentGames),
      };
    });
    return structuredClone(mock.account);
  }
  const supabase = getSupabase();
  const [profileResult, preferencesResult] = await Promise.all([
    supabase
      .from("profiles")
      .update({ display_name: cleanName })
      .eq("id", userId)
      .select("id, display_name, avatar_url, created_at, updated_at")
      .single(),
    supabase
      .from("account_preferences")
      .update({
        preferred_camera_id: preferredCameraId || null,
        preferred_microphone_id: preferredMicrophoneId || null,
        theme,
        appear_offline: Boolean(appearOffline),
        show_recent_games: Boolean(showRecentGames),
      })
      .eq("user_id", userId)
      .select("preferred_camera_id, preferred_microphone_id, theme, appear_offline, show_recent_games")
      .single(),
  ]);
  const firstError = profileResult.error || preferencesResult.error;
  if (firstError) throw firstError;
  return {
    ...account,
    profile: profileResult.data,
    preferences: preferencesResult.data,
  };
}

export async function saveEntryDevices(account, { preferredCameraId, preferredMicrophoneId }) {
  if (!account?.user?.id) return account;
  if (isMockAccount(account)) {
    const mock = await updateLocalMock((data) => {
      data.account.preferences.preferred_camera_id = preferredCameraId || null;
      data.account.preferences.preferred_microphone_id = preferredMicrophoneId || null;
    });
    return structuredClone(mock.account);
  }
  const { data, error } = await getSupabase()
    .from("account_preferences")
    .update({
      preferred_camera_id: preferredCameraId || null,
      preferred_microphone_id: preferredMicrophoneId || null,
    })
    .eq("user_id", account.user.id)
    .select("preferred_camera_id, preferred_microphone_id, theme, appear_offline, show_recent_games")
    .single();
  if (error) throw error;
  return { ...account, preferences: data };
}

export async function listSavedCommanderDecks(account) {
  if (!account?.user?.id) return [];
  if (isMockAccount(account)) {
    return structuredClone((await getLocalMockData())?.saved_decks || []);
  }
  const supabase = getSupabase();
  const [deckResult, metadataResult] = await Promise.all([
    supabase
      .from("saved_commander_decks")
      .select("id, label, commander_name, commander_scryfall_id, partner_name, partner_scryfall_id, color_identity, sort_order")
      .eq("owner_id", account.user.id)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("saved_deck_profile_sort_metadata")
      .select("deck_id, average_cmc")
      .eq("owner_id", account.user.id),
  ]);
  if (deckResult.error) throw deckResult.error;
  if (metadataResult.error) throw metadataResult.error;
  const metadataByDeck = new Map((metadataResult.data || []).map((row) => [row.deck_id, row]));
  return (deckResult.data || []).map((deck) => ({
    ...deck,
    average_cmc: metadataByDeck.get(deck.id)?.average_cmc ?? null,
  }));
}

export async function getSavedCommanderDeck(account, deckId) {
  if (!account?.user?.id || !deckId) return null;
  if (isMockAccount(account)) {
    await materializeMockDeckFixture(deckId);
    const deck = (await getLocalMockData())?.saved_decks?.find((item) => item.id === deckId);
    return deck ? { ...structuredClone(deck), cards: structuredClone(deck.cards || []) } : null;
  }
  const [deckResult, cardsResult] = await Promise.all([
    getSupabase().from("saved_commander_decks")
      .select("id, label, commander_name, commander_scryfall_id, partner_name, partner_scryfall_id, color_identity, sort_order, source_provider, source_url, imported_at")
      .eq("owner_id", account.user.id).eq("id", deckId).single(),
    getSupabase().from("saved_deck_cards")
      .select("id, name, quantity, board, scryfall_id, oracle_id, set_code, collector_number, mana_value, type_line, colors, tags")
      .eq("owner_id", account.user.id).eq("deck_id", deckId).order("board").order("name"),
  ]);
  if (deckResult.error?.code === "PGRST116") return null;
  if (deckResult.error) throw deckResult.error;
  if (cardsResult.error) throw cardsResult.error;
  return { ...deckResult.data, cards: cardsResult.data || [] };
}

function mockScryfallMetadata(card) {
  return {
    name: card.name,
    scryfall_id: card.id || null,
    oracle_id: card.oracle_id || null,
    set_code: card.set || null,
    collector_number: card.collector_number || null,
    mana_value: Number.isFinite(Number(card.cmc)) ? Number(card.cmc) : null,
    type_line: card.type_line || null,
    colors: Array.isArray(card.colors) ? card.colors : [],
  };
}

async function fetchMockScryfallCard(name) {
  const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(String(name || "").trim())}`);
  if (!response.ok) throw new Error(`Could not find “${String(name || "").trim()}”.`);
  return response.json();
}

async function fetchMockScryfallPrinting(id) {
  const response = await fetch(`https://api.scryfall.com/cards/${encodeURIComponent(String(id || ""))}`);
  if (!response.ok) throw new Error("That printing was not found.");
  return response.json();
}

function cleanDeckTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((tag) => String(tag).trim().replace(/\s+/g, " ").slice(0, 32))
    .filter(Boolean))].slice(0, 8);
}

async function enrichMockCards(cards) {
  const found = new Map();
  try {
    for (let offset = 0; offset < cards.length; offset += 75) {
      const slice = cards.slice(offset, offset + 75);
      const response = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: slice.map((card) => ({ name: card.name.split(/\s+\/{2}\s+/)[0] })) }),
      });
      if (!response.ok) throw new Error("Card metadata unavailable");
      const payload = await response.json();
      for (const card of payload.data || []) found.set(card.name.toLocaleLowerCase("en-US"), card);
      if (offset + 75 < cards.length) await new Promise((resolve) => setTimeout(resolve, 75));
    }
  } catch {
    return cards;
  }
  return cards.map((card) => {
    const match = found.get(card.name.toLocaleLowerCase("en-US"));
    return match ? { ...card, ...mockScryfallMetadata(match), quantity: card.quantity, board: card.board } : card;
  });
}

async function materializeMockDeckFixture(deckId) {
  const mock = await getLocalMockData();
  const deck = mock?.saved_decks?.find((item) => item.id === deckId);
  if (!deck || deck.fixture_loaded || deck.source_fixture !== "ant-man") return;
  const cards = await enrichMockCards(parseDeckText(ANT_MAN_DECK_TEXT));
  await updateLocalMock((data) => {
    const target = data.saved_decks.find((item) => item.id === deckId);
    if (!target || target.fixture_loaded) return;
    target.cards = cards.map((card) => ({ id: crypto.randomUUID(), ...card }));
    target.fixture_loaded = true;
  });
}

async function postDeckAction(account, body) {
  if (!account?.access_token) throw new Error("Sign in to update this deck.");
  const response = await fetch("/api/decks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Deck update failed.");
  return payload;
}

async function fetchMockProviderDeck(source) {
  const endpoint = `/__deck-provider?provider=${encodeURIComponent(source.provider)}&id=${encodeURIComponent(source.id)}`;
  const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`);
  return parseArchidektDeck(await response.json());
}

async function replaceMockDeckCards(deckId, cards, source = {}) {
  const normalized = aggregateDeckCards(await enrichMockCards(cards));
  if (!normalized.length) throw new Error("No cards were found in that deck.");
  if (normalized.reduce((total, card) => total + card.quantity, 0) > 5000) {
    throw new Error("That deck contains too many cards.");
  }
  let storedCards = [];
  await updateLocalMock((data) => {
    const deck = data.saved_decks.find((item) => item.id === deckId);
    if (!deck) throw new Error("Deck not found.");
    deck.cards = normalized.map((card) => ({ id: crypto.randomUUID(), ...card }));
    storedCards = deck.cards;
    deck.source_provider = source.provider || "text";
    deck.source_url = source.url || null;
    deck.imported_at = new Date().toISOString();
  });
  return structuredClone(storedCards);
}

export async function importSavedDeckFromUrl(account, deckId, value) {
  if (isMockAccount(account)) {
    const source = parseDeckSourceUrl(value);
    const imported = await fetchMockProviderDeck(source);
    const cards = await replaceMockDeckCards(deckId, imported.cards, source);
    return { cards, sourceProvider: source.provider, sourceUrl: source.url, importedName: imported.name || null };
  }
  return postDeckAction(account, { action: "import_url", deckId, url: value });
}

export async function previewSavedDeckFromUrl(account, value) {
  const source = parseDeckSourceUrl(value);
  if (isMockAccount(account)) {
    const imported = await fetchMockProviderDeck(source);
    const commanders = imported.cards
      .filter((card) => card.board === "commander")
      .map((card) => card.name)
      .slice(0, 2);
    return {
      name: imported.name || null,
      commanders,
      totalCards: imported.cards.reduce((total, card) => total + card.quantity, 0),
      uniqueCards: imported.cards.length,
      sourceProvider: source.provider,
      sourceUrl: source.url,
    };
  }
  return postDeckAction(account, { action: "preview_url", url: source.url });
}

export async function importSavedDeckFromText(account, deckId, text, attributionUrl = "") {
  const attribution = attributionUrl ? parseDeckAttributionUrl(attributionUrl) : null;
  if (isMockAccount(account)) {
    const source = attribution || { provider: "text", url: null };
    const cards = await replaceMockDeckCards(deckId, parseDeckText(text), source);
    return { cards, sourceProvider: source.provider, sourceUrl: source.url, importedName: null };
  }
  return postDeckAction(account, { action: "import_text", deckId, text, sourceUrl: attribution?.url || null });
}

export async function addCardToSavedDeck(account, deckId, input) {
  if (isMockAccount(account)) {
    const card = await fetchMockScryfallCard(input.name);
    const board = normalizeDeckBoard(input.board);
    const quantity = Math.max(1, Math.min(99, Math.trunc(Number(input.quantity) || 1)));
    let saved;
    await updateLocalMock((data) => {
      const deck = data.saved_decks.find((item) => item.id === deckId);
      if (!deck) throw new Error("Deck not found.");
      deck.cards ||= [];
      const current = deck.cards.find((item) => item.board === board && item.name === card.name);
      if (current) {
        current.quantity = Math.min(999, current.quantity + quantity);
        saved = current;
      } else {
        saved = {
          id: crypto.randomUUID(),
          ...mockScryfallMetadata(card),
          quantity,
          board,
          tags: [],
        };
        deck.cards.push(saved);
      }
    });
    return { card: structuredClone(saved) };
  }
  return postDeckAction(account, { action: "add_card", deckId, ...input });
}

function mergeMockCard(deck, source, { board, quantity, metadata }) {
  const nextName = metadata?.name || source.name;
  const nextTags = cleanDeckTags(metadata?.tags ?? source.tags);
  const destination = deck.cards.find((card) => card.id !== source.id && card.board === board && card.name === nextName);
  if (destination) {
    destination.quantity = Math.min(999, Number(destination.quantity) + quantity);
    destination.tags = cleanDeckTags([...(destination.tags || []), ...nextTags]);
    deck.cards = deck.cards.filter((card) => card.id !== source.id);
    return { card: destination, removedId: source.id };
  }
  Object.assign(source, metadata || {}, { tags: nextTags, board, quantity });
  return { card: source, removedId: null };
}

export async function updateCardInSavedDeck(account, deckId, cardId, input) {
  if (isMockAccount(account)) {
    let result;
    await updateLocalMock((data) => {
      const deck = data.saved_decks.find((item) => item.id === deckId);
      const source = deck?.cards?.find((card) => card.id === cardId);
      if (!source) throw new Error("Card not found.");
      result = mergeMockCard(deck, source, {
        board: normalizeDeckBoard(input.board || source.board),
        quantity: Math.max(1, Math.min(999, Math.trunc(Number(input.quantity) || 1))),
        metadata: { tags: cleanDeckTags(input.tags ?? source.tags) },
      });
    });
    return structuredClone(result);
  }
  return postDeckAction(account, { action: "update_card", deckId, cardId, ...input });
}

export async function replaceCardInSavedDeck(account, deckId, cardId, name) {
  if (isMockAccount(account)) {
    const replacement = await fetchMockScryfallCard(name);
    let result;
    await updateLocalMock((data) => {
      const deck = data.saved_decks.find((item) => item.id === deckId);
      const source = deck?.cards?.find((card) => card.id === cardId);
      if (!source) throw new Error("Card not found.");
      result = mergeMockCard(deck, source, {
        board: source.board,
        quantity: source.quantity,
        metadata: mockScryfallMetadata(replacement),
      });
    });
    return structuredClone(result);
  }
  return postDeckAction(account, { action: "replace_card", deckId, cardId, name });
}

export async function updateCardPrintingInSavedDeck(account, deckId, cardId, scryfallId) {
  if (isMockAccount(account)) {
    const printing = await fetchMockScryfallPrinting(scryfallId);
    let saved;
    await updateLocalMock((data) => {
      const deck = data.saved_decks.find((item) => item.id === deckId);
      const source = deck?.cards?.find((card) => card.id === cardId);
      if (!source) throw new Error("Card not found.");
      const sameOracle = source.oracle_id && printing.oracle_id === source.oracle_id;
      const sameName = String(printing.name || "").toLocaleLowerCase("en-US") === source.name.toLocaleLowerCase("en-US");
      if (!sameOracle && !sameName) throw new Error("Choose artwork for the same card.");
      Object.assign(source, mockScryfallMetadata(printing));
      saved = source;
    });
    return { card: structuredClone(saved) };
  }
  return postDeckAction(account, { action: "set_card_printing", deckId, cardId, scryfallId });
}

export async function deleteCardFromSavedDeck(account, deckId, cardId) {
  if (isMockAccount(account)) {
    await updateLocalMock((data) => {
      const deck = data.saved_decks.find((item) => item.id === deckId);
      if (!deck?.cards?.some((card) => card.id === cardId)) throw new Error("Card not found.");
      deck.cards = deck.cards.filter((card) => card.id !== cardId);
    });
    return { removedId: cardId };
  }
  return postDeckAction(account, { action: "delete_card", deckId, cardId });
}

export async function createSavedCommanderDeck(account, deck) {
  if (!account?.user?.id || !account?.access_token) throw new Error("Sign in to save a Commander deck.");
  if (isMockAccount(account)) {
    const saved = {
      id: crypto.randomUUID(),
      label: String(deck.label || "").trim(),
      commander_name: String(deck.commanderName || "").trim(),
      commander_scryfall_id: deck.commanderScryfallId || null,
      partner_name: String(deck.partnerName || "").trim() || null,
      partner_scryfall_id: deck.partnerScryfallId || null,
      color_identity: Array.isArray(deck.colorIdentity) ? deck.colorIdentity : [],
      sort_order: Number(deck.sortOrder) || 0,
    };
    await updateLocalMock((data) => data.saved_decks.push(saved));
    return saved;
  }
  const response = await fetch("/api/commanders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "save_deck",
      label: String(deck.label || "").trim(),
      commanderName: String(deck.commanderName || "").trim(),
      commanderScryfallId: deck.commanderScryfallId || null,
      partnerName: String(deck.partnerName || "").trim() || null,
      partnerScryfallId: deck.partnerScryfallId || null,
      sortOrder: Number(deck.sortOrder) || 0,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Commander deck could not be saved.");
  return payload.deck;
}

export async function deleteSavedCommanderDeck(account, deckId) {
  if (!account?.user?.id) throw new Error("Sign in to remove a Commander deck.");
  if (isMockAccount(account)) {
    await updateLocalMock((data) => {
      data.saved_decks = data.saved_decks.filter((deck) => deck.id !== deckId);
    });
    return;
  }
  const { error } = await getSupabase()
    .from("saved_commander_decks")
    .delete()
    .eq("owner_id", account.user.id)
    .eq("id", deckId);
  if (error) throw error;
}

export async function getPublicProfile(profileId) {
  if (!profileId) return null;
  const mock = await getLocalMockData();
  if (mock) {
    const data = mock.profiles?.[profileId]?.data;
    if (!data) return null;
    const relationship = profileId === mock.account?.user?.id
      ? "self"
      : mock.social?.friends?.some((friend) => friend.id === profileId)
        ? "friend"
        : "none";
    const publicProfile = structuredClone(data);
    if (relationship === "none") delete publicProfile.profile?.discord_username;
    const decks = publicProfile.decks || (profileId === mock.account?.user?.id
      ? structuredClone(mock.saved_decks || [])
      : []);
    if (!["self", "friend"].includes(relationship)) {
      return {
        profile: publicProfile.profile,
        relationship,
        stats_visible: false,
        decks,
      };
    }
    return {
      ...publicProfile,
      relationship,
      stats_visible: true,
      decks,
    };
  }
  if (!isSupabaseConfigured()) return null;
  const [profileResult, deckResult, relationshipResult] = await Promise.all([
    getSupabase().rpc("get_public_profile", { target_profile_id: profileId }),
    getSupabase().rpc("get_public_profile_decks", { target_profile_id: profileId }),
    getSupabase().rpc("get_public_profile_relationship", { target_profile_id: profileId }),
  ]);
  const error = profileResult.error || deckResult.error || relationshipResult.error;
  if (error) throw error;
  return profileResult.data ? {
    ...profileResult.data,
    decks: deckResult.data || [],
    relationship: relationshipResult.data || profileResult.data.relationship || "none",
  } : null;
}

export async function getPublicSavedDeck(deckId) {
  if (!deckId) return null;
  const mock = await getLocalMockData();
  if (mock) {
    await materializeMockDeckFixture(deckId);
    const ownerEntry = Object.values(mock.profiles || {}).find((entry) => (
      (entry.data?.decks || []).some((deck) => deck.id === deckId)
    ));
    const publicDeck = ownerEntry?.data?.decks?.find((deck) => deck.id === deckId);
    const ownedDeck = (mock.saved_decks || []).find((deck) => deck.id === deckId);
    const deck = publicDeck || ownedDeck;
    if (!deck) return null;
    const owner = ownerEntry?.data?.profile || mock.account?.profile;
    return { ...structuredClone(deck), owner: structuredClone(owner) };
  }
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabase().rpc("get_public_saved_deck", {
    target_deck_id: deckId,
  });
  if (error) throw error;
  return data;
}

export async function searchPublicProfiles(query, limit = 8) {
  const cleanQuery = String(query || "").trim();
  if (cleanQuery.length < 2) return [];
  const mock = await getLocalMockData();
  if (mock) {
    return Object.values(mock.profiles || {})
      .map((entry) => entry.data?.profile)
      .filter(Boolean)
      .filter((profile) => profile.display_name.toLowerCase().includes(cleanQuery.toLowerCase()))
      .slice(0, limit)
      .map((profile) => structuredClone(profile));
  }
  const { data, error } = await getSupabase().rpc("search_public_profiles", {
    search_text: cleanQuery,
    result_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function getProfileMatchups(profileId) {
  const mock = await getLocalMockData();
  if (mock) {
    return structuredClone(mock.profiles?.[profileId]?.matchups || { opponents: [], commanders: [] });
  }
  const { data, error } = await getSupabase().rpc("get_profile_matchups", {
    target_profile_id: profileId,
  });
  if (error) throw error;
  return data || { opponents: [], commanders: [] };
}

export async function getMyGameHistory(limit = 30) {
  const mock = await getLocalMockData();
  if (mock) return structuredClone((mock.history || []).slice(0, limit));
  const { data, error } = await getSupabase().rpc("get_my_game_history", {
    result_limit: limit,
  });
  if (error) throw error;
  return data || [];
}

export async function setMyGameVisibility(sessionId, hidden) {
  const mock = await getLocalMockData();
  if (mock) {
    await updateLocalMock((data) => {
      const game = data.history.find((entry) => entry.session_id === sessionId);
      if (game) game.hidden_by_player = Boolean(hidden);
    });
    return true;
  }
  const { data, error } = await getSupabase().rpc("set_my_game_visibility", {
    target_session_id: sessionId,
    hide_game: Boolean(hidden),
  });
  if (error) throw error;
  return Boolean(data);
}

export async function getSocialDashboard() {
  const mock = await getLocalMockData();
  if (mock) return structuredClone(mock.social || { friends: [], notifications: [] });
  const { data, error } = await getSupabase().rpc("list_social_dashboard");
  if (error) throw error;
  return data || { friends: [], notifications: [] };
}

export function subscribeToNotifications(account, callback) {
  if (isMockAccount(account)) return () => {};
  if (!account?.user?.id || !isSupabaseConfigured()) return () => {};
  const channel = getSupabase()
    .channel(`profile-notifications-${account.user.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "profile_notifications",
        filter: `recipient_id=eq.${account.user.id}`,
      },
      callback,
    )
    .subscribe();
  return () => getSupabase().removeChannel(channel);
}

export async function markNotificationsRead(account) {
  if (!account?.user?.id) return;
  if (isMockAccount(account)) {
    await updateLocalMock((data) => {
      for (const notification of data.social.notifications || []) {
        notification.read_at ||= new Date().toISOString();
      }
    });
    return;
  }
  const { error } = await getSupabase().rpc("mark_my_notifications_read");
  if (error) throw error;
}

export async function dismissNotification(notificationId) {
  const mock = await getLocalMockData();
  if (mock) {
    await updateLocalMock((data) => {
      data.social.notifications = data.social.notifications.filter((item) => item.id !== notificationId);
    });
    return true;
  }
  const { data, error } = await getSupabase().rpc("dismiss_my_notification", {
    target_notification_id: notificationId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function sendFriendRequest(profileId) {
  if (await getLocalMockData()) return `mock-friend-request-${profileId}`;
  const { data, error } = await getSupabase().rpc("send_friend_request", {
    target_profile_id: profileId,
  });
  if (error) throw error;
  return data;
}

export async function respondFriendRequest(requestId, accept) {
  if (await getLocalMockData()) {
    await updateLocalMock((data) => {
      const notification = (data.social.notifications || []).find((item) => (
        item.kind === "friend_request" && item.reference_id === requestId
      ));
      if (accept && notification?.actor && !data.social.friends.some((friend) => friend.id === notification.actor.id)) {
        data.social.friends.push({ ...notification.actor, status: "offline" });
      }
      data.social.notifications = (data.social.notifications || []).filter((item) => item.reference_id !== requestId);
    });
    return Boolean(accept);
  }
  const { data, error } = await getSupabase().rpc("respond_friend_request", {
    target_request_id: requestId,
    accept_request: Boolean(accept),
  });
  if (error) throw error;
  return Boolean(data);
}

export async function blockPlayer(profileId) {
  if (await getLocalMockData()) return true;
  const { data, error } = await getSupabase().rpc("block_player", {
    target_profile_id: profileId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function removeFriend(profileId) {
  const mock = await getLocalMockData();
  if (mock) {
    await updateLocalMock((data) => {
      data.social.friends = data.social.friends.filter((friend) => friend.id !== profileId);
    });
    return true;
  }
  const { data, error } = await getSupabase().rpc("remove_friend", {
    target_profile_id: profileId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function updatePresence(status, gameId = null) {
  if (await getLocalMockData()) return true;
  const { data, error } = await getSupabase().rpc("update_my_presence", {
    requested_status: status,
    target_game_id: gameId,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function exportMyAccountData() {
  const mock = await getLocalMockData();
  if (mock) return structuredClone({
    profile: mock.account.profile,
    preferences: mock.account.preferences,
    history: mock.history,
    friends: mock.social.friends,
    saved_decks: mock.saved_decks,
  });
  const { data, error } = await getSupabase().rpc("get_my_account_export");
  if (error) throw error;
  return data;
}

export async function requestAccountDeletion() {
  const { data, error } = await getSupabase().rpc("request_account_deletion");
  if (error) throw error;
  return data;
}

export async function getAccountDeletionStatus() {
  if (await getLocalMockData()) return {};
  const { data, error } = await getSupabase().rpc("get_my_account_deletion_status");
  if (error) throw error;
  return data || {};
}

export async function cancelAccountDeletion() {
  const { data, error } = await getSupabase().rpc("cancel_account_deletion");
  if (error) throw error;
  localStorage.removeItem("sc-account-deletion-deadline");
  return Boolean(data);
}

export async function finalizeAccountDeletion(account) {
  if (!account?.access_token) throw new Error("Sign in again before deleting your account.");
  const response = await fetch("/api/account-delete", {
    method: "POST",
    headers: { Authorization: `Bearer ${account.access_token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Could not finalize account deletion.");
  localStorage.removeItem("sc-account-deletion-deadline");
  return true;
}

export async function respondGameInvitation(invitationId, accept) {
  if (await getLocalMockData()) return { accepted: Boolean(accept), code: null };
  const { data, error } = await getSupabase().rpc("respond_game_invitation", {
    target_invitation_id: invitationId,
    accept_invitation: Boolean(accept),
  });
  if (error) throw error;
  return data;
}

export async function getReviewEligibleProfiles(sessionId) {
  if (await getLocalMockData()) return [];
  const { data, error } = await getSupabase().rpc("get_review_eligible_profiles", {
    target_session_id: sessionId,
  });
  if (error) throw error;
  return data || [];
}

export async function submitPlayerReview({ profileId, sessionId, rating, comment }) {
  if (await getLocalMockData()) return crypto.randomUUID();
  const { data, error } = await getSupabase().rpc("submit_player_review", {
    target_profile_id: profileId,
    target_session_id: sessionId,
    review_rating: rating,
    review_comment: comment || null,
  });
  if (error) throw error;
  return data;
}

export async function getMyReceivedReviews() {
  const mock = await getLocalMockData();
  if (mock) return structuredClone(mock.received_reviews || []);
  const { data, error } = await getSupabase().rpc("get_my_received_reviews");
  if (error) throw error;
  return data || [];
}

export async function getMySentReviews() {
  const mock = await getLocalMockData();
  if (mock) return structuredClone(mock.sent_reviews || []);
  const { data, error } = await getSupabase().rpc("get_my_sent_reviews");
  if (error) throw error;
  return data || [];
}

export async function updateMyPlayerReview(reviewId, rating, comment = "") {
  if (await getLocalMockData()) return true;
  const { data, error } = await getSupabase().rpc("update_my_player_review", {
    target_review_id: reviewId,
    review_rating: rating,
    review_comment: comment || null,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function getMyModerationCases() {
  if (await getLocalMockData()) return [];
  const { data, error } = await getSupabase().rpc("get_my_moderation_cases");
  if (error) throw error;
  return data || [];
}

export async function submitModerationAppeal(reportId, reason) {
  const { data, error } = await getSupabase().rpc("submit_moderation_appeal", {
    target_report_id: reportId,
    appeal_reason: reason,
  });
  if (error) throw error;
  return data;
}

export async function reportPlayerReview(reviewId, reason, details = "") {
  const { data, error } = await getSupabase().rpc("report_player_review", {
    target_review_id: reviewId,
    report_reason: reason,
    report_details: details || null,
  });
  if (error) throw error;
  return data;
}

export async function isModerator() {
  const { data, error } = await getSupabase().rpc("is_snapcast_moderator");
  if (error) throw error;
  return Boolean(data);
}

export async function getModerationQueue() {
  const { data, error } = await getSupabase().rpc("get_moderation_queue");
  if (error) throw error;
  return data || { reports: [], corrections: [], appeals: [] };
}

export async function resolveGameCorrection({ correctionId, accept, resolution }) {
  const { data, error } = await getSupabase().rpc("resolve_game_correction", {
    target_correction_id: correctionId,
    accept_correction: Boolean(accept),
    resolution: resolution || null,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function resolveModerationReport({
  reportId,
  status,
  resolution,
  removeReview = false,
}) {
  const { data, error } = await getSupabase().rpc("resolve_moderation_report", {
    target_report_id: reportId,
    target_status: status,
    resolution: resolution || null,
    remove_review: Boolean(removeReview),
  });
  if (error) throw error;
  return Boolean(data);
}

export async function resolveModerationAppeal({ appealId, status, resolution }) {
  const { data, error } = await getSupabase().rpc("resolve_moderation_appeal", {
    target_appeal_id: appealId,
    target_status: status,
    resolution,
  });
  if (error) throw error;
  return Boolean(data);
}

export function takePendingGame() {
  const raw = sessionStorage.getItem(PENDING_GAME_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(PENDING_GAME_KEY);
  try {
    const value = JSON.parse(raw);
    if (!value?.code || !value?.name || !value?.role) return null;
    return value;
  } catch {
    return null;
  }
}
