#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20260803002358_secure_game_rejoin.sql", import.meta.url),
  "utf8",
);
const client = await readFile(new URL("../src/gameRooms.js", import.meta.url), "utf8");
const lobby = await readFile(new URL("../src/Lobby.jsx", import.meta.url), "utf8");

assert.match(migration, /game_memberships_active_auth_unique/);
assert.match(migration, /auth_user_id = caller_id[\s\S]*left_at is null[\s\S]*removed_at is null/);
assert.match(migration, /removed_at is not null[\s\S]*you were removed from this game/);
assert.match(migration, /token_hash = public\.snapcast_token_hash\(participant_token\)/);
assert.match(migration, /set realtime_epoch = gen_random_uuid\(\)/);
assert.match(migration, /owner_token_hash = case[\s\S]*owner_membership_id = joined_member\.id[\s\S]*snapcast_token_hash\(participant_token\)/);
assert.match(migration, /'role', joined_member\.role/);
assert.match(migration, /'owner', target_room\.owner_membership_id = joined_member\.id/);
assert.match(migration, /'resumed', resumed/);
assert.match(migration, /revoke all on function public\.join_game_room[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.join_game_room[\s\S]*to authenticated/);
assert.match(client, /role: data\.role === "visitor" \? "visitor" : "player"/);
assert.match(client, /ownerToken: data\.owner \? participantToken : null/);
assert.match(lobby, /const joinedRole = capability\.role \|\| role/);

console.log("game rejoin preserves membership and rotates its capability");
