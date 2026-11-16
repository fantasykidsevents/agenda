-- Fantasy Kids Events — suivi des espèces remises à Jordan
-- À exécuter UNE FOIS dans Supabase > SQL Editor, AVANT de publier le nouveau index.html.
-- Ajoute quatre champs sans supprimer ni modifier les anciens paiements.

ALTER TABLE public.evenements
  ADD COLUMN IF NOT EXISTS solde_remis_jordan_le timestamptz,
  ADD COLUMN IF NOT EXISTS solde_remis_jordan_par text,
  ADD COLUMN IF NOT EXISTS tatouages_remis_jordan_le timestamptz,
  ADD COLUMN IF NOT EXISTS tatouages_remis_jordan_par text;

COMMENT ON COLUMN public.evenements.solde_remis_jordan_le IS
  'Date à laquelle Jordan a confirmé avoir physiquement récupéré le solde encaissé en espèces par un autre membre.';
COMMENT ON COLUMN public.evenements.solde_remis_jordan_par IS
  'Personne ayant confirmé la récupération du solde en espèces (Jordan dans l application).';
COMMENT ON COLUMN public.evenements.tatouages_remis_jordan_le IS
  'Date à laquelle Jordan a confirmé avoir physiquement récupéré les espèces des tatouages.';
COMMENT ON COLUMN public.evenements.tatouages_remis_jordan_par IS
  'Personne ayant confirmé la récupération des espèces des tatouages (Jordan dans l application).';
