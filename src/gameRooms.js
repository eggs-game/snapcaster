import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import {
  getLocalMockData,
  getLocalMockGame,
  makeLocalMockGameSession,
} from "./localMock.js";

const ROOM_CAPABILITIES_KEY = "sc-room-capabilities";

function makeCapabilityToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function readCapabilities() {
  try {
    const value = JSON.parse(sessionStorage.getItem(ROOM_CAPABILITIES_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function rememberCapability(code, value) {
  const capabilities = readCapabilities();
  capabilities[code] = value;
  sessionStorage.setItem(ROOM_CAPABILITIES_KEY, JSON.stringify(capabilities));
}

export function roomCapability(code) {
  return readCapabilities()[code] || null;
}

function requireConfigured() {
  if (!isSupabaseConfigured()) throw new Error("Public games are not configured for this deployment.");
  return getSupabase();
}

async function ensureGameIdentity() {
  const supabase = requireConfigured();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user?.id) return sessionData.session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error("Guest game identity is unavailable. Enable anonymous sign-ins in Supabase.");
  }
  return data.user;
}

async function resolveRealtimeEpoch(data, membershipId, participantToken) {
  if (data?.realtime_epoch) return data.realtime_epoch;
  const { data: epoch, error } = await requireConfigured().rpc("get_realtime_room_epoch", {
    target_membership_id: membershipId,
    participant_token: participantToken,
  });
  if (error || !epoch) throw error || new Error("Private game channel is unavailable.");
  return epoch;
}

export async function createGameRoom({
  code,
  name,
  bracket,
  visibility,
  seatLimit,
  displayName,
}) {
  await ensureGameIdentity();
  const ownerToken = makeCapabilityToken();
  const { data, error } = await requireConfigured().rpc("create_game_room", {
    room_code: code,
    room_name: name,
    room_bracket: bracket,
    room_visibility: visibility,
    room_seat_limit: seatLimit,
    owner_token: ownerToken,
    owner_display_name: displayName,
  });
  if (error) throw error;
  const realtimeEpoch = await resolveRealtimeEpoch(data, data.membership_id, ownerToken);
  const capability = {
    gameId: data.game_id,
    membershipId: data.membership_id,
    participantToken: ownerToken,
    ownerToken,
    realtimeEpoch,
  };
  rememberCapability(code, capability);
  return capability;
}

export async function joinGameRoom({ code, displayName, role }) {
  const localRoom = await getLocalMockGame(code);
  if (localRoom) {
    const mockGame = await makeLocalMockGameSession(localRoom, displayName, role);
    return {
      gameId: localRoom.game_id,
      membershipId: mockGame.roster.find((member) => member.id === mockGame.localId).membershipId,
      participantToken: `mock-participant-${localRoom.code}`,
      ownerToken: localRoom.mock_owner ? `mock-owner-${localRoom.code}` : null,
      seatLimit: localRoom.seat_limit,
      lobbyName: localRoom.name,
      bracket: localRoom.bracket,
      visibility: localRoom.visibility,
      realtimeEpoch: "local-mock",
      roomStatus: localRoom.status,
      creator: Boolean(localRoom.mock_owner),
      mockGame,
    };
  }
  await ensureGameIdentity();
  const participantToken = makeCapabilityToken();
  const { data, error } = await requireConfigured().rpc("join_game_room", {
    room_code: code,
    participant_token: participantToken,
    participant_name: displayName,
    participant_role: role,
  });
  if (error) throw error;
  const realtimeEpoch = await resolveRealtimeEpoch(data, data.membership_id, participantToken);
  const capability = {
    gameId: data.game_id,
    membershipId: data.membership_id,
    participantToken,
    ownerToken: null,
    seatLimit: data.seat_limit,
    realtimeEpoch,
  };
  rememberCapability(code, capability);
  return capability;
}

export async function listPublicGameRooms({
  status = null,
  bracket = null,
  openSeatsOnly = false,
  search = null,
  playerCount = null,
  seatLimit = null,
  limit = 24,
} = {}) {
  const mock = await getLocalMockData();
  if (mock) {
    return mock.games
      .filter((game) => game.visibility === "public")
      .filter((game) => status == null || game.status === status)
      .filter((game) => bracket == null || Number(game.bracket) === Number(bracket))
      .filter((game) => !openSeatsOnly || (game.status === "lobby" && Number(game.player_count) < Number(game.seat_limit)))
      .filter((game) => playerCount == null || Number(game.player_count) === Number(playerCount))
      .filter((game) => seatLimit == null || Number(game.seat_limit) === Number(seatLimit))
      .filter((game) => {
        const query = String(search || "").trim().toLowerCase();
        if (!query) return true;
        return game.name.toLowerCase().includes(query)
          || (game.commanders || []).some((commander) => commander.toLowerCase().includes(query));
      })
      .slice(0, limit);
  }
  if (!isSupabaseConfigured()) return [];
  const needsClientCountFilter = (
    (playerCount != null && Number.isInteger(Number(playerCount)))
    || (seatLimit != null && Number.isInteger(Number(seatLimit)))
  );
  const params = {
    requested_status: status,
    requested_bracket: bracket,
    open_seats_only: openSeatsOnly,
    search_text: search || null,
    result_limit: needsClientCountFilter ? 50 : limit,
  };
  let { data, error } = await getSupabase().rpc("list_public_game_rooms_with_cards", params);
  if (error?.code === "PGRST202" || error?.message?.includes("list_public_game_rooms_with_cards")) {
    ({ data, error } = await getSupabase().rpc("list_public_game_rooms", params));
  }
  if (error) throw error;
  return (data || [])
    .filter((game) => playerCount == null || Number(game.player_count) === Number(playerCount))
    .filter((game) => seatLimit == null || Number(game.seat_limit) === Number(seatLimit))
    .slice(0, limit);
}

export async function touchGameMembership({
  membershipId,
  participantToken,
}) {
  if (String(participantToken || "").startsWith("mock-participant-")) return { active: true };
  if (!membershipId || !participantToken || !isSupabaseConfigured()) return false;
  const { data, error } = await getSupabase().rpc("touch_game_membership", {
    membership_id: membershipId,
    participant_token: participantToken,
  });
  if (error) throw error;
  return data || { active: false };
}

export async function validateGameCommanderSelection({
  membershipId,
  participantToken,
  commanderName,
  commanderScryfallId = null,
  partnerName = null,
  partnerScryfallId = null,
}) {
  if (String(participantToken || "").startsWith("mock-participant-")) {
    return {
      commander: { name: String(commanderName || "").trim(), scryfallId: commanderScryfallId, typeLine: "" },
      partner: partnerName
        ? { name: String(partnerName).trim(), scryfallId: partnerScryfallId, typeLine: "" }
        : null,
    };
  }
  const supabase = requireConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.access_token) throw new Error("Your game identity expired. Rejoin the room.");
  const response = await fetch("/api/commanders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "set_membership",
      membershipId,
      participantToken,
      commanderName,
      commanderScryfallId,
      partnerName,
      partnerScryfallId,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Commander selection could not be validated.");
  return payload;
}

export async function leaveGameRoom({ membershipId, participantToken }) {
  if (String(participantToken || "").startsWith("mock-participant-")) return true;
  if (!membershipId || !participantToken || !isSupabaseConfigured()) return false;
  const { data, error } = await getSupabase().rpc("leave_game_room", {
    membership_id: membershipId,
    participant_token: participantToken,
  });
  if (error) throw error;
  return Boolean(data);
}

function idempotencyKey() {
  return crypto.randomUUID();
}

export async function startDurableGame({ gameId, ownerToken }) {
  const { data, error } = await requireConfigured().rpc("owner_start_game", {
    target_room_id: gameId,
    owner_token: ownerToken,
    idempotency_key: idempotencyKey(),
  });
  if (error) throw error;
  return data;
}

export async function manageGameMember({ gameId, ownerToken, membershipId, action }) {
  const { data, error } = await requireConfigured().rpc("owner_manage_member", {
    target_room_id: gameId,
    owner_token: ownerToken,
    target_membership_id: membershipId,
    requested_action: action,
    idempotency_key: idempotencyKey(),
  });
  if (error) throw error;
  return Boolean(data);
}

export async function recordGameTurn({
  sessionId,
  membershipId,
  participantToken,
  nextMembershipId,
}) {
  if (!sessionId || !membershipId || !participantToken || !nextMembershipId) return null;
  const { data, error } = await requireConfigured().rpc("record_game_turn", {
    target_session_id: sessionId,
    acting_membership_id: membershipId,
    participant_token: participantToken,
    next_membership_id: nextMembershipId,
    idempotency_key: idempotencyKey(),
  });
  if (error) throw error;
  return data;
}

export async function endDurableGame({
  gameId,
  ownerToken,
  resultKind,
  winnerMembershipId,
  finalSnapshot,
}) {
  const { data, error } = await requireConfigured().rpc("owner_end_game", {
    target_room_id: gameId,
    owner_token: ownerToken,
    p_result_kind: resultKind,
    p_winner_membership_id: winnerMembershipId || null,
    final_snapshot: finalSnapshot,
    idempotency_key: idempotencyKey(),
  });
  if (error) throw error;
  return data;
}

export async function restartDurableGame({ gameId, ownerToken }) {
  const { data, error } = await requireConfigured().rpc("owner_restart_game", {
    target_room_id: gameId,
    owner_token: ownerToken,
    idempotency_key: idempotencyKey(),
  });
  if (error) throw error;
  return data;
}

export async function inviteFriendToGame({ gameId, ownerToken, profileId }) {
  if (String(ownerToken || "").startsWith("mock-owner-")) return crypto.randomUUID();
  const { data, error } = await requireConfigured().rpc("create_game_invitation", {
    target_game_id: gameId,
    target_profile_id: profileId,
    owner_token: ownerToken,
  });
  if (error) throw error;
  return data;
}

export async function cancelGameInvitation({ invitationId, ownerToken }) {
  if (String(ownerToken || "").startsWith("mock-owner-")) return true;
  const { data, error } = await requireConfigured().rpc("cancel_game_invitation", {
    target_invitation_id: invitationId,
    owner_token: ownerToken,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function claimGameOwnership({ gameId, membershipId, participantToken }) {
  const { data, error } = await requireConfigured().rpc("claim_game_ownership", {
    target_room_id: gameId,
    acting_membership_id: membershipId,
    participant_token: participantToken,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function getGameMembershipStates({ gameId, membershipId, participantToken }) {
  const { data, error } = await requireConfigured().rpc("get_game_membership_states", {
    target_game_id: gameId,
    acting_membership_id: membershipId,
    participant_token: participantToken,
  });
  if (error) throw error;
  return data || [];
}

export async function claimGuestGameMembership({ membershipId, participantToken }) {
  if (String(participantToken || "").startsWith("mock-participant-")) return 1;
  if (!membershipId || !participantToken) return 0;
  const { data, error } = await requireConfigured().rpc("claim_guest_game_membership", {
    target_membership_id: membershipId,
    participant_token: participantToken,
  });
  if (error) throw error;
  return Number(data) || 0;
}

export async function submitGameCorrection({
  sessionId,
  membershipId,
  participantToken,
  reason,
  proposedSnapshot,
}) {
  const { data, error } = await requireConfigured().rpc("submit_game_correction", {
    target_session_id: sessionId,
    acting_membership_id: membershipId,
    participant_token: participantToken,
    reason,
    proposed_snapshot: proposedSnapshot,
  });
  if (error) throw error;
  return data;
}
