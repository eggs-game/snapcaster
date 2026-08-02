import { createClient } from "@supabase/supabase-js";
import {
  aggregateDeckCards,
  normalizeDeckBoard,
  parseArchidektDeck,
  parseDeckAttributionUrl,
  parseDeckSourceUrl,
  parseDeckText,
} from "../src/deckImport.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 3_000_000;
const CARD_COLUMNS = "id, name, quantity, board, scryfall_id, oracle_id, set_code, collector_number, mana_value, type_line, colors, tags";

function sameOrigin(req) {
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  try {
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function cleanBody(req) {
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
  if (JSON.stringify(body).length > 300_000) throw new Error("Request is too large");
  return body;
}

function requestIp(req) {
  return String(req.headers["x-forwarded-for"] || req.headers["cf-connecting-ip"] || "unknown")
    .split(",")[0].trim().slice(0, 96);
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

async function fetchJson(url, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method,
      body,
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        "User-Agent": "Snapcast/1.0 (https://snapcast.app)",
      },
    });
    if (!response.ok) {
      const error = new Error(`Provider request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error("Provider response is too large");
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error("Provider response is too large");
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProviderDeck(source) {
  return parseArchidektDeck(await fetchJson(`https://archidekt.com/api/decks/${encodeURIComponent(source.id)}/`));
}

async function fetchScryfallCard(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName || cleanName.length > 200) throw new Error("Enter a valid card name");
  const payload = await fetchJson(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cleanName)}`);
  if (!payload?.name || !UUID.test(String(payload.id || ""))) throw new Error("That card was not found");
  return payload;
}

async function fetchScryfallPrinting(id) {
  if (!UUID.test(String(id || ""))) throw new Error("Choose a valid card printing");
  const payload = await fetchJson(`https://api.scryfall.com/cards/${encodeURIComponent(id)}`);
  if (!payload?.name || !UUID.test(String(payload.id || ""))) throw new Error("That printing was not found");
  return payload;
}

function cleanTags(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((tag) => String(tag).trim().replace(/\s+/g, " ").slice(0, 32))
    .filter(Boolean))].slice(0, 8);
}

function scryfallMetadata(card) {
  return {
    name: String(card?.name || "").slice(0, 200),
    scryfall_id: UUID.test(String(card?.id || "")) ? card.id : null,
    oracle_id: UUID.test(String(card?.oracle_id || "")) ? card.oracle_id : null,
    set_code: String(card?.set || "").slice(0, 12) || null,
    collector_number: String(card?.collector_number || "").slice(0, 32) || null,
    mana_value: Number.isFinite(Number(card?.cmc)) ? Number(card.cmc) : null,
    type_line: String(card?.type_line || "").slice(0, 200) || null,
    colors: (Array.isArray(card?.colors) ? card.colors : []).filter((color) => /^[WUBRG]$/.test(color)),
  };
}

async function enrichDeckCards(cards) {
  const normalized = aggregateDeckCards(cards);
  const found = new Map();
  for (let offset = 0; offset < normalized.length; offset += 75) {
    const slice = normalized.slice(offset, offset + 75);
    const identifiers = slice.map((card) => card.scryfall_id
      ? { id: card.scryfall_id }
      : card.set_code && card.collector_number
        ? { set: card.set_code, collector_number: card.collector_number }
        : { name: card.name.split(/\s+\/{2}\s+/)[0] });
    const payload = await fetchJson("https://api.scryfall.com/cards/collection", {
      method: "POST",
      body: JSON.stringify({ identifiers }),
    });
    for (const card of payload?.data || []) {
      if (card?.id) found.set(`id:${card.id}`, card);
      if (card?.name) found.set(`name:${card.name.toLocaleLowerCase("en-US")}`, card);
      if (card?.set && card?.collector_number) found.set(`print:${card.set}:${card.collector_number}`, card);
    }
    if (offset + 75 < normalized.length) await new Promise((resolve) => setTimeout(resolve, 75));
  }
  return normalized.map((card) => {
    const match = (card.scryfall_id && found.get(`id:${card.scryfall_id}`))
      || (card.set_code && card.collector_number && found.get(`print:${card.set_code}:${card.collector_number}`))
      || found.get(`name:${card.name.toLocaleLowerCase("en-US")}`);
    return match ? { ...card, ...scryfallMetadata(match), quantity: card.quantity, board: card.board } : card;
  });
}

async function replaceDeckCards(admin, deck, cards) {
  const normalized = aggregateDeckCards(await enrichDeckCards(cards));
  if (!normalized.length) throw new Error("No cards were found in that deck");
  const totalQuantity = normalized.reduce((total, card) => total + card.quantity, 0);
  if (normalized.length > 500 || totalQuantity > 5000) throw new Error("That deck contains too many cards");
  const { data: saved, error: saveError } = await admin
    .rpc("replace_saved_deck_cards", {
      target_deck_id: deck.id,
      target_owner_id: deck.owner_id,
      replacement_cards: normalized,
    })
    .select(CARD_COLUMNS);
  if (saveError) throw new Error("Imported cards could not be saved");
  return saved || [];
}

async function loadOwnedCard(admin, deck, cardId) {
  if (!UUID.test(String(cardId || ""))) throw new Error("Invalid card");
  const { data, error } = await admin.from("saved_deck_cards")
    .select(CARD_COLUMNS)
    .eq("id", cardId).eq("deck_id", deck.id).eq("owner_id", deck.owner_id)
    .single();
  if (error || !data) throw new Error("Card not found");
  return data;
}

async function mergeCardAtDestination(admin, deck, source, { board, quantity, metadata }) {
  const nextName = metadata?.name || source.name;
  const nextTags = cleanTags(metadata?.tags ?? source.tags);
  const { data: destination } = await admin.from("saved_deck_cards")
    .select(CARD_COLUMNS)
    .eq("deck_id", deck.id).eq("owner_id", deck.owner_id).eq("board", board).eq("name", nextName)
    .neq("id", source.id).maybeSingle();
  if (destination) {
    const { data: saved, error: saveError } = await admin.from("saved_deck_cards")
      .update({
        quantity: Math.min(999, Number(destination.quantity) + quantity),
        tags: cleanTags([...(destination.tags || []), ...nextTags]),
      })
      .eq("id", destination.id).eq("deck_id", deck.id).eq("owner_id", deck.owner_id)
      .select(CARD_COLUMNS).single();
    if (saveError) throw new Error("Card could not be merged");
    const { error: deleteError } = await admin.from("saved_deck_cards")
      .delete().eq("id", source.id).eq("deck_id", deck.id).eq("owner_id", deck.owner_id);
    if (deleteError) throw new Error("Original card could not be removed");
    return { card: saved, removedId: source.id };
  }
  const { data: saved, error } = await admin.from("saved_deck_cards")
    .update({ ...(metadata || {}), tags: nextTags, board, quantity })
    .eq("id", source.id).eq("deck_id", deck.id).eq("owner_id", deck.owner_id)
    .select(CARD_COLUMNS).single();
  if (error) throw new Error("Card could not be updated");
  return { card: saved, removedId: null };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: "Origin not allowed" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) return res.status(503).json({ error: "Deck imports are not configured" });

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const body = cleanBody(req);
    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user || userData.user.is_anonymous) return res.status(401).json({ error: "Invalid session" });

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const ip = requestIp(req);
    if (body.action === "preview_url") {
      await checkRateLimit(admin, userData.user.id, ip, "saved_deck_preview", 60, 86400);
      const source = parseDeckSourceUrl(body.url);
      const imported = await fetchProviderDeck(source);
      const commanders = imported.cards
        .filter((card) => card.board === "commander")
        .map((card) => card.name)
        .slice(0, 2);
      if (!commanders.length) throw new Error("That deck does not identify a Commander");
      return res.status(200).json({
        name: imported.name || null,
        commanders,
        totalCards: imported.cards.reduce((total, card) => total + card.quantity, 0),
        uniqueCards: imported.cards.length,
        sourceProvider: source.provider,
        sourceUrl: source.url,
      });
    }

    const deckId = String(body.deckId || "");
    if (!UUID.test(deckId)) return res.status(400).json({ error: "Invalid deck" });
    const { data: deck, error: deckError } = await admin
      .from("saved_commander_decks")
      .select("id, owner_id")
      .eq("id", deckId)
      .eq("owner_id", userData.user.id)
      .single();
    if (deckError || !deck) return res.status(404).json({ error: "Deck not found" });

    if (body.action === "import_url" || body.action === "import_text") {
      await checkRateLimit(admin, userData.user.id, ip, "saved_deck_import", 30, 86400);
      let imported;
      let sourceProvider = "text";
      let sourceUrl = null;
      if (body.action === "import_url") {
        const source = parseDeckSourceUrl(body.url);
        imported = await fetchProviderDeck(source);
        sourceProvider = source.provider;
        sourceUrl = source.url;
      } else {
        imported = { name: "", cards: parseDeckText(String(body.text || "").slice(0, 250_000)) };
        if (body.sourceUrl) {
          const attribution = parseDeckAttributionUrl(body.sourceUrl);
          sourceProvider = attribution.provider;
          sourceUrl = attribution.url;
        }
      }
      const cards = await replaceDeckCards(admin, deck, imported.cards);
      const { error: updateError } = await admin.from("saved_commander_decks").update({
        source_provider: sourceProvider,
        source_url: sourceUrl,
        imported_at: new Date().toISOString(),
      }).eq("id", deck.id).eq("owner_id", deck.owner_id);
      if (updateError) throw new Error("Deck import metadata could not be saved");
      return res.status(200).json({ cards, sourceProvider, sourceUrl, importedName: imported.name || null });
    }

    if (body.action === "add_card") {
      await checkRateLimit(admin, userData.user.id, ip, "saved_deck_card", 300, 86400);
      const card = await fetchScryfallCard(body.name);
      const board = normalizeDeckBoard(body.board);
      const quantity = Math.max(1, Math.min(99, Math.trunc(Number(body.quantity) || 1)));
      const { data: current } = await admin.from("saved_deck_cards")
        .select("quantity, tags")
        .eq("deck_id", deck.id).eq("owner_id", deck.owner_id).eq("board", board).eq("name", card.name)
        .maybeSingle();
      const row = {
        deck_id: deck.id,
        owner_id: deck.owner_id,
        name: card.name,
        quantity: Math.min(999, Number(current?.quantity || 0) + quantity),
        board,
        scryfall_id: card.id,
        oracle_id: UUID.test(String(card.oracle_id || "")) ? card.oracle_id : null,
        set_code: String(card.set || "").slice(0, 12) || null,
        ...scryfallMetadata(card),
        tags: cleanTags(current?.tags),
      };
      const { data: saved, error } = await admin.from("saved_deck_cards")
        .upsert(row, { onConflict: "deck_id,board,name" })
        .select(CARD_COLUMNS)
        .single();
      if (error) throw new Error("Card could not be saved");
      return res.status(200).json({ card: saved });
    }

    if (body.action === "update_card") {
      await checkRateLimit(admin, userData.user.id, ip, "saved_deck_card", 500, 86400);
      const source = await loadOwnedCard(admin, deck, body.cardId);
      const quantity = Math.max(1, Math.min(999, Math.trunc(Number(body.quantity) || 1)));
      const board = normalizeDeckBoard(body.board || source.board);
      return res.status(200).json(await mergeCardAtDestination(admin, deck, source, {
        board,
        quantity,
        metadata: { tags: cleanTags(body.tags ?? source.tags) },
      }));
    }

    if (body.action === "replace_card") {
      await checkRateLimit(admin, userData.user.id, ip, "saved_deck_card", 300, 86400);
      const source = await loadOwnedCard(admin, deck, body.cardId);
      const replacement = await fetchScryfallCard(body.name);
      return res.status(200).json(await mergeCardAtDestination(admin, deck, source, {
        board: source.board,
        quantity: source.quantity,
        metadata: scryfallMetadata(replacement),
      }));
    }

    if (body.action === "set_card_printing") {
      await checkRateLimit(admin, userData.user.id, ip, "saved_deck_card", 300, 86400);
      const source = await loadOwnedCard(admin, deck, body.cardId);
      const printing = await fetchScryfallPrinting(body.scryfallId);
      const sameOracle = source.oracle_id && printing.oracle_id === source.oracle_id;
      const sameName = printing.name.toLocaleLowerCase("en-US") === source.name.toLocaleLowerCase("en-US");
      if (!sameOracle && !sameName) throw new Error("Choose artwork for the same card");
      const { data: saved, error } = await admin.from("saved_deck_cards")
        .update(scryfallMetadata(printing))
        .eq("id", source.id).eq("deck_id", deck.id).eq("owner_id", deck.owner_id)
        .select(CARD_COLUMNS).single();
      if (error) throw new Error("Card art could not be updated");
      return res.status(200).json({ card: saved });
    }

    if (body.action === "delete_card") {
      await checkRateLimit(admin, userData.user.id, ip, "saved_deck_card", 500, 86400);
      const source = await loadOwnedCard(admin, deck, body.cardId);
      const { error } = await admin.from("saved_deck_cards")
        .delete().eq("id", source.id).eq("deck_id", deck.id).eq("owner_id", deck.owner_id);
      if (error) throw new Error("Card could not be removed");
      return res.status(200).json({ removedId: source.id });
    }
    return res.status(400).json({ error: "Unknown deck action" });
  } catch (error) {
    const message = error?.name === "AbortError" ? "The deck provider timed out" : String(error?.message || "Deck update failed");
    return res.status(400).json({ error: message });
  }
}
