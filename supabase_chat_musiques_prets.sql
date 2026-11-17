-- Fantasy Kids Events : enrichissements du chat, bibliothèque musicale et retours de tenues.
-- À exécuter dans Supabase SQL Editor avant de déployer le nouveau site.

alter table public.messages
  add column if not exists reponse_a text,
  add column if not exists audio_path text,
  add column if not exists epingle_le timestamptz,
  add column if not exists epingle_par text;

alter table public.costumes
  add column if not exists retour_prevu date;

-- Seuls les responsables peuvent épingler/désépingler des messages.
create or replace function public.epingler_message_chat(p_message_id text, p_epingle boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_prenom text;
begin
  select e.prenom into v_prenom from public.equipe e
    where lower(btrim(e.email)) = lower(btrim(auth.jwt() ->> 'email'))
      and e.responsable = true limit 1;
  if v_prenom is null then raise exception 'Seuls les responsables peuvent épingler un message.'; end if;
  update public.messages
    set epingle_le = case when p_epingle then now() else null end,
        epingle_par = case when p_epingle then v_prenom else null end
    where id::text = p_message_id;
  if not found then raise exception 'Message introuvable.'; end if;
end $$;
revoke all on function public.epingler_message_chat(text, boolean) from public, anon;
grant execute on function public.epingler_message_chat(text, boolean) to authenticated;

-- Favoris individuels, invisibles aux autres membres.
create table if not exists public.chat_favoris (
  email text not null,
  message_id text not null,
  created_at timestamptz not null default now(),
  primary key (email, message_id)
);
alter table public.chat_favoris enable row level security;
drop policy if exists chat_favoris_lire_soi on public.chat_favoris;
create policy chat_favoris_lire_soi on public.chat_favoris for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
drop policy if exists chat_favoris_ajouter_soi on public.chat_favoris;
create policy chat_favoris_ajouter_soi on public.chat_favoris for insert to authenticated
  with check (lower(email) = lower(auth.jwt() ->> 'email'));
drop policy if exists chat_favoris_supprimer_soi on public.chat_favoris;
create policy chat_favoris_supprimer_soi on public.chat_favoris for delete to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
grant select, insert, delete on public.chat_favoris to authenticated;

-- Fichiers vocaux privés, accessibles uniquement aux membres authentifiés.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-vocaux', 'chat-vocaux', false, 12582912, array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists chat_vocaux_lecture_equipe on storage.objects;
create policy chat_vocaux_lecture_equipe on storage.objects for select to authenticated
  using (bucket_id = 'chat-vocaux' and exists (
    select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email')));
drop policy if exists chat_vocaux_depot_soi on storage.objects;
create policy chat_vocaux_depot_soi on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-vocaux' and split_part(name, '/', 1) = auth.uid()::text
    and exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email')));

-- Morceaux utilisés pendant les animations : stockage privé et métadonnées recherchables.
create table if not exists public.musiques_fantasy (
  id uuid primary key default gen_random_uuid(),
  titre text not null check (btrim(titre) <> ''),
  personnage text not null default '',
  categorie text not null default '',
  notes text not null default '',
  fichier_path text not null,
  cree_par text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists musiques_fantasy_titre_idx on public.musiques_fantasy (titre);
alter table public.musiques_fantasy enable row level security;
drop policy if exists musiques_fantasy_lecture_equipe on public.musiques_fantasy;
create policy musiques_fantasy_lecture_equipe on public.musiques_fantasy for select to authenticated
  using (exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email')));
drop policy if exists musiques_fantasy_ajout_responsable on public.musiques_fantasy;
create policy musiques_fantasy_ajout_responsable on public.musiques_fantasy for insert to authenticated
  with check (exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email') and e.responsable = true));
drop policy if exists musiques_fantasy_suppression_responsable on public.musiques_fantasy;
create policy musiques_fantasy_suppression_responsable on public.musiques_fantasy for delete to authenticated
  using (exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email') and e.responsable = true));
grant select, insert, delete on public.musiques_fantasy to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('musiques-fantasy', 'musiques-fantasy', false, 52428800,
  array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/aac'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists musiques_fantasy_telecharger on storage.objects;
create policy musiques_fantasy_telecharger on storage.objects for select to authenticated
  using (bucket_id = 'musiques-fantasy' and exists (
    select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email')));
drop policy if exists musiques_fantasy_deposer on storage.objects;
create policy musiques_fantasy_deposer on storage.objects for insert to authenticated
  with check (bucket_id = 'musiques-fantasy' and split_part(name, '/', 1) = auth.uid()::text
    and exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email') and e.responsable = true));
drop policy if exists musiques_fantasy_effacer on storage.objects;
create policy musiques_fantasy_effacer on storage.objects for delete to authenticated
  using (bucket_id = 'musiques-fantasy' and exists (
    select 1 from public.equipe e where lower(e.email) = lower(auth.jwt() ->> 'email') and e.responsable = true));
