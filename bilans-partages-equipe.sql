-- Fantasy App : un bilan suffit pour toute l'équipe.
-- À exécuter UNE seule fois dans Supabase > SQL Editor.
-- Fonction en lecture seule : ne révèle ni l'auteur ni le texte du bilan.
-- Les membres n'obtiennent le statut que de leurs animations.
begin;
create or replace function public.bilans_partages_existants(p_ids uuid[])
returns table(evenement_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select distinct b.evenement_id
  from public.bilans b
  join public.evenements ev on ev.id = b.evenement_id
  where b.evenement_id = any(p_ids)
    and exists (
      select 1 from public.equipe m
      where lower(btrim(m.email)) = lower(btrim(auth.jwt()->>'email'))
        and (
          coalesce(m.responsable, false)
          or coalesce(m.gestionnaire, false)
          or exists (
            select 1
            from regexp_split_to_table(coalesce(ev.animateurs, ''), ',') as affectation(piece)
            where lower(btrim(regexp_replace(affectation.piece, '\s*\([^)]*\)\s*$', ''))) =
                  lower(btrim(m.prenom))
          )
        )
    );
$$;
revoke all on function public.bilans_partages_existants(uuid[]) from public;
revoke all on function public.bilans_partages_existants(uuid[]) from anon;
grant execute on function public.bilans_partages_existants(uuid[]) to authenticated;
commit;