-- Fantasy Kids Events · Correctif pour l'enregistrement des teams
-- À exécuter une fois dans Supabase > SQL Editor.
-- Conserve les teams existantes. Ne supprime et n'écrase aucune donnée.

BEGIN;

-- L'app conserve toutes les teams sous cette clé de réglages.
-- Lorsqu'elle n'existe pas encore, certaines règles Supabase empêchent
-- l'app de créer elle-même une nouvelle ligne.
INSERT INTO public.reglages (cle, valeur)
VALUES ('equipes_types', '[]')
ON CONFLICT (cle) DO NOTHING;

-- Si RLS est actif, seuls les responsables et gestionnaires peuvent
-- créer ou modifier la clé des teams. Aucun accès n'est ajouté aux
-- autres réglages. Si RLS est inactif, ses paramètres restent inchangés.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.reglages'::regclass AND relrowsecurity
  ) THEN
    DROP POLICY IF EXISTS "reglages_teams_insert" ON public.reglages;
    DROP POLICY IF EXISTS "reglages_teams_update" ON public.reglages;

    CREATE POLICY "reglages_teams_insert" ON public.reglages
      FOR INSERT TO authenticated
      WITH CHECK (
        cle = 'equipes_types'
        AND EXISTS (
          SELECT 1 FROM public.equipe m
          WHERE lower(m.email) = lower(auth.jwt() ->> 'email')
            AND (coalesce(m.responsable, false) OR coalesce(m.gestionnaire, false))
        )
      );

    CREATE POLICY "reglages_teams_update" ON public.reglages
      FOR UPDATE TO authenticated
      USING (
        cle = 'equipes_types'
        AND EXISTS (
          SELECT 1 FROM public.equipe m
          WHERE lower(m.email) = lower(auth.jwt() ->> 'email')
            AND (coalesce(m.responsable, false) OR coalesce(m.gestionnaire, false))
        )
      )
      WITH CHECK (
        cle = 'equipes_types'
        AND EXISTS (
          SELECT 1 FROM public.equipe m
          WHERE lower(m.email) = lower(auth.jwt() ->> 'email')
            AND (coalesce(m.responsable, false) OR coalesce(m.gestionnaire, false))
        )
      );

    GRANT INSERT (cle, valeur), UPDATE (valeur) ON public.reglages TO authenticated;
  END IF;
END $$;

COMMIT;
