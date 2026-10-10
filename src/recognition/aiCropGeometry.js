// Geometry gates are independent of the model: a neural proposal is only a
// crop hypothesis, and must refer to the card under the actual click.
export const AI_CROP_MODEL = "cornelius-2.12";
export const AI_CROP_MAX_QUADS = 2;

export function aiCropWindows(width, height, point) {
  const nx = Number.isFinite(point?.nx) ? Math.max(0, Math.min(1, point.nx)) : 0.5;
  const ny = Number.isFinite(point?.ny) ? Math.max(0, Math.min(1, point.ny)) : 0.5;
  const side = Math.min(width, height) * 0.7;
  return [
    { x: 0, y: 0, w: width, h: height },
    { x: Math.max(0, Math.min(width - side, nx * width - side / 2)),
      y: Math.max(0, Math.min(height - side, ny * height - side / 2)), w: side, h: side },
  ];
}

export function validateAiQuad(points, width, height, point) {
  if (!Array.isArray(points) || points.length !== 4 || !(width > 0 && height > 0)) return null;
  if (points.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y)
    || p.x < -width * 0.03 || p.x > width * 1.03 || p.y < -height * 0.03 || p.y > height * 1.03)) return null;
  const cx = points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const ordered = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const start = ordered.reduce((best, p, i) => p.y < ordered[best].y ? i : best, 0);
  const quad = [...ordered.slice(start), ...ordered.slice(0, start)];
  const cross = quad.map((a, i) => {
    const b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  if (cross.some((v) => v <= 0)) return null;
  const edges = quad.map((p, i) => Math.hypot(p.x - quad[(i + 1) % 4].x, p.y - quad[(i + 1) % 4].y));
  const w = (edges[0] + edges[2]) / 2, h = (edges[1] + edges[3]) / 2;
  const aspect = Math.max(w, h) / Math.min(w, h);
  const area = Math.abs(quad.reduce((s, p, i) => s + p.x * quad[(i + 1) % 4].y - quad[(i + 1) % 4].x * p.y, 0)) / 2;
  if (Math.min(...edges) < Math.min(width, height) * 0.04
    || aspect < 1.1 || aspect > 2.4 || area < width * height * 0.015 || area > width * height * 0.92) return null;
  const click = { x: (point?.nx ?? 0.5) * width, y: (point?.ny ?? 0.5) * height };
  // Include a point on a boundary, but never accept a strong neighbouring card
  // simply because this single-card model chose it instead of our target.
  if (quad.some((a, i) => {
    const b = quad[(i + 1) % 4];
    return (b.x - a.x) * (click.y - a.y) - (b.y - a.y) * (click.x - a.x) < -0.001;
  })) return null;
  return quad;
}

export function sameAiQuad(a, b, width, height) {
  // Compare cyclic corner assignments: tapped cards near a diamond can pick
  // a different top-most start even when their physical framing is identical.
  return [0, 1, 2, 3].some((shift) => a.every((p, i) => (
    Math.hypot((p.x - b[(i + shift) % 4].x) / width, (p.y - b[(i + shift) % 4].y) / height) < 0.02
  )));
}
