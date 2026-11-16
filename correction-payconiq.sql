-- Fantasy Kids Events — autoriser Payconiq dans les encaissements.
-- À exécuter dans Supabase > SQL Editor > New query > Run.
-- Ne touche ni aux montants ni aux paiements déjà enregistrés.
-- Conserve les valeurs déjà autorisées par chaque contrainte et ajoute « payconiq ».

BEGIN;

DO $$
DECLARE
  regle record;
BEGIN
  FOR regle IN
    SELECT c.conname,
           pg_get_expr(c.conbin, c.conrelid) AS expression_actuelle,
           CASE
             WHEN c.conname IN ('evenements__solde_encaisse__check', 'evenements_solde_encaisse_check')
               THEN 'solde_encaisse'
             ELSE 'tatouages_paiement'
           END AS colonne
    FROM pg_constraint c
    WHERE c.conrelid = 'public.evenements'::regclass
      AND c.contype = 'c'
      AND c.conname IN (
        'evenements__solde_encaisse__check',
        'evenements_solde_encaisse_check',
        'evenements__tatouages_paiement__check',
        'evenements_tatouages_paiement_check'
      )
  LOOP
    IF position('payconiq' IN lower(regle.expression_actuelle)) = 0 THEN
      EXECUTE format('ALTER TABLE public.evenements DROP CONSTRAINT %I', regle.conname);
      EXECUTE format(
        'ALTER TABLE public.evenements ADD CONSTRAINT %I CHECK ((%s) OR (%I = %L))',
        regle.conname,
        regle.expression_actuelle,
        regle.colonne,
        'payconiq'
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
