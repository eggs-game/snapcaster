// Only public reference thumbnails enter this small decoded-image cache.
// Capture blobs, shared URLs and prior recognition confidence never enter it.
export function rememberedHintCard(hint) {
  const card = hint?.card;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(card?.scryfall_id || "") || !card.name) return null;
  const id = card.scryfall_id.toLowerCase(), side = card.face === 1 ? "back" : "front";
  return { ...card, image: `https://cards.scryfall.io/normal/${side}/${id[0]}/${id[1]}/${id}.jpg` };
}

export class RecognitionHintImages {
  constructor({ limit = 32, Image = globalThis.Image } = {}) {
    this.limit = Math.max(1, Math.min(32, Math.floor(Number(limit) || 32)));
    this.Image = Image;
    this.entries = new Map();
  }
  key(card) { return `${card.scryfall_id}:${card.face || 0}`; }
  warm(card) {
    if (!card?.scryfall_id || typeof this.Image !== "function"
      || !/^https:\/\/cards\.scryfall\.io\/normal\/(front|back)\/[a-f0-9]\/[a-f0-9]\/[a-f0-9-]{36}\.jpg$/.test(card.image || "")) return;
    const key = this.key(card), cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return; }
    const image = new this.Image(), entry = { image, ready: false };
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    image.decoding = "async";
    image.onload = async () => {
      try { await image.decode?.(); } catch { return; }
      if (this.entries.get(key) === entry) entry.ready = true;
    };
    image.onerror = () => { if (this.entries.get(key) === entry) this.entries.delete(key); };
    image.src = card.image.replace("/normal/", "/small/");
  }
  preview(card) {
    const key = this.key(card), entry = this.entries.get(key);
    if (!entry?.ready) return "";
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.image.src;
  }
  clear() { this.entries.clear(); }
}
