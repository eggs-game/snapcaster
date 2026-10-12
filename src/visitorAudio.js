export function isParticipantRoomMuted(participant, roomMutedMemberships) {
  return participant?.role === "visitor" && Boolean(roomMutedMemberships?.[participant.membershipId]);
}

// A visitor's own mute cannot override the game owner's authoritative mute.
export function isParticipantAudioMuted(participant, selfMuted, roomMutedMemberships) {
  return Boolean(selfMuted) || isParticipantRoomMuted(participant, roomMutedMemberships);
}

export function applyLocalMicrophoneMute(connection, roomMuted = false) {
  if (!connection) return;
  connection.toggleTrack("audio", !connection.muted && !roomMuted);
}

export function toggleOwnMicrophone(connection, roomMuted = false) {
  if (!connection || roomMuted) return null;
  const enabled = Boolean(connection.muted);
  connection.toggleTrack("audio", enabled);
  connection.setMuted(!enabled);
  return enabled;
}
