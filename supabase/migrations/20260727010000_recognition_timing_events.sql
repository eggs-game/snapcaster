-- Privacy-limited card-lookup performance telemetry. These rows contain
-- timings and bounded counts only: never card/image/OCR content, names, raw
-- room codes, device labels, IP addresses, or raw error messages.
create table if not exists public.recognition_timing_events (
  id uuid primary key,
  room_fingerprint text not null,
  observer_id text not null default '',
  subject_id text not null default '',
  role text not null,
  build text not null default '',
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  remote boolean not null,
  outcome text not null,
  capture_ms integer not null default 0,
  recognition_ms integer not null default 0,
  total_ms integer not null default 0,
  capture_chars integer not null default 0,
  candidates_tried integer not null default 0,
  isolation_candidates integer not null default 0,
  stage_ms jsonb not null default '{}'::jsonb,
  outgoing_video_quality text not null default '1080p',
  visibility_state text not null default '',
  browser_online boolean not null default true,
  constraint recognition_timing_room_fingerprint_length
    check (char_length(room_fingerprint) between 16 and 32),
  constraint recognition_timing_room_fingerprint_hex
    check (room_fingerprint ~ '^[0-9a-f]+$'),
  constraint recognition_timing_observer_id_length
    check (char_length(observer_id) <= 40),
  constraint recognition_timing_subject_id_length
    check (char_length(subject_id) <= 40),
  constraint recognition_timing_role
    check (role in ('player', 'visitor')),
  constraint recognition_timing_build_length
    check (char_length(build) <= 160),
  constraint recognition_timing_outcome
    check (outcome in (
      'matched',
      'no-match',
      'capture-timeout',
      'recognition-timeout',
      'capture-error',
      'recognition-error'
    )),
  constraint recognition_timing_capture_ms
    check (capture_ms between 0 and 300000),
  constraint recognition_timing_recognition_ms
    check (recognition_ms between 0 and 300000),
  constraint recognition_timing_total_ms
    check (total_ms between 0 and 300000),
  constraint recognition_timing_capture_chars
    check (capture_chars between 0 and 8388608),
  constraint recognition_timing_candidates
    check (candidates_tried between 0 and 1000),
  constraint recognition_timing_isolation_candidates
    check (isolation_candidates between 0 and 1000),
  constraint recognition_timing_stage_ms_object
    check (jsonb_typeof(stage_ms) = 'object'),
  constraint recognition_timing_stage_ms_size
    check (pg_column_size(stage_ms) <= 2048),
  constraint recognition_timing_quality
    check (outgoing_video_quality in ('720p', '1080p', '1440p', '2160p')),
  constraint recognition_timing_visibility_length
    check (char_length(visibility_state) <= 20)
);

create index if not exists recognition_timing_room_time_idx
  on public.recognition_timing_events (room_fingerprint, occurred_at desc);

create index if not exists recognition_timing_received_time_idx
  on public.recognition_timing_events (received_at desc);

alter table public.recognition_timing_events enable row level security;

-- Browsers may submit bounded timing records but cannot read them back.
-- Investigation and retention management happen in the Supabase dashboard.
drop policy if exists "anonymous recognition timing insert"
  on public.recognition_timing_events;
create policy "anonymous recognition timing insert"
  on public.recognition_timing_events for insert to anon
  with check (
    char_length(room_fingerprint) between 16 and 32
    and room_fingerprint ~ '^[0-9a-f]+$'
    and char_length(observer_id) <= 40
    and char_length(subject_id) <= 40
    and role in ('player', 'visitor')
    and char_length(build) <= 160
    and occurred_at between now() - interval '1 day' and now() + interval '5 minutes'
    and outcome in (
      'matched',
      'no-match',
      'capture-timeout',
      'recognition-timeout',
      'capture-error',
      'recognition-error'
    )
    and capture_ms between 0 and 300000
    and recognition_ms between 0 and 300000
    and total_ms between 0 and 300000
    and capture_chars between 0 and 8388608
    and candidates_tried between 0 and 1000
    and isolation_candidates between 0 and 1000
    and jsonb_typeof(stage_ms) = 'object'
    and pg_column_size(stage_ms) <= 2048
    and outgoing_video_quality in ('720p', '1080p', '1440p', '2160p')
    and char_length(visibility_state) <= 20
  );

comment on table public.recognition_timing_events is
  'Insert-only, content-free card lookup performance telemetry; dashboard access only.';
