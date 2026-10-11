import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  entryPoints: [path.join(root, "src/gameRooms.js")], bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "offline-auth-boundary", setup(api) {
    api.onLoad({ filter: /src\/supabase\.js$/ }, () => ({ contents: `
      export function isSupabaseConfigured() { return Boolean(globalThis.__roomTestSupabase); }
      export function getSupabase() { return globalThis.__roomTestSupabase; }
    `, loader: "js" }));
  } }],
  logLevel: "silent",
});
const sourceUrl = "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64");
const saved = { window: globalThis.window, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
const storage = new Map();
const calls = [];
const membershipId = "00000000-0000-4000-8000-000000000001";
const participantToken = "mock-participant-MOCK01";
const activeSession = {
  code: "MOCK01", membershipId, participantToken,
  mockGame: { localId: "mock-local-player", roster: [{ id: "mock-local-player", membershipId, role: "player" }] },
};
const fixture = { enabled: true, account: { user: { id: "10000000-0000-4000-8000-000000000001" } }, games: [{ code: "MOCK01" }] };
const cards = new Map([
  ["Malcolm, Keen-Eyed Navigator", { id: "dd85fd88-7e5b-494a-9106-c78602604a1d", name: "Malcolm, Keen-Eyed Navigator", type_line: "Legendary Creature — Siren Pirate", oracle_text: "Partner" }],
  ["Breeches, Brazen Plunderer", { id: "83e8fe2e-ec6c-47fc-85c0-6eec185ecdce", name: "Breeches, Brazen Plunderer", type_line: "Legendary Creature — Goblin Pirate", oracle_text: "Partner" }],
  ["Sol Ring", { id: "e07f656c-97b5-4147-821a-edbb49f34e19", name: "Sol Ring", type_line: "Artifact", oracle_text: "{T}: Add {C}{C}." }],
  ["Atraxa, Praetors' Voice", { id: "d0d33d52-3d28-4635-b985-51e126289259", name: "Atraxa, Praetors' Voice", type_line: "Legendary Creature — Phyrexian Angel Horror", oracle_text: "Flying, vigilance, deathtouch, lifelink" }],
  ["Wilson, Refined Grizzly", { id: "542a160b-bb44-4527-b595-42ae9357a94e", name: "Wilson, Refined Grizzly", type_line: "Legendary Creature — Bear Warrior", oracle_text: "Choose a Background" }],
  ["Feywild Visitor", { id: "b23cdac1-bf6f-46d4-a8f8-d4d30cd0a4f1", name: "Feywild Visitor", type_line: "Legendary Enchantment — Background", oracle_text: "" }],
]);
// These are real indexed printings with only the rule-bearing Oracle/type
// fields retained. The fixture must never invent a card to make pairing pass.
const catalog = JSON.parse(await readFile(path.join(root, "public/carddata/cards.json"), "utf8"));
for (const card of cards.values()) assert.ok(catalog.some((row) => row[0] === card.name && row[3] === card.id));
globalThis.window = { location: { hostname: "127.0.0.1" } };
globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  if (url === "/mock-data.local.json") return { ok: true, json: async () => fixture };
  if (url === "/api/commanders") return { ok: true, json: async () => ({ commander: { name: "Server-validated response" }, partner: null }) };
  const request = new URL(url);
  assert.equal(request.origin, "https://api.scryfall.com");
  assert.equal(request.pathname, "/cards/named");
  const card = cards.get(request.searchParams.get("fuzzy"));
  return { ok: Boolean(card), status: card ? 200 : 404, json: async () => card };
};
const resetSession = (session = activeSession) => storage.set("snapcast-active-room", JSON.stringify(session));
resetSession();
try {
  const { validateGameCommanderSelection } = await import(sourceUrl);
  const select = (commanderName, partnerName = null, overrides = {}) => validateGameCommanderSelection({ membershipId, participantToken, commanderName, partnerName, ...overrides });
  const result = await select("Malcolm, Keen-Eyed Navigator", "Breeches, Brazen Plunderer");
  assert.equal(result.commander.name, "Malcolm, Keen-Eyed Navigator");
  assert.equal(result.commander.scryfallId, cards.get(result.commander.name).id);
  assert.equal(result.partner.typeLine, "Legendary Creature — Goblin Pirate", "creature partner damage rows need the real card type");
  assert.equal((await select("Atraxa, Praetors' Voice")).partner, null);
  const background = await select("Wilson, Refined Grizzly", "Feywild Visitor");
  assert.equal(background.partner.typeLine, "Legendary Enchantment — Background", "a legal Background must remain noncreature");
  await assert.rejects(select("Sol Ring"), /Sol Ring cannot be a Commander/);
  await assert.rejects(select("Malcolm, Keen-Eyed Navigator", "Atraxa, Praetors' Voice"), /not a legal partner/);
  await assert.rejects(select("Malcolm, Keen-Eyed Navigator", "Missing card"), /not found/);
  await assert.rejects(select(""), /Choose a valid Commander/);
  await assert.rejects(select("Malcolm, Keen-Eyed Navigator", null, { membershipId: "not-in-this-game" }), /Join a local practice game/);
  await assert.rejects(select("Malcolm, Keen-Eyed Navigator", null, { participantToken: "mock-participant-FAKE01" }), /Join a local practice game/);
  resetSession({ ...activeSession, mockGame: { ...activeSession.mockGame, roster: [{ ...activeSession.mockGame.roster[0], role: "visitor" }] } });
  await assert.rejects(select("Malcolm, Keen-Eyed Navigator"), /Join a local practice game/);
  storage.delete("snapcast-active-room");
  await assert.rejects(select("Malcolm, Keen-Eyed Navigator"), /Join a local practice game/);
  resetSession();
  assert.equal(calls.some((call) => call.url === "/api/commanders"), false, "valid and invalid practice selections stay out of account APIs");

  fixture.enabled = false;
  const disabled = await import(sourceUrl + "#disabled-fixture");
  await assert.rejects(disabled.validateGameCommanderSelection({ membershipId, participantToken, commanderName: "Malcolm, Keen-Eyed Navigator" }), /Join a local practice game/);
  fixture.enabled = true;

  globalThis.window.location.hostname = "snapcast.app";
  globalThis.__roomTestSupabase = { auth: { getSession: async () => ({ data: { session: { access_token: "offline-test-token" } } }) } };
  assert.equal((await select("Malcolm, Keen-Eyed Navigator")).commander.name, "Server-validated response");
  const apiRequest = calls.at(-1);
  assert.equal(apiRequest.url, "/api/commanders", "a mock-looking token on production must use the unchanged server validation path");
  assert.equal(apiRequest.options.headers.Authorization, "Bearer offline-test-token");
  assert.equal(JSON.parse(apiRequest.options.body).participantToken, participantToken);
  console.log("OK: local Commander validation uses real card rules, creature/background types, active player guards, and the unchanged production server path");
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
  delete globalThis.__roomTestSupabase;
}
