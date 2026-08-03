const MOCK_DATA_URL = "/mock-data.local.json";
const MOCK_SESSION_KEY = "snapcast-local-mock-state";
let mockPromise;
let mutableData;

function validMockData(data) {
  return Boolean(data?.enabled && data.account?.user?.id && Array.isArray(data.games));
}

function restoreSessionMock(fixture) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(MOCK_SESSION_KEY) || "null");
    if (validMockData(stored) && stored.account.user.id === fixture.account.user.id) return stored;
  } catch { /* use the working-copy fixture */ }
  return fixture;
}

function persistSessionMock(data) {
  try { sessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(data)); } catch { /* memory state still works */ }
}

export function isLoopbackHost() {
  return ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);
}

export async function getLocalMockData() {
  if (!isLoopbackHost()) return null;
  if (!mockPromise) {
    mockPromise = fetch(MOCK_DATA_URL, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!validMockData(data)) return null;
        mutableData = structuredClone(restoreSessionMock(data));
        return mutableData;
      })
      .catch(() => null);
  }
  return mockPromise;
}

export function isMockAccount(account) {
  return Boolean(account?.localMock);
}

export async function updateLocalMock(mutator) {
  const data = await getLocalMockData();
  if (!data) return null;
  mutator(data);
  persistSessionMock(data);
  return data;
}

export async function getLocalMockGame(code) {
  const data = await getLocalMockData();
  return data?.games?.find((game) => game.code === String(code || "").toUpperCase()) || null;
}

export async function makeLocalMockGameSession(game, displayName, role) {
  const data = await getLocalMockData();
  if (!data || !game) return null;
  const safeRole = role === "visitor" ? "visitor" : "player";
  if (game.status === "live" && safeRole !== "visitor") throw new Error("Live mock games accept visitors only.");
  if (safeRole === "player" && Number(game.player_count) >= Number(game.seat_limit)) {
    throw new Error("That mock table is full.");
  }
  if (safeRole === "visitor" && Number(game.visitor_count) >= 8) {
    throw new Error("That mock visitor room is full.");
  }

  const localId = "mock-local-player";
  const localMembershipId = "00000000-0000-4000-8000-000000000001";
  const mockRoster = game.mock_roster || [];
  const seededRoster = mockRoster.map((member, index) => ({
    ...member,
    joinedAt: Date.now() - (mockRoster.length - index + 1) * 1000,
  }));
  const roster = [
    ...seededRoster,
    {
      id: localId,
      name: displayName,
      role: safeRole,
      membershipId: localMembershipId,
      profileId: data.account.user.id,
      joinedAt: Date.now(),
    },
  ];
  return {
    localId,
    roster,
    status: game.status,
    startedAt: game.started_at || (game.status === "live"
      ? new Date(Date.now() - 45 * 60 * 1000).toISOString()
      : ""),
    commanders: { ...(game.mock_state?.commanders || {}) },
    commanderPartners: { ...(game.mock_state?.commander_partners || {}) },
    commanderPartnerTypes: { ...(game.mock_state?.commander_partner_types || {}) },
    colors: { ...(game.mock_state?.colors || {}) },
    lives: { ...(game.mock_state?.lives || {}), ...(safeRole === "player" ? { [localId]: 40 } : {}) },
    poison: { ...(game.mock_state?.poison || {}) },
    commanderDamage: { ...(game.mock_state?.commander_damage || {}) },
    activePlayerId: game.mock_state?.active_player_id || seededRoster.find((member) => member.role === "player")?.id || "",
    chat: [...(game.mock_state?.chat || [])],
  };
}
