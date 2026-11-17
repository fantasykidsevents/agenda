-- Fantasy Kids Events · Mes personnages favoris + Boîte à idées
-- À exécuter dans Supabase > SQL Editor > New query > Run.
-- Réexécutable sans effacer les favoris ni les propositions existantes.
begin;

-- L’envoi de push suit les infos déjà diffusées dans la cloche.
alter table public.infos_equipe
  add column if not exists push_envoye_le timestamptz;

create table if not exists public.personnages_favoris (
  email text not null,
  nom text not null,
  ajoute_le timestamptz not null default now(),
  primary key (email, nom)
);
create index if not exists personnages_favoris_email_idx on public.personnages_favoris(email);
alter table public.personnages_favoris enable row level security;
drop policy if exists personnages_favoris_lire on public.personnages_favoris;
create policy personnages_favoris_lire on public.personnages_favoris
  for select to authenticated using (
    email=lower(btrim(coalesce(auth.jwt()->>'email','')))
    and exists (
      select 1 from public.equipe e
      where lower(btrim(e.email))=lower(btrim(coalesce(auth.jwt()->>'email','')))
    )
  );
revoke all on public.personnages_favoris from anon,authenticated;
grant select on public.personnages_favoris to authenticated;

create or replace function public.definir_personnages_favoris(p_noms text[])
returns void language plpgsql security definer
set search_path = public,pg_temp
as $$
declare
  v_email text:=lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_noms text[];
begin
  if v_email='' or not exists (
    select 1 from public.equipe e where lower(btrim(e.email))=v_email
  ) then raise exception 'Compte non associé à l’équipe Fantasy.'; end if;
  select coalesce(array_agg(distinct nom),array[]::text[]) into v_noms
  from (select btrim(x) nom from unnest(coalesce(p_noms,array[]::text[])) x
        where length(btrim(x)) between 1 and 100) f;
  if cardinality(v_noms)>40 then raise exception 'Maximum 40 favoris.'; end if;
  delete from public.personnages_favoris where email=v_email;
  insert into public.personnages_favoris(email,nom)
    select v_email,unnest(v_noms);
end;
$$;
revoke all on function public.definir_personnages_favoris(text[]) from public;
grant execute on function public.definir_personnages_favoris(text[]) to authenticated;

create table if not exists public.idees_equipe (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  prenom text not null,
  categorie text not null check(categorie in ('Personnage','Animation','Amélioration','Spectacle')),
  titre text not null,
  contenu text not null,
  reponse text,
  repondu_par text,
  repondu_le timestamptz,
  cree_le timestamptz not null default now()
);
create index if not exists idees_equipe_recent on public.idees_equipe (cree_le desc);
create index if not exists idees_equipe_email on public.idees_equipe (email);
alter table public.idees_equipe enable row level security;
drop policy if exists idees_equipe_lire on public.idees_equipe;
create policy idees_equipe_lire on public.idees_equipe
  for select to authenticated using (
    exists(select 1 from public.equipe e
      where lower(btrim(e.email))=lower(btrim(coalesce(auth.jwt()->>'email','')))
      and (email=lower(btrim(coalesce(auth.jwt()->>'email','')))
        or coalesce(e.responsable,false) or coalesce(e.gestionnaire,false)))
  );
revoke all on public.idees_equipe from anon,authenticated;
grant select on public.idees_equipe to authenticated;

create or replace function public.proposer_idee_equipe(
  p_categorie text,p_titre text,p_contenu text
) returns uuid language plpgsql security definer
set search_path = public,pg_temp
as $$
declare
  v_email text:=lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_prenom text;
  v_id uuid;
  v_dest text;
begin
  select nullif(btrim(e.prenom),'') into v_prenom
  from public.equipe e where lower(btrim(e.email))=v_email limit 1;
  if not found then raise exception 'Compte non associé à l’équipe Fantasy.'; end if;
  if p_categorie not in ('Personnage','Animation','Amélioration','Spectacle')
    then raise exception 'Catégorie non reconnue.'; end if;
  if length(btrim(coalesce(p_titre,''))) not between 3 and 120
    or length(btrim(coalesce(p_contenu,''))) not between 10 and 3000
    then raise exception 'Titre ou description trop court(e) ou trop long(ue).'; end if;
  insert into public.idees_equipe(email,prenom,categorie,titre,contenu)
    values(v_email,coalesce(v_prenom,v_email),p_categorie,btrim(p_titre),btrim(p_contenu))
    returning id into v_id;
  for v_dest in
    select distinct lower(btrim(e.email)) from public.equipe e
    where coalesce(e.responsable,false) or coalesce(e.gestionnaire,false)
  loop
    if v_dest<>v_email then
      insert into public.notifications_app(destinataire_email,titre,message,type,lien)
        values(v_dest,'💡 Nouvelle idée : '||left(btrim(p_titre),100),
               coalesce(v_prenom,v_email)||' a proposé une idée : '||left(btrim(p_contenu),160),
               'idee_equipe','./index.html?idees='||v_id::text);
    end if;
  end loop;
  return v_id;
end;
$$;

create or replace function public.repondre_idee_equipe(
  p_idee_id uuid,p_reponse text
) returns void language plpgsql security definer
set search_path = public,pg_temp
as $$
declare
  v_email text:=lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_prenom text;
  v_auteur text;
  v_titre text;
begin
  select coalesce(nullif(btrim(e.prenom),''),'Fantasy') into v_prenom
    from public.equipe e
    where lower(btrim(e.email))=v_email
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))
    limit 1;
  if not found then raise exception 'Réponse réservée aux responsables.'; end if;
  if length(btrim(coalesce(p_reponse,''))) not between 2 and 3000
    then raise exception 'Réponse invalide (2 à 3000 caractères).'; end if;
  update public.idees_equipe
    set reponse=btrim(p_reponse),repondu_par=v_prenom,repondu_le=now()
    where id=p_idee_id returning email,titre into v_auteur,v_titre;
  if not found then raise exception 'Idée introuvable.'; end if;
  insert into public.notifications_app(destinataire_email,titre,message,type,lien)
    values(v_auteur,'💌 Réponse à ton idée : '||left(v_titre,80),
           left(btrim(p_reponse),240),'idee_equipe',
           './index.html?idees='||p_idee_id::text);
end;
$$;

create or replace function public.supprimer_idee_equipe(p_idee_id uuid)
returns void language plpgsql security definer
set search_path = public,pg_temp
as $$
declare
  v_email text:=lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_auteur text;
begin
  select email into v_auteur from public.idees_equipe where id=p_idee_id;
  if not found then raise exception 'Idée introuvable.'; end if;
  if v_email<>v_auteur and not exists (
    select 1 from public.equipe e
    where lower(btrim(e.email))=v_email
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))
  ) then raise exception 'Suppression non autorisée.'; end if;
  delete from public.notifications_app
    where type='idee_equipe' and lien='./index.html?idees='||p_idee_id::text;
  delete from public.idees_equipe where id=p_idee_id;
end;
$$;
revoke all on function public.proposer_idee_equipe(text,text,text) from public;
revoke all on function public.repondre_idee_equipe(uuid,text) from public;
revoke all on function public.supprimer_idee_equipe(uuid) from public;
grant execute on function public.proposer_idee_equipe(text,text,text) to authenticated;
grant execute on function public.repondre_idee_equipe(uuid,text) to authenticated;
grant execute on function public.supprimer_idee_equipe(uuid) to authenticated;
commit;
