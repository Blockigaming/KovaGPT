-- Complete the durable response-feedback contract used by feedback.functions.ts.
-- Existing nullable rows are retained for operational review but can no longer be
-- read or mutated by browser clients.
alter table public.feedback_submissions
  add column if not exists conversation_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.feedback_submissions
  drop constraint if exists feedback_submissions_rating_check;
alter table public.feedback_submissions
  add constraint feedback_submissions_rating_check check (rating in ('up', 'down')) not valid;

-- The application always writes authenticated response feedback. Delete legacy
-- anonymous rows before enforcing the production invariant.
delete from public.feedback_submissions where owner_id is null;
alter table public.feedback_submissions alter column owner_id set not null;
alter table public.feedback_submissions alter column message_id set not null;
alter table public.feedback_submissions alter column rating set not null;
alter table public.feedback_submissions
  add constraint feedback_submissions_duplicate_key_sha256
  check (duplicate_key ~ '^[0-9a-f]{64}$') not valid;
alter table public.feedback_submissions
  add constraint feedback_submissions_context_excerpt_size
  check (context_excerpt is null or char_length(context_excerpt) <= 2000) not valid;

create unique index if not exists feedback_submissions_owner_message_uidx
  on public.feedback_submissions(owner_id, message_id);
create index if not exists feedback_submissions_owner_updated_idx
  on public.feedback_submissions(owner_id, updated_at desc);

create or replace function public.set_feedback_submission_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists feedback_submissions_set_updated_at on public.feedback_submissions;
create trigger feedback_submissions_set_updated_at
before update on public.feedback_submissions
for each row execute function public.set_feedback_submission_updated_at();

alter table public.feedback_submissions enable row level security;

drop policy if exists "Users create feedback" on public.feedback_submissions;
drop policy if exists "Users read their feedback" on public.feedback_submissions;
drop policy if exists "Owners insert response feedback" on public.feedback_submissions;
drop policy if exists "Owners read response feedback" on public.feedback_submissions;
drop policy if exists "Owners update response feedback" on public.feedback_submissions;
drop policy if exists "Owners delete response feedback" on public.feedback_submissions;

create policy "Owners insert response feedback"
on public.feedback_submissions for insert to authenticated
with check (auth.uid() = owner_id);
create policy "Owners read response feedback"
on public.feedback_submissions for select to authenticated
using (auth.uid() = owner_id);
create policy "Owners update response feedback"
on public.feedback_submissions for update to authenticated
using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "Owners delete response feedback"
on public.feedback_submissions for delete to authenticated
using (auth.uid() = owner_id);

revoke all on public.feedback_submissions from anon;
grant select, insert, update, delete on public.feedback_submissions to authenticated;
