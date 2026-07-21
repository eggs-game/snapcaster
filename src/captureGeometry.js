// Capture crop geometry — shared by the live camera path (webrtc.js) and the
// SNAPTEST tableau scenes, so the benchmark crops exactly the way production
// does. If these diverge, SNAPTEST stops predicting real behavior.

export const CAPTURE_SIDE_FRAC = 0.55;

// Square crop around a normalized point, slid back inside the frame rather than
// hanging off the edge (which would black-pad and throw away real pixels).
// Returns the source rect plus px/py: where the click actually landed inside
// the crop, which is 0.5,0.5 only when the point was far enough from an edge.
export function cropGeometry(w, h, nx, ny, sideFrac = CAPTURE_SIDE_FRAC) {
  const side = Math.round(Math.min(w, h) * sideFrac);
  const half = side / 2;
  const cxRaw = Math.max(0, Math.min(1, nx)) * w;
  const cyRaw = Math.max(0, Math.min(1, ny)) * h;
  const cx = w > side ? Math.max(half, Math.min(w - half, cxRaw)) : w / 2;
  const cy = h > side ? Math.max(half, Math.min(h - half, cyRaw)) : h / 2;
  const sx = cx - half;
  const sy = cy - half;
  return { side, sx, sy, px: (cxRaw - sx) / side, py: (cyRaw - sy) / side };
}
