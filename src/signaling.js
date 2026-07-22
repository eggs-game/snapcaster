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

const REPORT_BUCKET = "recognition-reports";

async function dataUrlBlob(dataUrl) {
  if (!dataUrl || !String(dataUrl).startsWith("data:")) return null;
  const response = await fetch(dataUrl);
  return response.blob();
}

// Recognition reports are intentionally separate from room signaling. Realtime
// broadcasts are ephemeral; these captures need to survive long enough to be
// labeled and curated into future recognition data.
export async function saveRecognitionReport(report) {
  if (!isConfigured()) throw new Error("Supabase is not configured");
  const id = String(report?.id || "");
  const editToken = String(report?.editToken || "");
  if (!id || !editToken) throw new Error("Invalid recognition report");
  const db = client();
  const capturePath = `${id}/capture.jpg`;
  let ocrPath = null;
  const capture = await dataUrlBlob(report.captureImage);
  if (!capture) throw new Error("Missing clicked-card capture");
  const { error: captureError } = await db.storage.from(REPORT_BUCKET).upload(capturePath, capture, {
    contentType: capture.type || "image/jpeg",
    upsert: false,
  });
  if (captureError) throw captureError;
  if (report.ocrImage) {
    const ocr = await dataUrlBlob(report.ocrImage);
    if (ocr) {
      ocrPath = `${id}/ocr.jpg`;
      const { error: ocrError } = await db.storage.from(REPORT_BUCKET).upload(ocrPath, ocr, {
        contentType: ocr.type || "image/jpeg",
        upsert: false,
      });
      if (ocrError) throw ocrError;
    }
  }
  const { error } = await db.from("recognition_reports").insert({
    id,
    edit_token: editToken,
    room_code: String(report.roomCode || "").slice(0, 16),
    reporter_id: String(report.reporterId || "").slice(0, 40),
    reporter_name: String(report.reporterName || "").slice(0, 80),
    created_at: new Date(report.createdAt || Date.now()).toISOString(),
    predicted_card: report.predictedCard || null,
    matches: report.matches || [],
    diagnostics: report.recognizer || {},
    capture_context: report.captureContext || {},
    capture_path: capturePath,
    ocr_path: ocrPath,
    camera_resolution: String(report.cameraRes || "").slice(0, 32),
  });
  if (error) throw error;
  return { capturePath, ocrPath };
}

export async function labelRecognitionReport(id, editToken, truth) {
  if (!isConfigured()) throw new Error("Supabase is not configured");
  const { error } = await client().rpc("label_recognition_report", {
    p_report_id: id,
    p_edit_token: editToken,
    p_truth_card: truth,
  });
  if (error) throw error;
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

// A room code is the ONLY thing protecting a game: anyone holding one can join
// and request camera captures from every player. Four characters of this
// alphabet is 923,521 combinations — sweepable in minutes — and Math.random()
// is a predictable PRNG, so observing a few codes narrows the rest. Six
// characters from a CSPRNG is ~887 million and unpredictable.
export const makeCode = () => {
  const out = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(out);
  // Reject values in the final partial bucket so the modulo stays uniform.
  const limit = Math.floor(0x100000000 / CODE_CHARS.length) * CODE_CHARS.length;
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    let v = out[i];
    while (v >= limit) {
      const extra = new Uint32Array(1);
      crypto.getRandomValues(extra);
      v = extra[0];
    }
    code += CODE_CHARS[v % CODE_CHARS.length];
  }
  return code;
};

/**
 * Join a room channel.
 * handlers: onRoster(list) — [{id, name, joinedAt, role}] sorted by joinedAt
 *           onMessage(msg) — broadcast messages addressed to us (or everyone)
 * returns { myId, send(msg, to?), leave() }
 */
export async function joinRoom(code, name, role, { onRoster, onMessage }) {
  const safeRole = role === "visitor" ? "visitor" : "player";
  const myId = crypto.randomUUID().slice(0, 8);
  const joinedAt = Date.now();
  const ch = client().channel(`room-${code}`, {
    config: { broadcast: { self: false }, presence: { key: myId } },
  });

  ch.on("presence", { event: "sync" }, () => {
    const state = ch.presenceState();
    const roster = Object.entries(state)
      .map(([id, metas]) => ({
        id,
        name: metas[0]?.name || "Player",
        joinedAt: metas[0]?.joinedAt || 0,
        role: metas[0]?.role === "visitor" ? "visitor" : "player",
      }))
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
        await ch.track({ name, joinedAt, role: safeRole });
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
