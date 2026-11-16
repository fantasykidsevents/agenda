-- Fantasy Kids Events — activation des rappels de sondages dans la cloche.
-- Étape 2 : après sondages-disponibilites.sql, lancer ce SQL dans Supabase.
-- La tâche tourne chaque heure sans connexion à l'application.
-- Elle ne touche ni aux prestations, ni aux paiements, ni aux comptes.
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'fantasy-sondages-rappels',
  '0 * * * *',
  'select * from public.relancer_sondages_dispo()'
);

-- Vérification dans le Dashboard : Integrations > Cron > Jobs.
-- Ou en SQL :
-- select jobname,schedule,active from cron.job
-- where jobname='fantasy-sondages-rappels';
