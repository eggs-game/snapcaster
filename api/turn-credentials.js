const TURN_TTL_SECONDS = 12 * 60 * 60;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 8;
const requests = new Map();

function header(req, name) {
  const value = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sameOrigin(req) {
  const origin = header(req, "origin");
  const host = header(req, "x-forwarded-host") || header(req, "host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === String(host).split(",")[0].trim();
  } catch {
    return false;
  }
}

function clientAddress(req) {
  return String(header(req, "x-forwarded-for") || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

function withinRateLimit(key) {
  const now = Date.now();
  if (requests.size > 2048) {
    for (const [storedKey, value] of requests) {
      if (value.resetAt <= now) requests.delete(storedKey);
    }
  }
  const current = requests.get(key);
  if (!current || current.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT;
}

function filteredIceServers(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((server) => {
    const urls = (Array.isArray(server?.urls) ? server.urls : [server?.urls])
      .filter((url) => typeof url === "string")
      .filter((url) => /^(stun|turn|turns):(stun|turn)\.cloudflare\.com:/i.test(url))
      .filter((url) => !/\.cloudflare\.com:53(?:\?|$)/i.test(url));
    if (!urls.length) return [];
    return [{
      urls,
      ...(server.username && server.credential
        ? { username: server.username, credential: server.credential }
        : {}),
    }];
  });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: "Invalid origin" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const roomCode = String(body?.roomCode || "").toUpperCase();
  if (!/^[A-HJ-KM-NP-Z2-9]{6}$/.test(roomCode)) {
    return res.status(400).json({ error: "Invalid room code" });
  }
  if (!withinRateLimit(`${clientAddress(req)}:${roomCode}`)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many credential requests" });
  }

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const keyToken = process.env.CLOUDFLARE_TURN_KEY_TOKEN;
  if (!keyId || !keyToken) {
    return res.status(503).json({ error: "TURN is not configured" });
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      console.error("Cloudflare TURN credential request failed", response.status, detail);
      return res.status(502).json({ error: "TURN credential provider failed" });
    }
    const iceServers = filteredIceServers((await response.json())?.iceServers);
    if (!iceServers.some((server) => server.username && server.credential)) {
      return res.status(502).json({ error: "TURN credential provider returned no relay" });
    }
    return res.status(200).json({
      iceServers,
      expiresAt: new Date(Date.now() + TURN_TTL_SECONDS * 1000).toISOString(),
    });
  } catch (error) {
    console.error("Cloudflare TURN credential request failed", error);
    return res.status(502).json({ error: "TURN credential provider failed" });
  }
}
