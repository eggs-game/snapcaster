-- Harden opt-in recognition evidence now that browser sessions may be either
-- anonymous guests or signed-in accounts. Reports stay write-only to clients,
-- and every database/storage payload is bounded before it reaches durable
-- storage.

alter table public.recognition_reports
  add constraint recognition_reports_room_code_format
    check (room_code ~ '^[A-HJ-KM-NP-Z2-9]{6}$') not valid,
  add constraint recognition_reports_reporter_id_length
    check (char_length(reporter_id) between 1 and 40) not valid,
  add constraint recognition_reports_reporter_name_length
    check (char_length(reporter_name) between 1 and 80) not valid,
  add constraint recognition_reports_capture_path
    check (capture_path = id::text || '/capture.jpg') not valid,
  add constraint recognition_reports_ocr_path
    check (ocr_path is null or ocr_path = id::text || '/ocr.jpg') not valid,
  add constraint recognition_reports_camera_resolution_length
    check (char_length(camera_resolution) <= 32) not valid,
  add constraint recognition_reports_predicted_card_shape
    check (predicted_card is null or jsonb_typeof(predicted_card) = 'object') not valid,
  add constraint recognition_reports_predicted_card_size
    check (predicted_card is null or pg_column_size(predicted_card) <= 16384) not valid,
  add constraint recognition_reports_truth_card_shape
    check (truth_card is null or jsonb_typeof(truth_card) = 'object') not valid,
  add constraint recognition_reports_truth_card_size
    check (truth_card is null or pg_column_size(truth_card) <= 16384) not valid,
  add constraint recognition_reports_matches_shape
    check (jsonb_typeof(matches) = 'array') not valid,
  add constraint recognition_reports_matches_size
    check (pg_column_size(matches) <= 65536) not valid,
  add constraint recognition_reports_diagnostics_shape
    check (jsonb_typeof(diagnostics) = 'object') not valid,
  add constraint recognition_reports_diagnostics_size
    check (pg_column_size(diagnostics) <= 65536) not valid,
  add constraint recognition_reports_capture_context_shape
    check (jsonb_typeof(capture_context) = 'object') not valid,
  add constraint recognition_reports_capture_context_size
    check (pg_column_size(capture_context) <= 32768) not valid;

grant insert on public.recognition_reports to anon, authenticated;

drop policy if exists "anonymous recognition report insert"
  on public.recognition_reports;
drop policy if exists "bounded recognition report insert"
  on public.recognition_reports;
create policy "bounded recognition report insert"
  on public.recognition_reports for insert to anon, authenticated
  with check (
    room_code ~ '^[A-HJ-KM-NP-Z2-9]{6}$'
    and char_length(reporter_id) between 1 and 40
    and char_length(reporter_name) between 1 and 80
    and created_at between now() - interval '1 day' and now() + interval '5 minutes'
    and capture_path = id::text || '/capture.jpg'
    and (ocr_path is null or ocr_path = id::text || '/ocr.jpg')
    and char_length(camera_resolution) <= 32
    and (predicted_card is null or (
      jsonb_typeof(predicted_card) = 'object'
      and pg_column_size(predicted_card) <= 16384
    ))
    and jsonb_typeof(matches) = 'array'
    and pg_column_size(matches) <= 65536
    and jsonb_typeof(diagnostics) = 'object'
    and pg_column_size(diagnostics) <= 65536
    and jsonb_typeof(capture_context) = 'object'
    and pg_column_size(capture_context) <= 32768
  );

create or replace function public.label_recognition_report(
  p_report_id uuid,
  p_edit_token uuid,
  p_truth_card jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(p_truth_card) <> 'object' or pg_column_size(p_truth_card) > 16384 then
    raise exception 'Recognition label is invalid';
  end if;

  update public.recognition_reports
  set truth_card = p_truth_card, labeled_at = now()
  where id = p_report_id and edit_token = p_edit_token;
  if not found then
    raise exception 'Recognition report was not found or cannot be labeled';
  end if;
end;
$$;

revoke all on function public.label_recognition_report(uuid, uuid, jsonb) from public;
grant execute on function public.label_recognition_report(uuid, uuid, jsonb)
  to anon, authenticated;

-- Storage enforces these before accepting the object body. The object policy
-- below adds the narrower UUID/path contract and a smaller OCR-specific cap.
update storage.buckets
set file_size_limit = 8388608,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'recognition-reports';

drop policy if exists "anonymous recognition report upload"
  on storage.objects;
drop policy if exists "bounded recognition report upload"
  on storage.objects;
create policy "bounded recognition report upload"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'recognition-reports'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(capture|ocr)\.jpg$'
    and lower(coalesce(metadata ->> 'mimetype', '')) in ('image/jpeg', 'image/png', 'image/webp')
    and coalesce((metadata ->> 'size')::bigint, 0) between 1 and
      case when name like '%/ocr.jpg' then 2097152 else 8388608 end
  );

-- These two telemetry policies predate optional accounts. Without the
-- authenticated role, diagnostics silently stop as soon as a guest links a
-- Discord account during a game.
grant insert on public.connection_events to anon, authenticated;
grant insert on public.recognition_timing_events to anon, authenticated;

alter policy "anonymous connection event insert"
  on public.connection_events to anon, authenticated;
alter policy "anonymous recognition timing insert"
  on public.recognition_timing_events to anon, authenticated;
