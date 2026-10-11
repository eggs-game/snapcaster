import assert from "node:assert/strict";
import { parseChatDraft, selectWhisperRecipient, whisperCommandMatches, whisperRecipientMatches } from "../src/chatCommands.js";

const recipients = [
  { id: "ann", name: "Ann", role: "player" },
  { id: "ann-marie", name: "Ann Marie", role: "visitor" },
  { id: "sam-1", name: "Sam", role: "player" },
  { id: "sam-2", name: "sam", role: "visitor" },
];
assert.deepEqual(whisperCommandMatches("/w"), ["/whisper"]);
assert.deepEqual(whisperCommandMatches("hello"), []);
assert.equal(whisperRecipientMatches("/whisper @ann", recipients).length, 2);
assert.equal(selectWhisperRecipient(recipients[1]), "/whisper @Ann Marie ");
assert.deepEqual(parseChatDraft("/whisper @Ann Marie hello there", recipients), {
  kind: "whisper", text: "hello there", targetId: "ann-marie", targetName: "Ann Marie",
});
assert.equal(parseChatDraft("/whisper @Ann hello there", recipients).targetId, "ann");
assert.equal(parseChatDraft("/whisper @Ann Marie hello", recipients, "ann").targetId, "ann-marie",
  "editing an autocomplete recipient to a longer full name must not retain the shorter target");
assert.equal(parseChatDraft("/whisper @SAM hello", recipients).error,
  "That name is shared by multiple people. Select the recipient from autocomplete.");
assert.equal(parseChatDraft("/whisper @SAM hello", recipients, "sam-2").targetId, "sam-2");
assert.equal(parseChatDraft("/whisper @Ann hello", recipients, "departed").error,
  "That person is no longer in the game.");
assert.equal(parseChatDraft("/whisper @Annabelle hello", recipients).kind, undefined,
  "an incomplete recipient must never fall back to public chat");
assert.equal(parseChatDraft("/whisper @Ann", recipients).kind, undefined);
assert.deepEqual(parseChatDraft("hello everyone", recipients), { kind: "public", text: "hello everyone" });
assert.equal(parseChatDraft("x".repeat(501), recipients).text.length, 500);
console.log("OK: private chat resolves full names, duplicate IDs, departure, and prefix overlap without public fallback");
