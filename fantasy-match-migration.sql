-- FANTASY MATCH — à exécuter une seule fois dans Supabase SQL Editor.
-- Ne modifie aucune table existante de prestations ou de caisse.

create table if not exists public.fantasy_match_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prenom text not null default 'Membre',
  level integer not null default 1 check (level between 1 and 100),
  score bigint not null default 0 check (score >= 0),
  state jsonb not null default '{}'::jsonb,
  last_gift_at date,
  updated_at timestamptz not null default now()
);

create index if not exists fantasy_match_profiles_score_idx
  on public.fantasy_match_profiles(score desc);

alter table public.fantasy_match_profiles enable row level security;

-- Les données du jeu sont visibles seulement par les membres de l'équipe.
-- L'interface de classement n'affiche que prénom, score et niveau.
-- La modification de la progression appartient exclusivement à son compte.
drop policy if exists "fantasy_match_lire_classement" on public.fantasy_match_profiles;
create policy "fantasy_match_lire_classement"
on public.fantasy_match_profiles for select to authenticated using (
  exists (select 1 from public.equipe e
          where lower(e.email) = lower(auth.jwt()->>'email'))
);

drop policy if exists "fantasy_match_creer_soi" on public.fantasy_match_profiles;
create policy "fantasy_match_creer_soi"
on public.fantasy_match_profiles for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "fantasy_match_modifier_soi" on public.fantasy_match_profiles;
create policy "fantasy_match_modifier_soi"
on public.fantasy_match_profiles for update to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Offre d'une vie par membre et par jour, sans dépasser 5 vies chez le destinataire.
-- Exécutée en base pour éviter l'ajout libre de vies chez les autres membres.
create or replace function public.fantasy_match_offrir_vie(destinataire uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  emetteur uuid := auth.uid();
  dernier_cadeau date;
  vies_dest integer;
begin
  if emetteur is null or destinataire is null or emetteur = destinataire then
    return false;
  end if;

  select last_gift_at into dernier_cadeau
  from public.fantasy_match_profiles
  where user_id = emetteur for update;
  if not found or dernier_cadeau = current_date then return false; end if;

  select coalesce((state->>'lives')::integer, 5) into vies_dest
  from public.fantasy_match_profiles
  where user_id = destinataire for update;
  if not found or vies_dest >= 5 then return false; end if;

  update public.fantasy_match_profiles
    set state = jsonb_set(coalesce(state,'{}'::jsonb),'{lives}',to_jsonb(least(5,vies_dest+1))),
        updated_at = now()
    where user_id = destinataire;

  update public.fantasy_match_profiles
    set last_gift_at = current_date
    where user_id = emetteur;

  return true;
end;
$$;

revoke all on function public.fantasy_match_offrir_vie(uuid) from public;
grant execute on function public.fantasy_match_offrir_vie(uuid) to authenticated;
