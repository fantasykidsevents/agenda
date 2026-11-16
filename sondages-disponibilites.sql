-- Fantasy Kids Events — sondages pour toute l'équipe.
-- Étape 1 : Supabase > SQL Editor > New query > Run.
-- La fonction "notifier" doit être redéployée pour recevoir les pushs et déclencher les rappels.
begin;

create table if not exists public.sondages_dispo (
  id uuid primary key default gen_random_uuid(),
  titre text not null check (length(btrim(titre)) between 3 and 160),
  dates jsonb not null check (jsonb_typeof(dates) = 'array'),
  date_limite timestamptz not null,
  destinataires text[] not null default '{}',
  notes text,
  statut text not null default 'ouvert' check (statut in ('ouvert','ferme')),
  cree_par uuid default auth.uid(),
  push_initial_envoye timestamptz,
  cree_le timestamptz not null default now()
);
create index if not exists sondages_dispo_recent on public.sondages_dispo(cree_le desc);

create table if not exists public.sondages_dispo_reponses (
  sondage_id uuid not null references public.sondages_dispo(id) on delete cascade,
  option_id text not null,
  email text not null,
  reponse text not null check (reponse in ('oui','non','peut_etre')),
  modifie_le timestamptz not null default now(),
  primary key (sondage_id, option_id, email)
);

create table if not exists public.sondages_dispo_relances (
  id uuid primary key default gen_random_uuid(),
  sondage_id uuid not null references public.sondages_dispo(id) on delete cascade,
  email text not null,
  etape text not null check(etape in ('j7','j2','j1','h4')),
  envoyee_le timestamptz not null default now(),
  unique (sondage_id,email,etape)
);
alter table public.sondages_dispo_relances
  add column if not exists push_envoye_le timestamptz;

-- Tous les membres connectés peuvent consulter tous les sondages
-- et les réponses nominatives, y compris hors de leur ancienne Team.
alter table public.sondages_dispo enable row level security;
alter table public.sondages_dispo_reponses enable row level security;
alter table public.sondages_dispo_relances enable row level security;
drop policy if exists sondages_dispo_lire on public.sondages_dispo;
create policy sondages_dispo_lire on public.sondages_dispo for select to authenticated
  using (exists (
    select 1 from public.equipe e
    where lower(btrim(e.email))=lower(btrim(auth.jwt()->>'email'))
  ));
drop policy if exists sondages_dispo_reponses_lire on public.sondages_dispo_reponses;
create policy sondages_dispo_reponses_lire on public.sondages_dispo_reponses for select to authenticated
  using (exists (
    select 1 from public.equipe e
    where lower(btrim(e.email))=lower(btrim(auth.jwt()->>'email'))
  ));
revoke all on public.sondages_dispo, public.sondages_dispo_reponses, public.sondages_dispo_relances from anon, authenticated;
grant select on public.sondages_dispo, public.sondages_dispo_reponses to authenticated;

create or replace function public.creer_sondage_dispo(
  p_titre text, p_dates jsonb, p_date_limite timestamptz, p_notes text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_emails text[];
  v_id uuid;
  v_mail text;
begin
  if not exists (
    select 1 from public.equipe e
    where lower(btrim(e.email))=v_email
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))
  ) then
    raise exception 'Seul un responsable ou gestionnaire peut publier un sondage.';
  end if;
  if length(btrim(coalesce(p_titre,''))) not between 3 and 160 then
    raise exception 'Indiquez un titre de 3 à 160 caractères.';
  end if;
  if p_dates is null or jsonb_typeof(p_dates) <> 'array'
    or jsonb_array_length(p_dates) not between 1 and 12 then
    raise exception 'Proposez entre 1 et 12 dates.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_dates) as d
    where nullif(d->>'id','') is null
       or (d->>'date') is null
       or (d->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ) then
    raise exception 'Une date proposée est invalide.';
  end if;
  if exists (
    select 1 from (
      select d->>'id' as id from jsonb_array_elements(p_dates) as d
      group by d->>'id' having count(*)>1
    ) doublons
  ) then
    raise exception 'Une option de date est répétée.';
  end if;
  if p_date_limite is null or p_date_limite <= now() then
    raise exception 'La date limite doit être dans le futur.';
  end if;
  v_emails := array(
    select distinct lower(btrim(e.email)) from public.equipe e
    where nullif(btrim(e.email),'') is not null and e.email like '%@%'
  );
  if coalesce(cardinality(v_emails),0) = 0 then
    raise exception 'Aucun membre avec une adresse e-mail.';
  end if;

  insert into public.sondages_dispo(titre,dates,date_limite,destinataires,notes,cree_par)
    values(btrim(p_titre),p_dates,p_date_limite,v_emails,
      nullif(btrim(coalesce(p_notes,'')),''),auth.uid())
    returning id into v_id;

  -- Une entrée dans la cloche de chaque membre, transactionnelle.
  foreach v_mail in array v_emails loop
    insert into public.notifications_app
      (destinataire_email,titre,message,type,lien)
    values(v_mail,'🗳️ Nouveau sondage de disponibilité',
      btrim(p_titre) || ' · Réponds avant le '
      || to_char(p_date_limite at time zone 'Europe/Brussels','DD/MM/YYYY HH24:MI'),
      'sondage','./index.html?sondages=1');
  end loop;
  return v_id;
end;
$$;

create or replace function public.repondre_sondage_dispo(
  p_sondage_id uuid,p_option_id text,p_reponse text
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_sondage public.sondages_dispo%rowtype;
begin
  if p_reponse is null or p_reponse not in ('oui','non','peut_etre') then
    raise exception 'Réponse inconnue.';
  end if;
  if not exists (
    select 1 from public.equipe e where lower(btrim(e.email)) = v_email
  ) then
    raise exception 'Votre compte doit être relié à un membre de l’équipe.';
  end if;
  select * into v_sondage from public.sondages_dispo
    where id=p_sondage_id for update;
  if not found or v_sondage.statut <> 'ouvert' or now() >= v_sondage.date_limite then
    raise exception 'Le délai de réponse est terminé.';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_sondage.dates) as d
    where d->>'id'=p_option_id
  ) then
    raise exception 'Cette date n’appartient pas au sondage.';
  end if;
  insert into public.sondages_dispo_reponses
    (sondage_id,option_id,email,reponse,modifie_le)
    values(p_sondage_id,p_option_id,v_email,p_reponse,now())
  on conflict (sondage_id,option_id,email) do update set
    reponse=excluded.reponse,modifie_le=excluded.modifie_le;
end;
$$;

-- Un vote de sondage est UNE réponse globale :
-- plusieurs dates disponibles OU une indisponibilité totale, jamais les deux.
create or replace function public.enregistrer_choix_sondage(
  p_sondage_id uuid,p_options text[],p_indisponible boolean default false
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_sondage public.sondages_dispo%rowtype;
  v_options text[] := coalesce(p_options, array[]::text[]);
  v_option text;
begin
  if not exists (
    select 1 from public.equipe e where lower(btrim(e.email))=v_email
  ) then
    raise exception 'Votre compte doit être relié à l’équipe.';
  end if;
  select * into v_sondage from public.sondages_dispo
    where id=p_sondage_id for update;
  if not found or v_sondage.statut<>'ouvert' or now()>=v_sondage.date_limite then
    raise exception 'Le sondage est fermé ou la date limite est dépassée.';
  end if;
  if cardinality(v_options)>12 or
     (coalesce(p_indisponible,false) and cardinality(v_options)>0) or
     (not coalesce(p_indisponible,false) and cardinality(v_options)=0) then
    raise exception 'Choisissez une ou plusieurs dates, ou « Aucune disponibilité ».';
  end if;
  if exists (
    select 1 from unnest(v_options) as opt
    where opt is null or not exists (
      select 1 from jsonb_array_elements(v_sondage.dates) as d
      where d->>'id'=opt
    )
  ) then
    raise exception 'Une date sélectionnée est invalide.';
  end if;
  if exists (
    select 1 from (
      select opt from unnest(v_options) as opt group by opt having count(*)>1
    ) doublon
  ) then
    raise exception 'Une date a été sélectionnée deux fois.';
  end if;

  delete from public.sondages_dispo_reponses
    where sondage_id=p_sondage_id and email=v_email;
  if coalesce(p_indisponible,false) then
    insert into public.sondages_dispo_reponses
      (sondage_id,option_id,email,reponse,modifie_le)
      values(p_sondage_id,'__aucune__',v_email,'non',now());
  else
    foreach v_option in array v_options loop
      insert into public.sondages_dispo_reponses
        (sondage_id,option_id,email,reponse,modifie_le)
        values(p_sondage_id,v_option,v_email,'oui',now());
    end loop;
  end if;
end;
$$;

create or replace function public.fermer_sondage_dispo(
  p_sondage_id uuid,p_ferme boolean
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.equipe e
    where lower(btrim(e.email))=lower(btrim(auth.jwt()->>'email'))
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))
  ) then
    raise exception 'Action réservée au responsable.';
  end if;
  -- On ne peut pas rouvrir un sondage après la date butoir.
  if not p_ferme and exists (
    select 1 from public.sondages_dispo where id=p_sondage_id and date_limite<=now()
  ) then
    raise exception 'La date limite est dépassée.';
  end if;
  update public.sondages_dispo
    set statut=case when p_ferme then 'ferme' else 'ouvert' end
    where id=p_sondage_id;
  if not found then raise exception 'Sondage introuvable.'; end if;
end;
$$;

-- Appelée régulièrement par la fonction Edge "notifier" déjà planifiée.
-- 7 jours, 48h, 24h et 4h avant la limite, au plus une alerte par étape et par membre.
-- Un membre n'est relancé que s'il lui manque AU MOINS UNE réponse.
create or replace function public.relancer_sondages_dispo()
returns table(email text,titre text,message text,lien text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_s public.sondages_dispo%rowtype;
  v_email text;
  v_etape text;
  v_manquantes integer;
  v_relance uuid;
begin
  for v_s in
    select * from public.sondages_dispo
    where statut='ouvert'
      and date_limite>now()
      and date_limite<=now()+interval '7 days'
  loop
    v_etape := case
      when v_s.date_limite <= now()+interval '4 hours' then 'h4'
      when v_s.date_limite <= now()+interval '24 hours' then 'j1'
      when v_s.date_limite <= now()+interval '48 hours' then 'j2'
      else 'j7'
    end;
    for v_email in
      select distinct lower(btrim(e.email)) from public.equipe e
      where nullif(btrim(e.email),'') is not null and e.email like '%@%'
    loop
      -- Une réponse est complète dès qu'une date est cochée ou
      -- que le membre a choisi « Aucune disponibilité ».
      select count(*) into v_manquantes
      from public.sondages_dispo_reponses r
      where r.sondage_id=v_s.id and r.email=v_email
        and ((r.option_id='__aucune__' and r.reponse='non')
          or (r.reponse='oui' and exists (
            select 1 from jsonb_array_elements(v_s.dates) as d
            where d->>'id'=r.option_id
          )));
      if v_manquantes>0 then continue; end if;

      v_relance:=null;
      insert into public.sondages_dispo_relances(sondage_id,email,etape)
        values(v_s.id,v_email,v_etape)
        on conflict (sondage_id,email,etape) do nothing
        returning id into v_relance;
      if v_relance is null then continue; end if;
      begin
        email:=v_email;
        titre:='⏰ Rappel : sondage sans réponse';
        message:=v_s.titre || ' · Tu n’as pas encore choisi de disponibilité. '
          || 'Limite : ' || to_char(v_s.date_limite at time zone 'Europe/Brussels','DD/MM/YYYY HH24:MI');
        lien:='./index.html?sondages=1';
        insert into public.notifications_app
          (destinataire_email,titre,message,type,lien)
          values(email,titre,message,'sondage_rappel',lien);
        return next;
      exception when others then
        -- Si la notification n'a pas été enregistrée, réessayer au prochain passage.
        delete from public.sondages_dispo_relances where id=v_relance;
        raise notice 'Rappel impossible pour % : %',v_email,SQLERRM;
      end;
    end loop;
  end loop;
  update public.sondages_dispo set statut='ferme'
    where statut='ouvert' and date_limite<=now();
end;
$$;


-- Les pushs téléphone sont prélevés séparément des rappels dans la cloche.
-- Ainsi, le Cron SQL et l'Edge Function peuvent tourner dans n'importe quel ordre.
create or replace function public.prendre_push_sondages_dispo()
returns table(email text,titre text,message text,lien text)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select q.id,q.email,s.titre as nom_sondage,s.date_limite
    from public.sondages_dispo_relances q
    join public.sondages_dispo s on s.id=q.sondage_id
    where q.push_envoye_le is null and s.date_limite>now()
    order by q.envoyee_le
    limit 200
    for update of q skip locked
  loop
    update public.sondages_dispo_relances
      set push_envoye_le=now() where id=r.id;
    email:=r.email;
    titre:='⏰ Rappel : sondage sans réponse';
    message:=r.nom_sondage || ' · Dernier délai : '
      || to_char(r.date_limite at time zone 'Europe/Brussels','DD/MM/YYYY HH24:MI');
    lien:='./index.html?sondages=1';
    return next;
  end loop;
end;
$$;

revoke all on function public.prendre_push_sondages_dispo() from public;
grant execute on function public.prendre_push_sondages_dispo() to service_role;

revoke all on function public.creer_sondage_dispo(text,jsonb,timestamptz,text) from public;
revoke all on function public.enregistrer_choix_sondage(uuid,text[],boolean) from public;
revoke all on function public.repondre_sondage_dispo(uuid,text,text) from public;
revoke all on function public.fermer_sondage_dispo(uuid,boolean) from public;
revoke all on function public.relancer_sondages_dispo() from public;
grant execute on function public.creer_sondage_dispo(text,jsonb,timestamptz,text) to authenticated;
grant execute on function public.enregistrer_choix_sondage(uuid,text[],boolean) to authenticated;
grant execute on function public.repondre_sondage_dispo(uuid,text,text) to authenticated;
grant execute on function public.fermer_sondage_dispo(uuid,boolean) to authenticated;
grant execute on function public.relancer_sondages_dispo() to service_role;
commit;
