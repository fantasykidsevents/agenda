-- Fantasy Kids Events : suppression des brouillons et annulation des devis finalisés.
-- À lancer après supabase_facturation.sql et supabase_devis_contrats_pro.sql.
-- N'efface aucune donnée existante et ne change aucun compteur de facture.

-- Les brouillons non numérotés peuvent être supprimés par les responsables.
-- Les documents numérotés peuvent être retirés de la liste active (archivés),
-- sans supprimer leur référence ni leur contenu comptable.
alter table public.factures_fantasy add column if not exists archive_le timestamptz;
alter table public.devis_fantasy add column if not exists archive_le timestamptz;

drop policy if exists fk_factures_suppression_brouillons on public.factures_fantasy;
create policy fk_factures_suppression_brouillons on public.factures_fantasy
  for delete to authenticated
  using (public.fk_factures_est_responsable() and statut = 'brouillon');
grant delete on public.factures_fantasy to authenticated;

drop policy if exists fk_devis_suppression_brouillons on public.devis_fantasy;
create policy fk_devis_suppression_brouillons on public.devis_fantasy
  for delete to authenticated
  using (public.fk_factures_est_responsable() and statut = 'brouillon');
grant delete on public.devis_fantasy to authenticated;

-- Les devis finalisés restent conservés avec leur numéro mais peuvent être annulés.
alter table public.devis_fantasy
  drop constraint if exists devis_fantasy_statut_check;
alter table public.devis_fantasy
  add constraint devis_fantasy_statut_check
  check (statut in ('brouillon', 'emis', 'annule'));
alter table public.devis_fantasy
  drop constraint if exists fk_devis_numero_statut;
alter table public.devis_fantasy
  add constraint fk_devis_numero_statut
  check ((statut = 'brouillon' and numero is null)
    or (statut in ('emis', 'annule') and numero is not null));

create or replace function public.fk_devis_verrouiller()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.statut in ('emis', 'annule') then
    if coalesce(current_setting('fk_devis.autorise_rpc',true),'') = 'oui'
       and new.contenu is not distinct from old.contenu
       and new.numero is not distinct from old.numero
       and new.source_evenement_id is not distinct from old.source_evenement_id
       and new.created_at is not distinct from old.created_at
       and (
         (old.statut = 'emis' and new.statut = 'annule' and new.archive_le is not distinct from old.archive_le)
         or (new.statut = old.statut and new.archive_le is distinct from old.archive_le)
       ) then
      new.updated_at=now();
      return new;
    end if;
    raise exception 'Ce devis est finalisé : seules les actions prévues permettent de l’annuler.';
  end if;
  if (new.statut is distinct from old.statut or new.numero is distinct from old.numero)
     and coalesce(current_setting('fk_devis.autorise_rpc',true),'') <> 'oui' then
    raise exception 'Utilisez les actions Finaliser ou Annuler le devis.';
  end if;
  new.updated_at=now();
  return new;
end;
$$;

create or replace function public.fk_devis_annuler(p_id uuid)
returns public.devis_fantasy language plpgsql security definer
set search_path = public, pg_temp as $$
declare d public.devis_fantasy;
begin
  if not public.fk_factures_est_responsable() then raise exception 'Accès refusé.'; end if;
  select * into d from public.devis_fantasy where id=p_id for update;
  if not found or d.statut <> 'emis' then raise exception 'Seul un devis finalisé peut être annulé.'; end if;
  perform set_config('fk_devis.autorise_rpc','oui',true);
  update public.devis_fantasy set statut='annule' where id=p_id returning * into d;
  perform set_config('fk_devis.autorise_rpc','',true);
  return d;
end;
$$;
revoke all on function public.fk_devis_annuler(uuid) from public, anon;
grant execute on function public.fk_devis_annuler(uuid) to authenticated;

create or replace function public.fk_factures_archiver(p_id uuid, p_archiver boolean)
returns public.factures_fantasy language plpgsql security definer
set search_path = public, pg_temp as $$
declare f public.factures_fantasy;
begin
  if not public.fk_factures_est_responsable() then raise exception 'Accès refusé.'; end if;
  select * into f from public.factures_fantasy where id=p_id for update;
  if not found or f.statut='brouillon' then raise exception 'Document introuvable ou encore en brouillon.'; end if;
  update public.factures_fantasy set archive_le=(case when p_archiver then now() else null end)
    where id=p_id returning * into f;
  return f;
end;
$$;
revoke all on function public.fk_factures_archiver(uuid, boolean) from public, anon;
grant execute on function public.fk_factures_archiver(uuid, boolean) to authenticated;

create or replace function public.fk_devis_archiver(p_id uuid, p_archiver boolean)
returns public.devis_fantasy language plpgsql security definer
set search_path = public, pg_temp as $$
declare d public.devis_fantasy;
begin
  if not public.fk_factures_est_responsable() then raise exception 'Accès refusé.'; end if;
  select * into d from public.devis_fantasy where id=p_id for update;
  if not found or d.statut='brouillon' then raise exception 'Document introuvable ou encore en brouillon.'; end if;
  perform set_config('fk_devis.autorise_rpc','oui',true);
  update public.devis_fantasy set archive_le=(case when p_archiver then now() else null end)
    where id=p_id returning * into d;
  perform set_config('fk_devis.autorise_rpc','',true);
  return d;
end;
$$;
revoke all on function public.fk_devis_archiver(uuid, boolean) from public, anon;
grant execute on function public.fk_devis_archiver(uuid, boolean) to authenticated;
