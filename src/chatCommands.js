export const WHISPER_COMMAND = "/whisper";

function cleanName(value) {
  return String(value || "").trim();
}

export function whisperCommandMatches(draft) {
  const value = String(draft || "");
  if (!value.startsWith("/") || /\s/.test(value)) return [];
  return WHISPER_COMMAND.startsWith(value.toLowerCase()) ? [WHISPER_COMMAND] : [];
}

export function whisperRecipientMatches(draft, recipients) {
  const match = String(draft || "").match(/^\/whisper\s+@?([^\n]*)$/i);
  if (!match) return [];
  const query = match[1].trim().toLocaleLowerCase();
  return (recipients || [])
    .filter((recipient) => cleanName(recipient.name))
    .filter((recipient) => !query || cleanName(recipient.name).toLocaleLowerCase().includes(query))
    .slice(0, 8);
}

export function selectWhisperRecipient(recipient) {
  return `${WHISPER_COMMAND} @${cleanName(recipient?.name)} `;
}

export function parseChatDraft(draft, recipients, preferredTargetId = "") {
  const value = String(draft || "").trim();
  if (!/^\/whisper(?:\s|$)/i.test(value)) {
    return value ? { kind: "public", text: value.slice(0, 500) } : { error: "Write a message first." };
  }

  const rest = value.replace(/^\/whisper\s*/i, "");
  if (!rest.startsWith("@")) {
    return { error: "Choose a player or visitor with @ before sending." };
  }

  const available = (recipients || []).filter((recipient) => cleanName(recipient.name));
  const preferred = available.find((recipient) => recipient.id === preferredTargetId);
  if (preferredTargetId && !preferred) {
    return { error: "That person is no longer in the game." };
  }
  const ordered = [...available].sort((a, b) => cleanName(b.name).length - cleanName(a.name).length);
  const lower = rest.toLocaleLowerCase();
  const matches = ordered.filter((recipient) => {
    const mention = `@${cleanName(recipient.name)}`.toLocaleLowerCase();
    return lower.startsWith(mention) && (rest.length === mention.length || /\s/.test(rest[mention.length]));
  });
  const target = preferred && matches.some((recipient) => recipient.id === preferred.id)
    ? preferred
    : matches.length === 1 ? matches[0] : null;
  if (!preferred && matches.length > 1) {
    return { error: "That name is shared by multiple people. Select the recipient from autocomplete." };
  }
  if (!target) return { error: "Choose a current player or visitor before sending." };

  const mentionLength = cleanName(target.name).length + 1;
  const text = rest.slice(mentionLength).trim().slice(0, 500);
  if (!text) return { error: `Write a message for @${cleanName(target.name)}.` };
  return { kind: "whisper", text, targetId: target.id, targetName: cleanName(target.name) };
}
