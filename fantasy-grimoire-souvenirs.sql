-- Fantasy App : grimoires personnels des souvenirs (anciens + actuels).
-- A executer par Jordan dans Supabase > SQL Editor.
-- Relancable : ne supprime ni photos, ni souvenirs existants.

create table if not exists public.souvenirs_fantasy (
  id uuid primary key default gen_random_uuid(),
  membre_email text not null,
  annee integer not null check (annee between 1990 and 2100),
  titre text not null check (length(btrim(titre)) between 1 and 120),
  texte text check (texte is null or length(texte) <= 1500),
  photo_path text,
  cree_par_email text not null,
  statut text not null default 'attente' check (statut in ('attente', 'publie', 'refuse')),
  created_at timestamptz not null default now(),
  valide_par_email text,
  valide_le timestamptz
);
create index if not exists souvenirs_fantasy_membre_idx on public.souvenirs_fantasy(membre_email, annee);

create or replace function public.est_responsable_souvenirs()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.equipe e
    where lower(btrim(e.email)) = lower(btrim(auth.jwt() ->> 'email'))
      and e.responsable is true
  );
$$;
revoke all on function public.est_responsable_souvenirs() from public, anon;
grant execute on function public.est_responsable_souvenirs() to authenticated;

alter table public.souvenirs_fantasy enable row level security;
revoke all on public.souvenirs_fantasy from anon, authenticated;
grant select, insert, update on public.souvenirs_fantasy to authenticated;

drop policy if exists souvenirs_lire on public.souvenirs_fantasy;
create policy souvenirs_lire on public.souvenirs_fantasy
  for select to authenticated
  using (membre_email = lower(btrim(auth.jwt() ->> 'email')) or public.est_responsable_souvenirs());

drop policy if exists souvenirs_proposer on public.souvenirs_fantasy;
create policy souvenirs_proposer on public.souvenirs_fantasy
  for insert to authenticated
  with check (
    cree_par_email = lower(btrim(auth.jwt() ->> 'email'))
    and (photo_path is null or split_part(photo_path, '/', 1) = auth.uid()::text)
    and (
      public.est_responsable_souvenirs()
      or (membre_email = lower(btrim(auth.jwt() ->> 'email')) and statut = 'attente')
    )
  );

drop policy if exists souvenirs_valider on public.souvenirs_fantasy;
create policy souvenirs_valider on public.souvenirs_fantasy
  for update to authenticated
  using (public.est_responsable_souvenirs())
  with check (public.est_responsable_souvenirs());

-- Photos privees : l'auteur, le membre concerne et les responsables.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('souvenirs-fantasy', 'souvenirs-fantasy', false, 7340032, array['image/jpeg'])
on conflict (id) do nothing;

create or replace function public.peut_voir_photo_souvenir(p_chemin text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_chemin, '/', 1) = auth.uid()::text
    or public.est_responsable_souvenirs()
    or exists (
      select 1 from public.souvenirs_fantasy s
      where s.photo_path = p_chemin
        and s.membre_email = lower(btrim(auth.jwt() ->> 'email'))
    );
$$;
revoke all on function public.peut_voir_photo_souvenir(text) from public, anon;
grant execute on function public.peut_voir_photo_souvenir(text) to authenticated;

drop policy if exists souvenirs_photos_lire on storage.objects;
create policy souvenirs_photos_lire on storage.objects
  for select to authenticated
  using (bucket_id = 'souvenirs-fantasy' and public.peut_voir_photo_souvenir(name));

drop policy if exists souvenirs_photos_ajouter on storage.objects;
create policy souvenirs_photos_ajouter on storage.objects
  for insert to authenticated
  with check (bucket_id = 'souvenirs-fantasy' and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists souvenirs_photos_supprimer on storage.objects;
create policy souvenirs_photos_supprimer on storage.objects
  for delete to authenticated
  using (bucket_id = 'souvenirs-fantasy' and split_part(name, '/', 1) = auth.uid()::text);
