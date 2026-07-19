// Room signaling over Supabase Realtime (broadcast + presence). No server code.
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = () => Boolean(URL && KEY);

let supabase = null;
function client() {
  if (!supabase) supabase = createClient(URL, KEY, { realtime: { params: { eventsPerSecond: 20 } } });
  return supabase;
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const makeCode = () =>
  Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join("");

/**
 * Join a room channel.
 * handlers: onRoster(list) — [{id, name, joinedAt}] sorted by joinedAt
 *           onMessage(msg) — broadcast messages addressed to us (or everyone)
 * returns { myId, send(msg, to?), leave() }
 */
export async function joinRoom(code, name, { onRoster, onMessage }) {
  const myId = crypto.randomUUID().slice(0, 8);
  const joinedAt = Date.now();
  const ch = client().channel(`room-${code}`, {
    config: { broadcast: { self: false }, presence: { key: myId } },
  });

  ch.on("presence", { event: "sync" }, () => {
    const state = ch.presenceState();
    const roster = Object.entries(state)
      .map(([id, metas]) => ({ id, name: metas[0]?.name || "Player", joinedAt: metas[0]?.joinedAt || 0 }))
      .sort((a, b) => a.joinedAt - b.joinedAt);
    onRoster(roster);
  });

  ch.on("broadcast", { event: "msg" }, ({ payload }) => {
    if (payload.to && payload.to !== myId) return;
    if (payload.from === myId) return;
    onMessage(payload);
  });

  await new Promise((resolve, reject) => {
    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ name, joinedAt });
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reject(new Error("Could not connect to game server (check Supabase config)"));
      }
    });
  });

  return {
    myId,
    send: (msg, to = null) => ch.send({ type: "broadcast", event: "msg", payload: { ...msg, from: myId, to } }),
    leave: () => { ch.untrack(); client().removeChannel(ch); },
  };
}
