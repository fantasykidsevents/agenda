-- Préférences individuelles des conversations mises en sourdine.
-- À exécuter une fois dans Supabase > SQL Editor avant de publier la fonction notifier.
create table if not exists public.chat_muets (
  email text not null check (email = lower(btrim(email))),
  canal text not null check (btrim(canal) <> ''),
  created_at timestamptz not null default now(),
  primary key (email, canal)
);

create index if not exists chat_muets_canal_idx on public.chat_muets (canal);

alter table public.chat_muets enable row level security;

drop policy if exists chat_muets_lire_soi on public.chat_muets;
create policy chat_muets_lire_soi on public.chat_muets
  for select to authenticated
  using (email = lower(btrim(auth.jwt() ->> 'email')));

drop policy if exists chat_muets_ajouter_soi on public.chat_muets;
create policy chat_muets_ajouter_soi on public.chat_muets
  for insert to authenticated
  with check (email = lower(btrim(auth.jwt() ->> 'email')));

drop policy if exists chat_muets_modifier_soi on public.chat_muets;
create policy chat_muets_modifier_soi on public.chat_muets
  for update to authenticated
  using (email = lower(btrim(auth.jwt() ->> 'email')))
  with check (email = lower(btrim(auth.jwt() ->> 'email')));

drop policy if exists chat_muets_supprimer_soi on public.chat_muets;
create policy chat_muets_supprimer_soi on public.chat_muets
  for delete to authenticated
  using (email = lower(btrim(auth.jwt() ->> 'email')));

grant select, insert, update, delete on public.chat_muets to authenticated;
