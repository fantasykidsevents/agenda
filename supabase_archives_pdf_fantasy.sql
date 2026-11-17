-- Fantasy Kids Events : copies originales de devis et factures.
-- À exécuter UNE FOIS dans Supabase > SQL Editor avant d'utiliser la sauvegarde automatique.
-- Ce bucket est privé : seuls les membres responsables peuvent déposer/lire les PDF.
-- Les fichiers existants ne sont jamais écrasés par l'application.

-- Nécessite supabase_facturation.sql (fonction fk_factures_est_responsable).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fantasy-facturation',
  'fantasy-facturation',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists fk_fantasy_pdf_original_depot on storage.objects;
create policy fk_fantasy_pdf_original_depot
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fantasy-facturation'
    and (storage.foldername(name))[1] in ('factures', 'devis')
    and storage.extension(name) = 'pdf'
    and public.fk_factures_est_responsable()
  );

drop policy if exists fk_fantasy_pdf_original_lecture on storage.objects;
create policy fk_fantasy_pdf_original_lecture
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fantasy-facturation'
    and (storage.foldername(name))[1] in ('factures', 'devis')
    and storage.extension(name) = 'pdf'
    and public.fk_factures_est_responsable()
  );

-- Pas de politique UPDATE/DELETE ajoutée : un PDF déjà déposé reste inchangé
-- et l'application n'envoie jamais de requête d'effacement dans ce bucket.
