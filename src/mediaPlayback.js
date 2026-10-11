// Live video is muted; one persistent audio element owns each remote voice.
// Calling play synchronously from an interaction preserves browser activation.
export function bindMediaPlayback(element, stream, { muted = false } = {}) {
  if (!element) return () => {};
  let active = true;
  element.muted = muted;
  element.playsInline = true;
  element.srcObject = stream || null;

  const play = () => {
    if (!active || !stream) return;
    try {
      Promise.resolve(element.play()).catch(() => {
        // A later media event or interaction retries a browser autoplay block.
      });
    } catch { /* a later event can retry a synchronous browser rejection */ }
  };
  const visibility = () => { if (!document.hidden) play(); };
  element.addEventListener("loadedmetadata", play);
  element.addEventListener("canplay", play);
  stream?.addEventListener?.("addtrack", play);
  document.addEventListener("pointerdown", play, true);
  document.addEventListener("keydown", play, true);
  document.addEventListener("visibilitychange", visibility);
  play();

  return () => {
    active = false;
    element.removeEventListener("loadedmetadata", play);
    element.removeEventListener("canplay", play);
    stream?.removeEventListener?.("addtrack", play);
    document.removeEventListener("pointerdown", play, true);
    document.removeEventListener("keydown", play, true);
    document.removeEventListener("visibilitychange", visibility);
    if (element.srcObject === stream) {
      element.pause();
      element.srcObject = null;
    }
  };
}
