import { createClient } from "@supabase/supabase-js";
import { isCommanderCard, isValidCommanderPartner } from "../src/commanderRules.js";

const APP_ORIGINS = new Set([
  "https://snapcast.app",
  "https://snapcaster.vercel.app",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanBody(req) {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
  if (JSON.stringify(body).length > 4096) throw new Error("Request is too large");
  return body;
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.headers["cf-connecting-ip"] || "unknown")
    .split(",")[0]
    .trim()
    .slice(0, 96);
}

async function fetchScryfallCard({ id, name }) {
  const normalizedId = String(id || "").trim();
  const normalizedName = String(name || "").trim();
  const url = normalizedId && UUID.test(normalizedId)
    ? `https://api.scryfall.com/cards/${encodeURIComponent(normalizedId)}`
    : `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(normalizedName)}`;
  if ((!normalizedId || !UUID.test(normalizedId)) && (!normalizedName || normalizedName.length > 120)) {
    throw new Error("Choose a valid Commander card");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Snapcast/1.0 (https://snapcast.app)" },
    });
    if (!response.ok) throw new Error("That card was not found");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function validateSelection(body) {
  const commanderRequest = fetchScryfallCard({
    id: body.commanderScryfallId,
    name: body.commanderName,
  });
  const hasPartner = body.partnerScryfallId || String(body.partnerName || "").trim();
  const partnerRequest = hasPartner
    ? fetchScryfallCard({ id: body.partnerScryfallId, name: body.partnerName })
    : Promise.resolve(null);
  const [commander, partner] = await Promise.all([commanderRequest, partnerRequest]);
  if (!isCommanderCard(commander)) throw new Error(`${commander.name} cannot be a Commander`);

  if (partner) {
    if (!isValidCommanderPartner(commander, partner)) {
      throw new Error(`${partner.name} is not a legal partner for ${commander.name}`);
    }
  }
  return { commander, partner };
}

async function checkRateLimit(admin, userId, ip, action, maximumEvents, windowSeconds) {
  const { error } = await admin.rpc("snapcast_check_server_rate_limit", {
    target_auth_user_id: userId,
    target_ip: ip,
    requested_action: action,
    maximum_events: maximumEvents,
    window_seconds: windowSeconds,
  });
  if (error) throw new Error(error.message?.includes("rate limit") ? "Too many requests. Try again later." : "Request could not be authorized");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const origin = String(req.headers.origin || "");
  if (origin && !APP_ORIGINS.has(origin)) return res.status(403).json({ error: "Origin not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(503).json({ error: "Commander validation is not configured" });
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const body = cleanBody(req);
    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) return res.status(401).json({ error: "Invalid session" });

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const ip = requestIp(req);
    const membershipId = String(body.membershipId || "");
    const participantToken = String(body.participantToken || "");
    const label = String(body.label || "").trim();
    if (body.action === "set_membership") {
      if (!UUID.test(membershipId) || participantToken.length < 32 || participantToken.length > 128) {
        return res.status(400).json({ error: "Invalid game membership" });
      }
      await checkRateLimit(admin, userData.user.id, ip, "commander_selection", 120, 3600);
    } else if (body.action === "save_deck") {
      if (userData.user.is_anonymous) return res.status(403).json({ error: "Sign in to save a Commander deck" });
      if (!label || label.length > 48) return res.status(400).json({ error: "Deck label must be 1–48 characters" });
      await checkRateLimit(admin, userData.user.id, ip, "saved_commander_deck", 30, 86400);
    } else {
      return res.status(400).json({ error: "Unknown commander action" });
    }
    const { commander, partner } = await validateSelection(body);

    if (body.action === "set_membership") {
      const { data, error } = await admin.rpc("set_validated_game_commanders", {
        target_membership_id: membershipId,
        participant_token: participantToken,
        target_auth_user_id: userData.user.id,
        p_commander_name: commander.name,
        p_commander_scryfall_id: commander.id,
        p_partner_name: partner?.name || null,
        p_partner_scryfall_id: partner?.id || null,
        p_partner_type_line: partner?.type_line || null,
      });
      if (error || !data) return res.status(403).json({ error: "Game membership could not be updated" });
    } else if (body.action === "save_deck") {
      const { data, error } = await admin
        .from("saved_commander_decks")
        .insert({
          owner_id: userData.user.id,
          label,
          commander_name: commander.name,
          commander_scryfall_id: commander.id,
          partner_name: partner?.name || null,
          partner_scryfall_id: partner?.id || null,
          color_identity: [...new Set([
            ...(commander.color_identity || []),
            ...(partner?.color_identity || []),
          ])],
          sort_order: Math.max(0, Math.min(10000, Number(body.sortOrder) || 0)),
        })
        .select("id, label, commander_name, commander_scryfall_id, partner_name, partner_scryfall_id, color_identity, sort_order")
        .single();
      if (error) return res.status(409).json({ error: "Commander deck could not be saved" });
      return res.status(200).json({ deck: data });
    }

    return res.status(200).json({
      commander: {
        name: commander.name,
        scryfallId: commander.id,
        typeLine: commander.type_line || "",
      },
      partner: partner ? {
        name: partner.name,
        scryfallId: partner.id,
        typeLine: partner.type_line || "",
      } : null,
    });
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Card validation timed out"
      : String(error?.message || "Commander validation failed");
    return res.status(400).json({ error: message });
  }
}
