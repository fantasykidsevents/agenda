-- Fantasy Match : ouverture des niveaux 101 à 200.
-- À exécuter une fois dans Supabase > SQL Editor > Run.
-- Préserve intégralement les scores, vies, bonus et niveaux déjà enregistrés.
begin;
alter table public.fantasy_match_profiles
  drop constraint if exists fantasy_match_profiles_level_check;
alter table public.fantasy_match_profiles
  add constraint fantasy_match_profiles_level_check check (level between 1 and 200);
commit;
