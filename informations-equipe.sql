-- Fantasy Kids Events : informations importantes + accusés de lecture.
-- À exécuter UNE fois dans Supabase > SQL Editor > Run. Réexécution sans perte d'informations.
begin;

create table if not exists public.infos_equipe (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  contenu text not null,
  cree_par uuid default auth.uid(),
  cree_le timestamptz not null default now()
);
create index if not exists infos_equipe_recent on public.infos_equipe (cree_le desc);

create table if not exists public.infos_equipe_lectures (
  info_id uuid not null references public.infos_equipe(id) on delete cascade,
  email text not null,
  lu_le timestamptz not null default now(),
  primary key (info_id,email)
);

create table if not exists public.infos_equipe_relances (
  info_id uuid not null references public.infos_equipe(id) on delete cascade,
  email text not null,
  relance_le timestamptz not null default now(),
  primary key (info_id,email)
);

-- Consultation par chaque membre de l'équipe ; les listes nominatives des
-- lectures sont réservées aux responsables (le membre voit sa propre lecture).
alter table public.infos_equipe enable row level security;
alter table public.infos_equipe_lectures enable row level security;
alter table public.infos_equipe_relances enable row level security;

drop policy if exists infos_equipe_lire on public.infos_equipe;
create policy infos_equipe_lire on public.infos_equipe
  for select to authenticated using (
    exists(select 1 from public.equipe e
      where lower(btrim(e.email))=lower(btrim(auth.jwt()->>'email')))
  );
drop policy if exists infos_equipe_lectures_lire on public.infos_equipe_lectures;
create policy infos_equipe_lectures_lire on public.infos_equipe_lectures
  for select to authenticated using (
    email=lower(btrim(auth.jwt()->>'email'))
    or exists(select 1 from public.equipe e
      where lower(btrim(e.email))=lower(btrim(auth.jwt()->>'email'))
        and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false)))
  );

revoke all on public.infos_equipe,public.infos_equipe_lectures,public.infos_equipe_relances
  from anon,authenticated;
grant select on public.infos_equipe,public.infos_equipe_lectures to authenticated;

create or replace function public.publier_info_equipe(
  p_titre text,p_contenu text
) returns uuid language plpgsql security definer
set search_path = public,pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_id uuid;
  v_mail text;
begin
  if not exists(select 1 from public.equipe e
    where lower(btrim(e.email))=v_email
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))) then
    raise exception 'Publication réservée aux responsables.';
  end if;
  if length(btrim(coalesce(p_titre,''))) not between 3 and 150 then
    raise exception 'Le titre doit contenir entre 3 et 150 caractères.';
  end if;
  if length(btrim(coalesce(p_contenu,''))) not between 3 and 3000 then
    raise exception 'Le message doit contenir entre 3 et 3000 caractères.';
  end if;

  insert into public.infos_equipe(titre,contenu)
    values(btrim(p_titre),btrim(p_contenu)) returning id into v_id;

  for v_mail in
    select distinct lower(btrim(e.email))
    from public.equipe e
    where nullif(btrim(e.email),'') is not null and e.email like '%@%'
  loop
    insert into public.notifications_app(destinataire_email,titre,message,type,lien)
      values(v_mail,'📣 Info importante : '||btrim(p_titre),
        left(btrim(p_contenu),240),'info_equipe',
        './index.html?infos='||v_id::text);
  end loop;
  return v_id;
end;
$$;

create or replace function public.accuser_lecture_info_equipe(
  p_info_id uuid
) returns void language plpgsql security definer
set search_path = public,pg_temp
as $$
declare v_email text := lower(btrim(coalesce(auth.jwt()->>'email','')));
begin
  if not exists(select 1 from public.equipe e
      where lower(btrim(e.email))=v_email) then
    raise exception 'Votre compte doit être associé à l’équipe.';
  end if;
  if not exists(select 1 from public.infos_equipe i where i.id=p_info_id) then
    raise exception 'Information introuvable.';
  end if;
  insert into public.infos_equipe_lectures(info_id,email)
    values(p_info_id,v_email) on conflict(info_id,email) do nothing;
end;
$$;

create or replace function public.relancer_lectures_info_equipe(
  p_info_id uuid
) returns integer language plpgsql security definer
set search_path = public,pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_mail text;
  v_titre text;
  v_nombre integer := 0;
begin
  if not exists(select 1 from public.equipe e
    where lower(btrim(e.email))=v_email
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))) then
    raise exception 'Relance réservée aux responsables.';
  end if;
  select titre into v_titre from public.infos_equipe where id=p_info_id;
  if not found then raise exception 'Information introuvable.'; end if;

  -- Ne relancer que les personnes sans lecture confirmée.
  -- Maximum une relance par personne toutes les 24 heures.
  for v_mail in
    select distinct lower(btrim(e.email))
    from public.equipe e
    where nullif(btrim(e.email),'') is not null and e.email like '%@%'
      and not exists(
        select 1 from public.infos_equipe_lectures l
        where l.info_id=p_info_id and l.email=lower(btrim(e.email))
      )
      and not exists(
        select 1 from public.infos_equipe_relances r
        where r.info_id=p_info_id and r.email=lower(btrim(e.email))
          and r.relance_le>now()-interval '24 hours'
      )
  loop
    insert into public.notifications_app(destinataire_email,titre,message,type,lien)
      values(v_mail,'⏰ Info à lire : '||v_titre,
        'Merci de lire et confirmer cette information dans l’application.',
        'info_equipe','./index.html?infos='||p_info_id::text);
    insert into public.infos_equipe_relances(info_id,email,relance_le)
      values(p_info_id,v_mail,now())
      on conflict(info_id,email) do update set relance_le=excluded.relance_le;
    v_nombre:=v_nombre+1;
  end loop;
  return v_nombre;
end;
$$;

create or replace function public.supprimer_info_equipe(
  p_info_id uuid
) returns void language plpgsql security definer
set search_path = public,pg_temp
as $$
declare v_email text := lower(btrim(coalesce(auth.jwt()->>'email','')));
begin
  if not exists(select 1 from public.equipe e
    where lower(btrim(e.email))=v_email
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))) then
    raise exception 'Suppression réservée aux responsables.';
  end if;
  if not exists(select 1 from public.infos_equipe where id=p_info_id) then
    raise exception 'Information introuvable.';
  end if;
  -- Nettoyer uniquement les notifications liées à l'information sélectionnée.
  delete from public.notifications_app
    where type='info_equipe' and lien='./index.html?infos='||p_info_id::text;
  delete from public.infos_equipe where id=p_info_id;
end;
$$;

revoke all on function public.publier_info_equipe(text,text) from public;
revoke all on function public.accuser_lecture_info_equipe(uuid) from public;
revoke all on function public.relancer_lectures_info_equipe(uuid) from public;
revoke all on function public.supprimer_info_equipe(uuid) from public;
grant execute on function public.publier_info_equipe(text,text) to authenticated;
grant execute on function public.accuser_lecture_info_equipe(uuid) to authenticated;
grant execute on function public.relancer_lectures_info_equipe(uuid) to authenticated;
grant execute on function public.supprimer_info_equipe(uuid) to authenticated;
commit;
