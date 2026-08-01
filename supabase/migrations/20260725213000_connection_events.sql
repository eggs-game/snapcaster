-- Privacy-limited multiplayer connection diagnostics. These reports identify
-- unexpected presence/WebRTC failures without storing player names, messages,
-- media information, IP addresses, or raw room codes.
create extension if not exists pgcrypto;

create table if not exists public.connection_events (
  id uuid primary key,
  room_fingerprint text not null,
  observer_id text not null,
  observer_session_id text not null,
  subject_id text not null default '',
  event_type text not null,
  role text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  visibility_state text not null default '',
  browser_online boolean not null default true,
  details jsonb not null default '{}'::jsonb,
  constraint connection_events_room_fingerprint_length check (char_length(room_fingerprint) between 16 and 32),
  constraint connection_events_room_fingerprint_hex check (room_fingerprint ~ '^[0-9a-f]+$'),
  constraint connection_events_observer_id_length check (char_length(observer_id) <= 40),
  constraint connection_events_session_id_length check (char_length(observer_session_id) <= 64),
  constraint connection_events_subject_id_length check (char_length(subject_id) <= 40),
  constraint connection_events_role check (role in ('player', 'visitor')),
  constraint connection_events_type check (
    event_type in (
      'room-joined',
      'realtime-channel-error',
      'realtime-timed-out',
      'realtime-closed',
      'realtime-recovered',
      'client-rejoined',
      'self-presence-missing',
      'intentional-leave',
      'unexpected-peer-drop',
      'peer-reconnected',
      'peer-connection-failed',
      'peer-connection-recovered',
      'browser-offline',
      'browser-online'
    )
  ),
  constraint connection_events_details_object check (jsonb_typeof(details) = 'object'),
  constraint connection_events_details_size check (pg_column_size(details) <= 8192)
);

create index if not exists connection_events_room_time_idx
  on public.connection_events (room_fingerprint, occurred_at desc);

alter table public.connection_events enable row level security;

-- Snapcast does not have accounts yet. Browsers may submit diagnostics, but
-- anonymous clients cannot read them back; investigation happens in the
-- Supabase dashboard.
drop policy if exists "anonymous connection event insert"
  on public.connection_events;
create policy "anonymous connection event insert"
  on public.connection_events for insert to anon
  with check (
    char_length(room_fingerprint) between 16 and 32
    and room_fingerprint ~ '^[0-9a-f]+$'
    and char_length(observer_id) <= 40
    and char_length(observer_session_id) <= 64
    and char_length(subject_id) <= 40
    and role in ('player', 'visitor')
    and event_type in (
      'room-joined',
      'realtime-channel-error',
      'realtime-timed-out',
      'realtime-closed',
      'realtime-recovered',
      'client-rejoined',
      'self-presence-missing',
      'intentional-leave',
      'unexpected-peer-drop',
      'peer-reconnected',
      'peer-connection-failed',
      'peer-connection-recovered',
      'browser-offline',
      'browser-online'
    )
    and occurred_at between now() - interval '1 day' and now() + interval '5 minutes'
    and pg_column_size(details) <= 8192
  );
