function preferDevice(constraints) {
  if (!constraints || typeof constraints !== "object") return constraints;
  const exact = constraints.deviceId?.exact;
  return exact ? { ...constraints, deviceId: { ideal: exact } } : { ...constraints };
}

function basicConstraints(constraints) {
  if (!constraints || typeof constraints !== "object") return constraints;
  return constraints.deviceId ? { deviceId: constraints.deviceId } : true;
}

// Saved IDs can disappear when devices are unplugged or browser IDs rotate.
// Keep the selected device/resolution first, then prefer available replacements.
// Retry only constraints failures; permission and busy-device errors stay intact.
export async function getUserMediaWithFallback(constraints, mediaDevices = globalThis.navigator?.mediaDevices, { isActive = () => true } = {}) {
  if (!mediaDevices?.getUserMedia) throw new Error("Camera and microphone access is unavailable in this browser.");
  const preferred = { video: preferDevice(constraints.video), audio: preferDevice(constraints.audio) };
  const basic = { video: basicConstraints(preferred.video), audio: basicConstraints(preferred.audio) };
  const attempts = [constraints, preferred, basic].filter((request, index, requests) => (
    requests.findIndex((other) => JSON.stringify(other) === JSON.stringify(request)) === index
  ));
  for (let index = 0; index < attempts.length; index++) {
    if (!isActive()) throw Object.assign(new Error("Media setup was canceled."), { name: "AbortError" });
    const request = attempts[index];
    try {
      return await mediaDevices.getUserMedia(request);
    } catch (error) {
      const constrained = ["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(error?.name);
      const missingSavedDevice = ["NotFoundError", "DevicesNotFoundError"].includes(error?.name)
        && [request.video, request.audio].some((kind) => kind?.deviceId?.exact);
      if ((!constrained && !missingSavedDevice) || index === attempts.length - 1) throw error;
    }
  }
}
