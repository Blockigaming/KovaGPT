begin;
alter table public.projects add column appearance jsonb not null default '{}'::jsonb;
alter table public.projects add constraint project_appearance_shape check (
  jsonb_typeof(appearance) = 'object' and octet_length(appearance::text) <= 370000
  and appearance - array['emoji','logo','background','cover'] = '{}'::jsonb
  and (not appearance ? 'emoji' or (jsonb_typeof(appearance->'emoji') = 'string' and char_length(appearance->>'emoji') <= 16))
  and (not appearance ? 'background' or jsonb_typeof(appearance->'background') = 'string' and appearance->>'background' ~ '^#[0-9a-fA-F]{6}$')
  and (not appearance ? 'logo' or (jsonb_typeof(appearance->'logo') = 'string' and char_length(appearance->>'logo') <= 180000 and appearance->>'logo' ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'))
  and (not appearance ? 'cover' or (jsonb_typeof(appearance->'cover') = 'string' and char_length(appearance->>'cover') <= 180000 and appearance->>'cover' ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'))
);
-- Existing project RLS and owner-only mutation checks also protect appearance.
commit;
