-- Fantasy Potions : jeu de réflexion séparé de Fantasy Match.
-- Données d'équipe et classement protégés par RLS ; aucune table existante modifiée.
create table if not exists public.fantasy_potions_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prenom text not null default 'Membre',
  level integer not null default 1 check (level between 1 and 150),
  score bigint not null default 0 check (score >= 0),
  wins jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists fantasy_potions_profiles_score_idx on public.fantasy_potions_profiles(score desc);
alter table public.fantasy_potions_profiles enable row level security;
revoke all on public.fantasy_potions_profiles from anon;
grant select, insert, update on public.fantasy_potions_profiles to authenticated;
drop policy if exists fantasy_potions_lire_classement on public.fantasy_potions_profiles;
create policy fantasy_potions_lire_classement
  on public.fantasy_potions_profiles for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.equipe e
      where lower(e.email) = lower((select auth.jwt())->>'email')
    )
  );
drop policy if exists fantasy_potions_creer_soi on public.fantasy_potions_profiles;
create policy fantasy_potions_creer_soi
  on public.fantasy_potions_profiles for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists fantasy_potions_modifier_soi on public.fantasy_potions_profiles;
create policy fantasy_potions_modifier_soi
  on public.fantasy_potions_profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
