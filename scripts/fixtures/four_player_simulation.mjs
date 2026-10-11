// All identities are fixtures. This file is never served as a public directory.
export function createFourPlayerFixture(base) {
  const data = structuredClone(base);
  data.enabled = true;
  data.account.localMock = true;
  const peers = [
    ["mock-maya", "Maya", "Alela, Artful Provocateur", "#5d78dc"],
    ["mock-drew", "Drew", "The Ur-Dragon", "#b55454"],
    ["mock-sam", "Sam", "Muldrotha, the Gravetide", "#4f8f65"],
  ];
  const cards = [
    { name: "Contagion", url: "/snaptest/arcane/light/00c8f94a-7690-47f5-b664-61411a32ab74_rand_light.jpg", x: 245, y: 380, height: 430 },
    { name: "Boseiju, Who Shelters All", url: "/snaptest/arcane/light/0180d9a8-992c-4d55-8ac4-33a587786993_rand_light.jpg", x: 640, y: 380, height: 430 },
    { name: "Due Diligence", url: "/snaptest/arcane/light/076d9f76-a247-4727-9e0f-a0289c51059e_rand_light.jpg", x: 1030, y: 380, height: 430 },
  ];
  const game = {
    game_id: "30000000-0000-4000-8000-000000000099", code: "TEST04", name: "Four-player UI practice", bracket: 3,
    visibility: "public", status: "lobby", seat_limit: 4, player_count: 3, visitor_count: 0, mock_owner: true,
    commanders: peers.map(([, name, commander]) => `${name} — ${commander}`),
    commander_cards: peers.map(([, , name], index) => ({ name, seat_number: index + 1 })),
    players: peers.map(([id, display_name]) => ({ id, display_name })),
    mock_roster: peers.map(([id, name], index) => ({ id, name, role: "player", membershipId: `39000000-0000-4000-8000-00000000000${index + 1}`, profileId: `11000000-0000-4000-8000-00000000000${index + 1}` })),
    mock_state: {
      commanders: Object.fromEntries(peers.map(([id, , commander]) => [id, commander])),
      colors: Object.fromEntries(peers.map(([id, , , color]) => [id, color])),
      lives: Object.fromEntries(peers.map(([id]) => [id, 40])), poison: {}, commander_damage: {},
      active_player_id: "mock-local-player", chat: [{ id: "practice-welcome", from: "mock-maya", name: "Maya", text: "Practice table ready. All three opponents are simulated in this browser.", at: Date.now() }],
    },
    mock_simulation: { cards, autoReady: true, autoWhisper: true },
  };
  data.games = [game, ...data.games.filter((entry) => entry.code !== game.code)];
  return data;
}
