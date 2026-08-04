alter table public.deep_research_runs add column if not exists title text;
alter table public.deep_research_runs add column if not exists notes text;
alter table public.deep_research_runs add column if not exists archived_at timestamptz;
alter table public.deep_research_runs add constraint deep_research_title_length check(title is null or char_length(title)<=200) not valid;
alter table public.deep_research_runs add constraint deep_research_notes_length check(notes is null or char_length(notes)<=100000) not valid;
create index if not exists deep_research_runs_user_archive_updated_idx on public.deep_research_runs(user_id,archived_at,updated_at desc);
