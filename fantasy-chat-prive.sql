-- Fantasy App : conversations privees avec les membres choisis.
-- A executer une seule fois dans Supabase > SQL Editor AVANT d'utiliser
-- le bouton « Nouvelle conversation privee » dans l'application.

create table if not exists public.chat_groupes (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(btrim(nom)) between 1 and 80),
  createur_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_groupes_membres (
  groupe_id uuid not null references public.chat_groupes(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  primary key (groupe_id, email)
);
create index if not exists chat_groupes_membres_email_idx on public.chat_groupes_membres (email);

-- Fonction a privileges limites pour verifier l'appartenance sans boucle RLS.
create or replace function public.est_membre_chat_groupe(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_groupes_membres gm
    where gm.groupe_id = p_id
      and gm.email = lower(btrim(auth.jwt() ->> 'email'))
  );
$$;

alter table public.chat_groupes enable row level security;
alter table public.chat_groupes_membres enable row level security;

drop policy if exists chat_groupes_lire_membre on public.chat_groupes;
create policy chat_groupes_lire_membre on public.chat_groupes
  for select to authenticated using (public.est_membre_chat_groupe(id));

drop policy if exists chat_groupes_membres_lire on public.chat_groupes_membres;
create policy chat_groupes_membres_lire on public.chat_groupes_membres
  for select to authenticated using (public.est_membre_chat_groupe(groupe_id));

revoke all on public.chat_groupes, public.chat_groupes_membres from anon, authenticated;
grant select on public.chat_groupes, public.chat_groupes_membres to authenticated;

-- Les groupes sont crees uniquement par un responsable, avec des adresses
-- presentes dans l'equipe. Le createur est toujours participant.
create or replace function public.creer_chat_groupe(p_nom text, p_emails text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_moi text := lower(btrim(auth.jwt() ->> 'email'));
  v_emails text[];
  v_id uuid;
begin
  if v_moi is null or v_moi = '' or not exists (
    select 1 from public.equipe e
    where lower(btrim(e.email)) = v_moi and e.responsable is true
  ) then
    raise exception 'Seul un responsable peut creer une conversation.';
  end if;

  select coalesce(array_agg(distinct adresse), array[]::text[])
    into v_emails
  from (
    select lower(btrim(x)) as adresse from unnest(coalesce(p_emails, array[]::text[])) x
    where x is not null and btrim(x) <> '' and lower(btrim(x)) <> v_moi
  ) candidats;

  if cardinality(v_emails) < 1 or cardinality(v_emails) > 40 then
    raise exception 'Choisis entre 1 et 40 membres.';
  end if;
  if exists (
    select 1 from unnest(v_emails) as p(adresse)
    where not exists (
      select 1 from public.equipe e where lower(btrim(e.email)) = p.adresse
    )
  ) then
    raise exception 'Un membre selectionne ne figure pas dans l equipe.';
  end if;
  if nullif(btrim(p_nom), '') is null or length(btrim(p_nom)) > 80 then
    raise exception 'Indique un nom de conversation de 1 a 80 caracteres.';
  end if;

  insert into public.chat_groupes(nom, createur_email)
  values (btrim(p_nom), v_moi) returning id into v_id;

  insert into public.chat_groupes_membres(groupe_id, email)
    select v_id, adresse from (
      select v_moi as adresse union select unnest(v_emails)
    ) participants;
  return v_id;
end;
$$;

revoke all on function public.creer_chat_groupe(text,text[]) from public, anon;
grant execute on function public.creer_chat_groupe(text,text[]) to authenticated;
revoke all on function public.est_membre_chat_groupe(uuid) from public, anon;
grant execute on function public.est_membre_chat_groupe(uuid) to authenticated;

-- Les anciens chats equipe/animation conservent leur fonctionnement.
-- Sur les nouveaux canaux grp:<uuid>, les messages sont visibles seulement
-- par les membres, meme si une ancienne politique est tres permissive.
create or replace function public.autorise_canal_chat_prive(p_canal text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_id text;
begin
  if p_canal is null then return false; end if;
  if p_canal not like 'grp:%' then return true; end if;
  v_id := substring(p_canal from 5);
  if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.est_membre_chat_groupe(v_id::uuid);
end;
$$;
revoke all on function public.autorise_canal_chat_prive(text) from public, anon;
grant execute on function public.autorise_canal_chat_prive(text) to authenticated;

alter table public.messages enable row level security;

drop policy if exists messages_groupe_iso_select on public.messages;
create policy messages_groupe_iso_select on public.messages as restrictive
  for select to authenticated using (public.autorise_canal_chat_prive(canal));
drop policy if exists messages_groupe_iso_insert on public.messages;
create policy messages_groupe_iso_insert on public.messages as restrictive
  for insert to authenticated with check (public.autorise_canal_chat_prive(canal));
drop policy if exists messages_groupe_iso_update on public.messages;
create policy messages_groupe_iso_update on public.messages as restrictive
  for update to authenticated using (public.autorise_canal_chat_prive(canal))
  with check (public.autorise_canal_chat_prive(canal));
drop policy if exists messages_groupe_iso_delete on public.messages;
create policy messages_groupe_iso_delete on public.messages as restrictive
  for delete to authenticated using (public.autorise_canal_chat_prive(canal));

-- La permission explicite ci-dessous rend les groupes fonctionnels meme
-- si les anciennes politiques ne connaissaient que les canaux equipe/ev.
drop policy if exists messages_groupe_lire on public.messages;
create policy messages_groupe_lire on public.messages
  for select to authenticated
  using (canal like 'grp:%' and public.autorise_canal_chat_prive(canal));
drop policy if exists messages_groupe_envoyer on public.messages;
create policy messages_groupe_envoyer on public.messages
  for insert to authenticated
  with check (canal like 'grp:%' and public.autorise_canal_chat_prive(canal));
