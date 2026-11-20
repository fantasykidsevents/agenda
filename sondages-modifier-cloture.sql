-- Fantasy App — permettre aux responsables de modifier la date de clôture
-- d'un sondage déjà en cours, sans effacer les réponses des membres.
-- À exécuter une seule fois dans Supabase > SQL Editor.

begin;

create or replace function public.modifier_date_limite_sondage(
  p_sondage_id uuid,
  p_date_limite timestamptz
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_ancienne_limite timestamptz;
  v_statut text;
begin
  if not exists (
    select 1 from public.equipe e
    where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
      and (coalesce(e.responsable,false) or coalesce(e.gestionnaire,false))
  ) then
    raise exception 'Modification réservée au responsable ou gestionnaire.';
  end if;

  if p_date_limite is null or p_date_limite <= now() then
    raise exception 'Choisis une date et une heure de clôture dans le futur.';
  end if;

  select date_limite, statut into v_ancienne_limite, v_statut
    from public.sondages_dispo
    where id = p_sondage_id
    for update;

  if not found then
    raise exception 'Sondage introuvable.';
  end if;
  if v_statut <> 'ouvert' or v_ancienne_limite <= now() then
    raise exception 'Seul un sondage encore en cours peut être modifié.';
  end if;

  if v_ancienne_limite is distinct from p_date_limite then
    update public.sondages_dispo
      set date_limite = p_date_limite
      where id = p_sondage_id;

    -- Les rappels du précédent délai ne doivent pas bloquer ceux du nouveau.
    -- On conserve toutes les réponses déjà enregistrées.
    delete from public.sondages_dispo_relances
      where sondage_id = p_sondage_id;
  end if;
end;
$$;

revoke all on function public.modifier_date_limite_sondage(uuid,timestamptz) from public;
grant execute on function public.modifier_date_limite_sondage(uuid,timestamptz) to authenticated;

commit;
