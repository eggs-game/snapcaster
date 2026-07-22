-- Durable evidence for user-reported recognition mistakes. Apply with the
-- Supabase CLI or paste into the SQL Editor before deploying this feature.
create extension if not exists pgcrypto;

create table if not exists public.recognition_reports (
  id uuid primary key,
  edit_token uuid not null,
  room_code text not null,
  reporter_id text not null,
  reporter_name text not null,
  created_at timestamptz not null default now(),
  labeled_at timestamptz,
  predicted_card jsonb,
  truth_card jsonb,
  matches jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,
  capture_context jsonb not null default '{}'::jsonb,
  capture_path text not null,
  ocr_path text,
  camera_resolution text not null default ''
);

alter table public.recognition_reports enable row level security;

-- Snapcaster has no account system yet. The app may submit evidence but cannot
-- read the corpus back; curation happens in the Supabase dashboard. A future
-- authenticated user model can replace this anonymous insert policy.
create policy "anonymous recognition report insert"
  on public.recognition_reports for insert to anon with check (true);

-- The random edit token is stored only in the reporting browser. It permits a
-- later true-card label without exposing any report rows to anonymous clients.
create or replace function public.label_recognition_report(
  p_report_id uuid,
  p_edit_token uuid,
  p_truth_card jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.recognition_reports
  set truth_card = p_truth_card, labeled_at = now()
  where id = p_report_id and edit_token = p_edit_token;
  if not found then
    raise exception 'Recognition report was not found or cannot be labeled';
  end if;
end;
$$;

grant execute on function public.label_recognition_report(uuid, uuid, jsonb) to anon;

insert into storage.buckets (id, name, public)
values ('recognition-reports', 'recognition-reports', false)
on conflict (id) do nothing;

create policy "anonymous recognition report upload"
  on storage.objects for insert to anon
  with check (bucket_id = 'recognition-reports');
