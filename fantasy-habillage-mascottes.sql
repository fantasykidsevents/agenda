-- Fantasy App : fiches d'habillage des mascottes, avec photos privées.
-- À exécuter par Jordan dans Supabase > SQL Editor.
-- Réexécutable sans effacer les fiches existantes.

create table if not exists public.mascotte_habillage (
  personnage text primary key check (length(btrim(personnage)) between 1 and 80),
  etapes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(etapes) = 'array' and jsonb_array_length(etapes) <= 20),
  maj_par text,
  maj_le timestamptz not null default now()
);

create or replace function public.est_responsable_mascotte()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.equipe e
    where lower(btrim(e.email)) = lower(btrim(auth.jwt() ->> 'email'))
      and e.responsable is true
  );
$$;
revoke all on function public.est_responsable_mascotte() from public, anon;
grant execute on function public.est_responsable_mascotte() to authenticated;

alter table public.mascotte_habillage enable row level security;
revoke all on public.mascotte_habillage from anon, authenticated;
grant select, insert, update on public.mascotte_habillage to authenticated;

drop policy if exists mascotte_habillage_lire on public.mascotte_habillage;
create policy mascotte_habillage_lire on public.mascotte_habillage
  for select to authenticated using (true);
drop policy if exists mascotte_habillage_ajouter on public.mascotte_habillage;
create policy mascotte_habillage_ajouter on public.mascotte_habillage
  for insert to authenticated with check (public.est_responsable_mascotte());
drop policy if exists mascotte_habillage_modifier on public.mascotte_habillage;
create policy mascotte_habillage_modifier on public.mascotte_habillage
  for update to authenticated using (public.est_responsable_mascotte())
  with check (public.est_responsable_mascotte());

-- Le bucket est privé : seuls les utilisateurs connectés voient les photos
-- via des liens signés d'une heure. Seul un responsable peut en envoyer.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('habillage-mascottes', 'habillage-mascottes', false, 8388608, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists mascotte_photos_lire on storage.objects;
create policy mascotte_photos_lire on storage.objects
  for select to authenticated using (bucket_id = 'habillage-mascottes');
drop policy if exists mascotte_photos_ajouter on storage.objects;
create policy mascotte_photos_ajouter on storage.objects
  for insert to authenticated with check (
    bucket_id = 'habillage-mascottes'
    and public.est_responsable_mascotte()
  );
drop policy if exists mascotte_photos_supprimer on storage.objects;
create policy mascotte_photos_supprimer on storage.objects
  for delete to authenticated using (
    bucket_id = 'habillage-mascottes'
    and public.est_responsable_mascotte()
  );
