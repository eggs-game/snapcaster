import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import { getLocalMockData, isMockAccount, updateLocalMock } from "./localMock.js";

const PENDING_GAME_KEY = "sc-pending-game";

export function accountDisplayName(account) {
  if (account?.profile?.display_name) return account.profile.display_name;
  const metadata = account?.user?.user_metadata || {};
  return metadata.global_name || metadata.full_name || metadata.name || metadata.user_name || "Snapcast player";
}

export function accountAvatarUrl(account) {
  if (account?.profile?.avatar_url) return account.profile.avatar_url;
  const metadata = account?.user?.user_metadata || {};
  return metadata.avatar_url || metadata.picture || "";
}

async function hydrateAccount(session) {
  if (!session?.user?.id) return null;
  if (session.user.is_anonymous) return null;
  const supabase = getSupabase();
  const [profileResult, preferencesResult, privateResult] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar_url, created_at, updated_at").eq("id", session.user.id).single(),
    supabase.from("account_preferences").select("preferred_camera_id, preferred_microphone_id, theme, appear_offline, show_recent_games").eq("user_id", session.user.id).single(),
    supabase.from("account_private").select("email, email_verified").eq("user_id", session.user.id).single(),
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
  const { data, error } = await getSupabase()
    .from("saved_commander_decks")
    .select("id, label, commander_name, commander_scryfall_id, partner_name, partner_scryfall_id, color_identity, sort_order")
    .eq("owner_id", account.user.id)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return data || [];
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
    return {
      ...structuredClone(data),
      relationship: mock.social?.friends?.some((friend) => friend.id === profileId)
        ? "friend"
        : "none",
    };
  }
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabase().rpc("get_public_profile", {
    target_profile_id: profileId,
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
  if (await getLocalMockData()) return Boolean(accept);
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
