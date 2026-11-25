-- Fantasy Match : ouvrir les niveaux 201 à 300 sans modifier les profils.
-- Déjà appliqué dans Supabase ; fichier conservé comme référence.
begin;
alter table public.fantasy_match_profiles
  drop constraint if exists fantasy_match_profiles_level_check;
alter table public.fantasy_match_profiles
  add constraint fantasy_match_profiles_level_check check (level between 1 and 300);
commit;
