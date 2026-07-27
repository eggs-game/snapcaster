export const OUTGOING_VIDEO_QUALITY_OPTIONS = [
  { value: "720p", label: "720p", width: 1280, height: 720, maxBitrate: 1_800_000 },
  { value: "1080p", label: "1080p", width: 1920, height: 1080, maxBitrate: 5_000_000 },
  { value: "1440p", label: "2K", width: 2560, height: 1440, maxBitrate: 8_000_000 },
  { value: "2160p", label: "4K", width: 3840, height: 2160, maxBitrate: 14_000_000 },
];

export const OUTGOING_VIDEO_QUALITY_VALUES = OUTGOING_VIDEO_QUALITY_OPTIONS.map((option) => option.value);
export const RECEIVER_VIDEO_QUALITY_VALUES = ["auto", "720p", "1080p"];
export const DEFAULT_OUTGOING_VIDEO_QUALITY = "1080p";

const PROFILE_BY_VALUE = Object.fromEntries(
  OUTGOING_VIDEO_QUALITY_OPTIONS.map((option) => [option.value, option]),
);

export function normalizeOutgoingVideoQuality(value) {
  return OUTGOING_VIDEO_QUALITY_VALUES.includes(value)
    ? value
    : DEFAULT_OUTGOING_VIDEO_QUALITY;
}

export function normalizeReceiverVideoQuality(value) {
  return RECEIVER_VIDEO_QUALITY_VALUES.includes(value) ? value : "auto";
}

export function resolveVideoEncoding(
  receiverQuality,
  outgoingQuality,
  sourceWidth = 1920,
) {
  const outgoing = PROFILE_BY_VALUE[normalizeOutgoingVideoQuality(outgoingQuality)];
  const receiver = normalizeReceiverVideoQuality(receiverQuality);
  const receiverProfile = receiver === "auto" ? outgoing : PROFILE_BY_VALUE[receiver];
  const effective = receiverProfile.width < outgoing.width ? receiverProfile : outgoing;
  const safeSourceWidth = Math.max(1, Number(sourceWidth) || outgoing.width);
  const scaleResolutionDownBy = safeSourceWidth > effective.width
    ? Math.max(1, Math.min(4, safeSourceWidth / effective.width))
    : null;

  return {
    quality: effective.value,
    width: effective.width,
    height: effective.height,
    maxBitrate: effective.maxBitrate,
    scaleResolutionDownBy,
  };
}
