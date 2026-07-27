// Room signaling over Supabase Realtime (broadcast + presence). No server code.
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = () => Boolean(URL && KEY);

let supabase = null;
function client() {
  if (!supabase) {
    supabase = createClient(URL, KEY, {
      realtime: {
        params: { eventsPerSecond: 20 },
        // Keep heartbeats off the throttled main thread when a player puts the
        // game in the background. This reduces false presence drops on mobile
        // devices and backgrounded desktop tabs.
        worker: true,
      },
    });
  }
  return supabase;
}

const REPORT_BUCKET = "recognition-reports";

async function roomFingerprint(roomCode) {
  const value = new TextEncoder().encode(String(roomCode || "").toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Connection reports deliberately exclude player names, media/device labels,
// messages, card data, IP addresses, and the raw room code. The fingerprint
// lets dashboard investigation group one game's reports without retaining its
// join secret.
export async function saveConnectionEvent(event) {
  if (!isConfigured()) return;
  const details = event?.details && typeof event.details === "object" ? event.details : {};
  const serializedDetails = JSON.stringify(details);
  const compactDetails = serializedDetails.length <= 4000
    ? details
    : { truncated: true, preview: serializedDetails.slice(0, 3500) };
  const { error } = await client().from("connection_events").insert({
    id: event.id,
    room_fingerprint: await roomFingerprint(event.roomCode),
    observer_id: String(event.observerId || "").slice(0, 40),
    observer_session_id: String(event.observerSessionId || "").slice(0, 64),
    subject_id: String(event.subjectId || "").slice(0, 40),
    event_type: String(event.type || "").slice(0, 64),
    role: event.role === "visitor" ? "visitor" : "player",
    occurred_at: new Date(event.at || Date.now()).toISOString(),
    visibility_state: String(event.visibilityState || "").slice(0, 20),
    browser_online: event.browserOnline !== false,
    details: compactDetails,
  });
  if (error) throw error;
}

const RECOGNITION_OUTCOMES = new Set([
  "matched",
  "no-match",
  "capture-timeout",
  "recognition-timeout",
  "capture-error",
  "recognition-error",
]);
const RECOGNITION_STAGE_KEYS = new Set(["prep", "rank", "orb", "ocr", "total"]);
const VIDEO_QUALITY_VALUES = new Set(["720p", "1080p", "1440p", "2160p"]);

function boundedInteger(value, max) {
  const number = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(max, number));
}

// Automatic recognition telemetry is intentionally timing-only. In
// particular, do not add card names, OCR text, images, room codes, display
// names, device labels, or peer-provided error strings to this payload.
export async function saveRecognitionTiming(event) {
  if (!isConfigured()) return;
  const stages = Object.fromEntries(
    Object.entries(event?.stages || {})
      .filter(([key]) => RECOGNITION_STAGE_KEYS.has(key))
      .map(([key, value]) => [key, boundedInteger(value, 300000)]),
  );
  const outcome = RECOGNITION_OUTCOMES.has(event?.outcome)
    ? event.outcome
    : "recognition-error";
  const quality = VIDEO_QUALITY_VALUES.has(event?.outgoingVideoQuality)
    ? event.outgoingVideoQuality
    : "1080p";
  const { error } = await client().from("recognition_timing_events").insert({
    id: event.id,
    room_fingerprint: await roomFingerprint(event.roomCode),
    observer_id: String(event.observerId || "").slice(0, 40),
    subject_id: String(event.subjectId || "").slice(0, 40),
    role: event.role === "visitor" ? "visitor" : "player",
    build: String(event.build || "").slice(0, 160),
    occurred_at: new Date(event.at || Date.now()).toISOString(),
    remote: !!event.remote,
    outcome,
    capture_ms: boundedInteger(event.captureMs, 300000),
    recognition_ms: boundedInteger(event.recognitionMs, 300000),
    total_ms: boundedInteger(event.totalMs, 300000),
    capture_chars: boundedInteger(event.captureChars, 8 * 1024 * 1024),
    candidates_tried: boundedInteger(event.candidatesTried, 1000),
    isolation_candidates: boundedInteger(event.isolationCandidates, 1000),
    stage_ms: stages,
    outgoing_video_quality: quality,
    visibility_state: String(event.visibilityState || "").slice(0, 20),
    browser_online: event.browserOnline !== false,
  });
  if (error) throw error;
}

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
export async function joinRoom(code, name, role, {
  onRoster,
  onMessage,
  onStatus,
  participantId,
  joinedAt: restoredJoinedAt,
}) {
  const safeRole = role === "visitor" ? "visitor" : "player";
  const safeName = String(name || "").trim().slice(0, 24)
    || (safeRole === "visitor" ? "Visitor" : "Player");
  const restoredId = String(participantId || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  const myId = restoredId || crypto.randomUUID().slice(0, 8);
  const joinedAt = Number(restoredJoinedAt) || Date.now();
  const ch = client().channel(`room-${code}`, {
    config: { broadcast: { self: false }, presence: { key: myId } },
  });

  ch.on("presence", { event: "sync" }, () => {
    const state = ch.presenceState();
    const roster = Object.entries(state)
      .map(([id, metas]) => {
        // Stable participant IDs can briefly leave more than one presence
        // meta during reconnect. Prefer the newest meta with a real name
        // instead of assuming metas[0] is the current browser session.
        const safeMetas = Array.isArray(metas) ? metas : [];
        const metadata = [...safeMetas].reverse().find((meta) => String(meta?.name || "").trim())
          || safeMetas[safeMetas.length - 1]
          || {};
        const memberRole = metadata.role === "visitor" ? "visitor" : "player";
        return {
          id,
          name: String(metadata.name || "").trim().slice(0, 24)
            || (memberRole === "visitor" ? "Visitor" : "Player"),
          joinedAt: Number(metadata.joinedAt) || 0,
          role: memberRole,
        };
      })
      .sort((a, b) => a.joinedAt - b.joinedAt);
    onRoster(roster);
  });

  ch.on("broadcast", { event: "msg" }, ({ payload }) => {
    if (payload.to && payload.to !== myId) return;
    if (payload.from === myId) return;
    onMessage(payload);
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    ch.subscribe(async (status, statusError) => {
      onStatus?.(status, statusError);
      if (status === "SUBSCRIBED") {
        try {
          await ch.track({ name: safeName, joinedAt, role: safeRole });
          if (!settled) {
            settled = true;
            resolve();
          }
        } catch (error) {
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (!settled) {
          settled = true;
          reject(new Error("Could not connect to game server (check Supabase config)"));
        }
      }
    });
  });

  return {
    myId,
    send: (msg, to = null) => ch.send({ type: "broadcast", event: "msg", payload: { ...msg, from: myId, to } }),
    announceLeave: () => ch.send({
      type: "broadcast",
      event: "msg",
      payload: { type: "participant-leaving", from: myId, to: null },
    }),
    leave: () => { ch.untrack(); client().removeChannel(ch); },
  };
}
