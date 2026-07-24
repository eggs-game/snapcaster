export const VIDEO_COUNTER_TYPES = Object.freeze([
  ["plus-one", "+1/+1", true],
  ["minus-one", "−1/−1", true],
  ["flying", "Flying"],
  ["first-strike", "First strike"],
  ["double-strike", "Double strike"],
  ["deathtouch", "Deathtouch"],
  ["haste", "Haste"],
  ["hexproof", "Hexproof"],
  ["indestructible", "Indestructible"],
  ["lifelink", "Lifelink"],
  ["menace", "Menace"],
  ["reach", "Reach"],
  ["trample", "Trample"],
  ["vigilance", "Vigilance"],
  ["shield", "Shield"],
  ["stun", "Stun"],
  ["finality", "Finality"],
  ["slumber", "Slumber"],
  ["sleep", "Sleep"],
  ["oil", "Oil"],
  ["charge", "Charge"],
  ["energy", "Energy"],
  ["experience", "Experience"],
  ["level", "Level"],
  ["training", "Training"],
  ["quest", "Quest"],
  ["study", "Study"],
  ["knowledge", "Knowledge"],
  ["lore", "Lore"],
  ["verse", "Verse"],
  ["time", "Time"],
  ["age", "Age"],
  ["hatchling", "Hatchling"],
  ["growth", "Growth"],
  ["spore", "Spore"],
  ["fungus", "Fungus"],
  ["corpse", "Corpse"],
  ["soul", "Soul"],
  ["blood", "Blood"],
  ["brick", "Brick"],
  ["page", "Page"],
  ["enlightened", "Enlightened"],
  ["enlightenment", "Enlightenment"],
].map(([id, label, adjustable = false]) => Object.freeze({ id, label, adjustable })));

const VIDEO_COUNTER_TYPES_BY_ID = new Map(VIDEO_COUNTER_TYPES.map((counter) => [counter.id, counter]));

export function getVideoCounterType(typeId) {
  return VIDEO_COUNTER_TYPES_BY_ID.get(String(typeId || "")) || null;
}

export function getCounterTextColor(color) {
  const hex = String(color || "").replace("#", "");
  const normalized = hex.length === 3
    ? [...hex].map((channel) => channel + channel).join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#18170f";
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
  return luminance > 0.56 ? "#18170f" : "#fff";
}

export function normalizeVideoCounter(counter) {
  const type = getVideoCounterType(counter?.type);
  const id = String(counter?.id || "").slice(0, 64);
  if (!type || !id) return null;
  const value = Math.max(0, Math.min(99, Math.trunc(Number(counter?.value) || 0)));
  const zeroSince = value === 0 && type.adjustable
    ? Math.max(0, Math.min(Date.now(), Number(counter?.zeroSince) || Date.now()))
    : 0;
  return {
    id,
    type: type.id,
    x: Math.max(0.06, Math.min(0.94, Number(counter?.x) || 0.5)),
    y: Math.max(0.08, Math.min(0.92, Number(counter?.y) || 0.5)),
    value: type.adjustable ? value : 0,
    zeroSince,
  };
}
