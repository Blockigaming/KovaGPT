create table if not exists public.testimonial_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  quote text not null,
  display_name text not null,
  display_role text,
  consent_to_publish boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  published boolean not null default false,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

alter table public.testimonial_submissions
  add constraint testimonial_quote_length
  check (char_length(trim(quote)) between 20 and 1000);

alter table public.testimonial_submissions
  add constraint testimonial_display_name_length
  check (char_length(trim(display_name)) between 1 and 120);

alter table public.testimonial_submissions
  add constraint testimonial_role_length
  check (
    display_role is null
    or char_length(trim(display_role)) between 1 and 160
  );

alter table public.testimonial_submissions
  add constraint testimonial_publish_requires_approval
  check (
    published = false
    or (
      status = 'approved'
      and consent_to_publish = true
      and reviewed_at is not null
      and reviewed_by is not null
    )
  );

alter table public.testimonial_submissions enable row level security;

create policy "Users submit their own testimonials"
on public.testimonial_submissions
for insert
to authenticated
with check (
  auth.uid() = owner_id
  and consent_to_publish = true
  and status = 'pending'
  and published = false
  and reviewed_at is null
  and reviewed_by is null
);

create policy "Users read their own testimonial submissions"
on public.testimonial_submissions
for select
to authenticated
using (auth.uid() = owner_id);

create policy "Public reads approved published testimonials"
on public.testimonial_submissions
for select
to anon, authenticated
using (
  published = true
  and status = 'approved'
  and consent_to_publish = true
  and reviewed_at is not null
  and reviewed_by is not null
);

create index if not exists testimonial_submissions_owner_idx
  on public.testimonial_submissions(owner_id, submitted_at desc);

create index if not exists testimonial_submissions_review_idx
  on public.testimonial_submissions(status, published, submitted_at desc);
