-- Fantasy Kids Events — permettre de ranger définitivement les notifications lues.
-- À exécuter dans Supabase > SQL Editor. Ne supprime aucune notification.

BEGIN;

ALTER TABLE public.notifications_app ENABLE ROW LEVEL SECURITY;

-- Chaque membre peut uniquement marquer ses propres notifications comme vues.
DROP POLICY IF EXISTS "notifications_app_marquer_lues" ON public.notifications_app;
CREATE POLICY "notifications_app_marquer_lues"
  ON public.notifications_app FOR UPDATE TO authenticated
  USING (lower(destinataire_email) = lower((SELECT auth.jwt() ->> 'email')))
  WITH CHECK (lower(destinataire_email) = lower((SELECT auth.jwt() ->> 'email')));

-- La lecture est nécessaire pour vérifier que l'enregistrement a bien eu lieu.
DROP POLICY IF EXISTS "notifications_app_lire_les_miennes" ON public.notifications_app;
CREATE POLICY "notifications_app_lire_les_miennes"
  ON public.notifications_app FOR SELECT TO authenticated
  USING (lower(destinataire_email) = lower((SELECT auth.jwt() ->> 'email')));

GRANT SELECT ON public.notifications_app TO authenticated;
GRANT UPDATE (lue_le) ON public.notifications_app TO authenticated;

COMMIT;
