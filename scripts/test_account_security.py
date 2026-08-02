#!/usr/bin/env python3
"""Static launch guards for Snapcast's browser-accessible account schema."""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SQL = "\n".join(path.read_text() for path in MIGRATIONS)
SRC = "\n".join(path.read_text() for path in (ROOT / "src").glob("**/*") if path.is_file())
VALIDATED_COMMANDERS = (ROOT / "supabase" / "migrations" / "20260726190000_validated_commanders.sql").read_text()
REPORT_HARDENING = (ROOT / "supabase" / "migrations" / "20260801130000_recognition_report_hardening.sql").read_text()
FUNCTION_HARDENING = (ROOT / "supabase" / "migrations" / "20260802002000_function_privilege_hardening.sql").read_text()
QUERY_HARDENING = (ROOT / "supabase" / "migrations" / "20260802003000_query_performance_hardening.sql").read_text()

EXPECTED_RLS = {
    "profiles", "account_private", "account_preferences", "game_rooms",
    "game_memberships", "game_sessions", "game_session_participants",
    "game_session_commanders", "game_turns", "game_result_corrections",
    "game_audit_log", "saved_commander_decks", "player_blocks",
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
assert not re.search(r"grant\s+[^;]*update[^;]*on\s+public\.profile_notifications", SQL, re.I), (
    "browser clients must not rewrite notification action references"
)
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
