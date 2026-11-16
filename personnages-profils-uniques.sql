-- Fantasy Kids Events : un personnage de profil ne peut être attribué
-- qu'à un seul membre de l'équipe (y compris lors de deux choix simultanés).
-- À exécuter une seule fois dans Supabase > SQL Editor.

-- 1. Contrôle des éventuels doublons existants.
-- Si des lignes apparaissent, demander aux membres concernés de choisir
-- un autre personnage avant d'exécuter la suite : aucune donnée n'est effacée.
select lower(btrim(perso_prefere)) as personnage,
       array_agg(prenom order by prenom) as membres,
       count(*) as nombre
from public.equipe
where perso_prefere is not null and btrim(perso_prefere) <> ''
group by lower(btrim(perso_prefere))
having count(*) > 1;

-- 2. Refuse toute nouvelle attribution en doublon.
do $$
begin
  if exists (
    select 1 from public.equipe
    where perso_prefere is not null and btrim(perso_prefere) <> ''
    group by lower(btrim(perso_prefere))
    having count(*) > 1
  ) then
    raise exception 'Plusieurs membres utilisent déjà le même personnage. Corrigez les doublons signalés avant de créer la protection.';
  end if;
end;
$$;

create unique index if not exists equipe_perso_prefere_unique
on public.equipe (lower(btrim(perso_prefere)))
where perso_prefere is not null and btrim(perso_prefere) <> '';
