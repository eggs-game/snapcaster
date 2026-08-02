#!/usr/bin/env python3
"""Static launch guards for Snapcast's browser-accessible account schema."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SQL = "\n".join(path.read_text() for path in MIGRATIONS)
SRC = "\n".join(path.read_text() for path in (ROOT / "src").glob("**/*") if path.is_file())
DECK_API = (ROOT / "api" / "decks.js").read_text()
DECK_IMPORT_SURFACE = "\n".join((
    DECK_API,
    (ROOT / "src" / "account.js").read_text(),
    (ROOT / "vite.config.js").read_text(),
))
VALIDATED_COMMANDERS = (ROOT / "supabase" / "migrations" / "20260726190000_validated_commanders.sql").read_text()
REPORT_HARDENING = (ROOT / "supabase" / "migrations" / "20260801130000_recognition_report_hardening.sql").read_text()
FUNCTION_HARDENING = (ROOT / "supabase" / "migrations" / "20260802002000_function_privilege_hardening.sql").read_text()
QUERY_HARDENING = (ROOT / "supabase" / "migrations" / "20260802003000_query_performance_hardening.sql").read_text()
DISCORD_PRIVACY = (ROOT / "supabase" / "migrations" / "20260802153709_friend_only_discord_identity.sql").read_text()
HISTORY_FILTER_FIELDS = (ROOT / "supabase" / "migrations" / "20260802154629_game_history_filter_fields.sql").read_text()
DECK_SORT_METADATA = (ROOT / "supabase" / "migrations" / "20260802160005_saved_deck_profile_sort_metadata.sql").read_text()
DECK_TAGS = (ROOT / "supabase" / "migrations" / "20260802203315_add_saved_deck_card_tags.sql").read_text()
PUBLIC_DECKS = (ROOT / "supabase" / "migrations" / "20260802205957_add_public_deck_views.sql").read_text()
GAME_METRICS = (ROOT / "supabase" / "migrations" / "20260802212305_durable_game_metrics.sql").read_text()

EXPECTED_RLS = {
    "profiles", "account_private", "account_preferences", "game_rooms",
    "game_memberships", "game_sessions", "game_session_participants",
    "game_session_commanders", "game_turns", "game_result_corrections",
    "game_audit_log", "saved_commander_decks", "saved_deck_cards", "player_blocks",
    "friend_requests", "friendships", "player_presence", "game_invitations",
    "profile_notifications", "player_reviews", "moderation_reports",
    "account_deletion_requests", "security_rate_events", "moderator_accounts",
    "moderation_actions", "moderation_appeals",
    "recognition_reports", "connection_events", "recognition_timing_events",
}

for table in sorted(EXPECTED_RLS):
    assert re.search(rf"alter\s+table\s+public\.{table}\s+enable\s+row\s+level\s+security", SQL, re.I), (
        f"missing RLS enable for {table}"
    )

assert not re.search(r"grant\s+[^;]*update[^;]*on\s+public\.account_private", SQL, re.I), (
    "browser clients must not update linked Discord/email identity"
)
assert "add column if not exists discord_username" in DISCORD_PRIVACY, (
    "Discord usernames must remain on the owner-only private account row"
)
assert re.search(
    r"from\s+public\.friendships.*?player_one_id\s*=\s*least\(auth\.uid\(\),\s*target_profile_id\).*?"
    r"player_two_id\s*=\s*greatest\(auth\.uid\(\),\s*target_profile_id\)",
    DISCORD_PRIVACY,
    re.I | re.S,
), "friend-only Discord disclosure must verify the canonical accepted friendship"
assert re.search(
    r"when\s+viewer\.relationship\s+in\s*\('self',\s*'friend'\).*?"
    r"jsonb_build_object\('discord_username',\s*target\.discord_username\).*?"
    r"else\s+'\{\}'::jsonb",
    DISCORD_PRIVACY,
    re.I | re.S,
), "public profiles must omit Discord usernames for non-friends instead of relying on UI hiding"
profiles_ddl = re.search(
    r"create\s+table\s+if\s+not\s+exists\s+public\.profiles\s*\((.*?)\);",
    SQL,
    re.I | re.S,
)
assert profiles_ddl and "discord_username" not in profiles_ddl.group(1), (
    "Discord usernames must never move onto the publicly readable profiles table"
)
assert "'bracket', rooms.bracket" in HISTORY_FILTER_FIELDS
assert "'opponent_commanders'" in HISTORY_FILTER_FIELDS
assert "where mine.profile_id = auth.uid()" in HISTORY_FILTER_FIELDS, (
    "filter metadata must remain scoped to the requesting history participant"
)
assert re.search(
    r"revoke\s+all\s+on\s+function\s+public\.get_my_game_history\(integer\)\s+from\s+public\s*,\s*anon",
    HISTORY_FILTER_FIELDS,
    re.I,
), "participant history must not be callable anonymously"
assert "add column if not exists eliminated_at timestamptz" in GAME_METRICS
assert re.search(
    r"record_game_elimination\(.*?security\s+definer\s+set\s+search_path\s*=\s*''.*?"
    r"participants\.membership_id\s*=\s*acting_membership_id.*?"
    r"memberships\.token_hash\s*=\s*public\.snapcast_token_hash\(participant_token\)",
    GAME_METRICS,
    re.I | re.S,
), "elimination writes must be scoped to the caller's participant capability"
assert re.search(
    r"revoke\s+all\s+on\s+function\s+public\.record_game_elimination\(.*?\)\s+from\s+public\s*,\s*anon",
    GAME_METRICS,
    re.I | re.S,
), "elimination writes must not be anonymously executable"
assert re.search(
    r"'turn_count'\s*,\s*\(\s*select\s+count\(\*\).*?"
    r"turns\.session_id\s*=\s*sessions\.id",
    GAME_METRICS,
    re.I | re.S,
), "history turn_count must count the whole game instead of only the viewer's turns"
assert "'my_turn_count'" in GAME_METRICS
assert '.rpc("record_game_elimination"' in SRC
assert "attackerMembershipId" in SRC, (
    "durable Commander-damage snapshots must use membership IDs instead of ephemeral peer IDs"
)
assert "with (security_invoker = true)" in DECK_SORT_METADATA, (
    "deck sort metadata must preserve saved-card RLS"
)
assert "where cards.board in ('commander', 'mainboard')" in DECK_SORT_METADATA
assert re.search(
    r"revoke\s+all\s+on\s+public\.saved_deck_profile_sort_metadata\s+from\s+public\s*,\s*anon",
    DECK_SORT_METADATA,
    re.I,
), "deck sort metadata must not be anonymously readable"
assert not re.search(r"grant\s+[^;]*update[^;]*on\s+public\.profile_notifications", SQL, re.I), (
    "browser clients must not rewrite notification action references"
)
assert re.search(
    r"create\s+or\s+replace\s+function\s+public\.send_friend_request.*?"
    r"insert\s+into\s+public\.friend_requests.*?"
    r"insert\s+into\s+public\.profile_notifications\s*\(recipient_id,\s*actor_id,\s*kind,\s*reference_id\).*?"
    r"'friend_request'",
    SQL,
    re.I | re.S,
), "friend requests must create their recipient notification in the same function"
assert "service_role" not in SRC.lower(), "service-role credentials must never appear in browser source"
assert "VITE_DISCORD" not in SRC, "Discord provider secrets must never use a VITE_ variable"
assert 'scopes: "identify email"' in SRC, "Discord OAuth scopes drifted"
assert "private: true" in SRC, "game signaling must use private Realtime channels"
assert "auth_user_id" in SQL and "realtime.messages" in SQL, (
    "private Realtime membership authorization is missing"
)
assert re.search(
    r"revoke\s+insert\s*,\s*update\s+on\s+public\.saved_commander_decks\s+from\s+authenticated",
    VALIDATED_COMMANDERS,
    re.I,
), "saved Commander decks must only be created by the trusted validation API"
assert "set_validated_game_commanders" in VALIDATED_COMMANDERS, (
    "runtime Commander choices must use the service-only validation boundary"
)
assert '.from("saved_commander_decks")\n    .insert' not in SRC, (
    "browser clients must not insert saved Commander decks directly"
)
assert 'fetch("/api/commanders"' in SRC, "browser Commander mutations must use the trusted API"
assert 'fetch("/api/decks"' in SRC, "browser deck-list mutations must use the trusted API"
for action in ("preview_url", "import_url", "import_text", "add_card", "update_card", "replace_card", "set_card_printing", "delete_card"):
    assert f'body.action === "{action}"' in DECK_API, f"trusted deck API is missing {action}"
assert '.eq("owner_id", userData.user.id)' in DECK_API, (
    "trusted deck mutations must verify the authenticated user owns the deck"
)
assert '.rpc("replace_saved_deck_cards"' in DECK_API, (
    "full-list deck imports must use the atomic service-only replacement function"
)
for forbidden_moxfield_endpoint in ("api2.moxfield.com", "api.moxfield.com", "parseMoxfieldDeck"):
    assert forbidden_moxfield_endpoint not in DECK_IMPORT_SURFACE, (
        "Snapcast must not automatically request or parse Moxfield's private deck API"
    )
assert "Moxfield links are attribution only" in SRC, (
    "Moxfield URLs must be rejected by the automated import path with export guidance"
)
assert re.search(
    r"revoke\s+all\s+on\s+function\s+public\.replace_saved_deck_cards.*?from\s+public\s*,\s*anon\s*,\s*authenticated",
    SQL,
    re.I | re.S,
), "the atomic deck replacement function must not be browser executable"
assert "add column if not exists tags text[] not null default '{}'" in DECK_TAGS
assert "cardinality(tags) <= 8" in DECK_TAGS
assert "security invoker" in DECK_TAGS
assert re.search(
    r"revoke\s+all\s+on\s+function\s+public\.replace_saved_deck_cards.*?from\s+public\s*,\s*anon\s*,\s*authenticated",
    DECK_TAGS,
    re.I | re.S,
), "tag-aware replacement must remain service-only"
assert "printing.oracle_id === source.oracle_id" in DECK_API, (
    "card-art changes must stay on the same Oracle card"
)
assert not re.search(r'\.from\("saved_deck_cards"\).*?\.(?:insert|upsert|update)\(', SRC, re.S), (
    "browser clients must not write saved deck cards directly"
)
for function_name in (
    "get_public_profile_relationship",
    "get_public_profile_decks",
    "get_public_saved_deck",
):
    assert f"create or replace function public.{function_name}" in PUBLIC_DECKS
    assert re.search(
        rf"revoke\s+all\s+on\s+function\s+public\.{function_name}\(uuid\)\s+from\s+public",
        PUBLIC_DECKS,
        re.I,
    ), f"{function_name} must not inherit PUBLIC execute"
    assert re.search(
        rf"grant\s+execute\s+on\s+function\s+public\.{function_name}\(uuid\)\s+to\s+anon\s*,\s*authenticated",
        PUBLIC_DECKS,
        re.I,
    ), f"{function_name} must be an explicit read-only profile API"
assert "update public.saved_commander_decks" not in PUBLIC_DECKS.lower()
assert "insert into public.saved_commander_decks" not in PUBLIC_DECKS.lower()
assert "delete from public.saved_commander_decks" not in PUBLIC_DECKS.lower()
assert "limit 100" in PUBLIC_DECKS, "public profile deck discovery must stay bounded"
assert "limit 500" in PUBLIC_DECKS, "public shared-deck card reads must stay bounded"
assert "rename to get_friend_profile_stats_internal" in PUBLIC_DECKS
assert "rename to get_friend_profile_matchups_internal" in PUBLIC_DECKS
for internal_function in (
    "get_friend_profile_stats_internal",
    "get_friend_profile_matchups_internal",
):
    assert re.search(
        rf"revoke\s+all\s+on\s+function\s+public\.{internal_function}\(uuid\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated",
        PUBLIC_DECKS,
        re.I,
    ), f"{internal_function} must never be directly browser-callable"
assert "'stats_visible', false" in PUBLIC_DECKS
assert re.search(
    r"get_public_profile_relationship\(target_profile_id\)\s+in\s*\('self',\s*'friend'\).*?"
    r"get_friend_profile_matchups_internal",
    PUBLIC_DECKS,
    re.I | re.S,
), "matchup analytics must require self or accepted-friend access"
assert re.search(
    r'create\s+policy\s+"bounded recognition report insert".*?to\s+anon\s*,\s*authenticated',
    REPORT_HARDENING,
    re.I | re.S,
), "signed-in players must be able to submit bounded recognition reports"
assert re.search(
    r'create\s+policy\s+"bounded recognition report upload".*?to\s+anon\s*,\s*authenticated',
    REPORT_HARDENING,
    re.I | re.S,
), "recognition evidence storage must be bounded for guest and signed-in players"
assert "metadata ->> 'size'" in REPORT_HARDENING and "metadata ->> 'mimetype'" in REPORT_HARDENING, (
    "recognition evidence uploads must enforce byte and media-type limits"
)
assert "file_size_limit = 8388608" in REPORT_HARDENING and "allowed_mime_types" in REPORT_HARDENING, (
    "the private evidence bucket must enforce upload limits before object storage"
)
assert re.search(
    r"label_recognition_report\(.*?security\s+definer\s+set\s+search_path\s*=\s*''",
    REPORT_HARDENING,
    re.I | re.S,
), "the recognition labeling capability must pin an empty search_path"
for policy in ("anonymous connection event insert", "anonymous recognition timing insert"):
    assert re.search(
        rf'alter\s+policy\s+"{re.escape(policy)}".*?to\s+anon\s*,\s*authenticated',
        REPORT_HARDENING,
        re.I | re.S,
    ), f"{policy} must accept signed-in game sessions"
assert "MAX_CAPTURE_BYTES" in SRC and "MAX_OCR_BYTES" in SRC, (
    "the browser must reject oversized recognition evidence before upload"
)
assert not re.search(
    r"grant\s+execute\s+on\s+function\s+public\."
    r"(?:prepare_account_deletion|get_due_account_deletions|run_snapcast_retention)"
    r"[^;]*\s+to\s+(?:anon|authenticated)",
    SQL,
    re.I,
), "service maintenance functions must not be browser executable"
assert "alter default privileges for role postgres in schema public" in FUNCTION_HARDENING
assert "revoke execute on functions from public, anon, authenticated" in FUNCTION_HARDENING, (
    "SECURITY DEFINER functions must be deny-by-default for API roles"
)
assert "and procedures.prosecdef" in FUNCTION_HARDENING
assert "revoke all on function %s from public, anon, authenticated" in FUNCTION_HARDENING, (
    "existing SECURITY DEFINER functions must have inherited API grants removed"
)
assert QUERY_HARDENING.count("create index if not exists") == 30, (
    "all uncovered foreign-key relationships must keep a supporting index"
)
assert QUERY_HARDENING.count("(select auth.uid())") >= 7, (
    "owner RLS policies must cache auth.uid() once per statement"
)

security_definers = re.findall(
    r"create\s+or\s+replace\s+function\s+([\w.]+)\s*\([^;]*?\)\s*"
    r"returns\s+.*?language\s+\w+\s+(.*?)\$\$",
    SQL,
    re.I | re.S,
)
for name, preamble in security_definers:
    if re.search(r"security\s+definer", preamble, re.I):
        assert re.search(r"set\s+search_path\s*=\s*(?:''|public(?:\s*,\s*extensions)?)", preamble, re.I), (
            f"security-definer function {name} must pin a trusted search_path"
        )

for forbidden in ("dangerouslySetInnerHTML", ".innerHTML", "eval("):
    assert forbidden not in SRC, f"unsafe browser rendering primitive found: {forbidden}"

print(f"account security guards passed ({len(EXPECTED_RLS)} RLS tables)")
