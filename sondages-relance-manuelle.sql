-- Fantasy App — relance manuelle des sondages non répondus.
-- À exécuter dans Supabase SQL Editor après sondages-disponibilites.sql.
-- Compatible avec le traitement push existant dans notifier-index.ts.
begin;

-- Autoriser plusieurs relances manuelles horodatées, sans changer les rappels planifiés.
alter table public.sondages_dispo_relances
  drop constraint if exists sondages_dispo_relances_etape_check;
alter table public.sondages_dispo_relances
  add constraint sondages_dispo_relances_etape_check
  check (etape in ('j7','j2','j1','h4') or etape ~ '^manuel_[0-9]{12}$');

create or replace function public.relancer_sondage_dispo_manuellement(p_sondage_id uuid)
returns integer
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_admin text := lower(btrim(coalesce(auth.jwt()->>'email','')));
  v_s public.sondages_dispo%rowtype;
  v_mail text;
  v_count integer := 0;
  v_etape text := 'manuel_' || to_char(clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MI');
  v_maintenant timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.equipe e
    where lower(btrim(e.email))=v_admin
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))
  ) then
    raise exception 'Relance réservée aux responsables et gestionnaires.';
  end if;

  select * into v_s from public.sondages_dispo
  where id=p_sondage_id for update;
  if not found then raise exception 'Sondage introuvable.'; end if;
  if v_s.statut <> 'ouvert' or v_s.date_limite <= now() then
    raise exception 'Impossible de relancer un sondage clôturé.';
  end if;

  -- Une relance manuelle par sondage au maximum toutes les 12 heures.
  if exists (
    select 1 from public.sondages_dispo_relances r
    where r.sondage_id=v_s.id and r.etape like 'manuel_%'
      and r.envoyee_le > v_maintenant - interval '12 hours'
  ) then
    raise exception 'Une relance manuelle a déjà été effectuée au cours des 12 dernières heures.';
  end if;

  for v_mail in
    select distinct lower(btrim(m)) from unnest(v_s.destinataires) as m
    where nullif(btrim(m),'') is not null
  loop
    -- Un oui ou un « aucune disponibilité » vaut vote complet.
    -- Ne jamais relancer un membre ayant déjà validé son choix.
    if exists (
      select 1 from public.sondages_dispo_reponses r
      where r.sondage_id=v_s.id and lower(btrim(r.email))=v_mail
        and (
          (r.option_id='__aucune__' and r.reponse='non')
          or (r.reponse='oui' and exists (
            select 1 from jsonb_array_elements(v_s.dates) d
            where d->>'id'=r.option_id
          ))
        )
    ) then continue; end if;

    insert into public.sondages_dispo_relances(sondage_id,email,etape)
      values(v_s.id,v_mail,v_etape);
    insert into public.notifications_app
      (destinataire_email,titre,message,type,lien)
      values(
        v_mail,
        '🗳️ Petit rappel : ton vote est attendu',
        v_s.titre || ' · Peux-tu répondre au sondage avant le '
          || to_char(v_s.date_limite at time zone 'Europe/Brussels','DD/MM/YYYY HH24:MI') || ' ?',
        'sondage_rappel',
        './index.html?sondages=1'
      );
    v_count := v_count+1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.relancer_sondage_dispo_manuellement(uuid) from public;
grant execute on function public.relancer_sondage_dispo_manuellement(uuid) to authenticated;
commit;
