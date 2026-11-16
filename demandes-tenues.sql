-- Fantasy Kids Events — choix de tenue et signalements (costume / perruque)
-- À exécuter une seule fois dans Supabase > SQL Editor.
-- Non destructif : préserve les pièces et attributions déjà enregistrées.

begin;

create table if not exists public.costume_demandes (
  evenement_id text not null,
  membre text not null,
  personnage text not null,
  type text not null check (type in ('costume', 'perruque')),
  choix text not null check (choix in ('personnel', 'fantasy', 'sans_perruque')),
  costume_id text,
  motif text check (motif is null or motif in ('endommage', 'entretien', 'indisponible', 'preference', 'autre')),
  detail text,
  photo_path text,
  statut text not null default 'a_traiter' check (statut in ('a_traiter', 'en_cours', 'resolue')),
  modifie_par text,
  modifie_le timestamptz not null default now(),
  traite_par text,
  traite_le timestamptz,
  primary key (evenement_id, membre, personnage, type),
  constraint photo_tenue_path check (photo_path is null or (length(photo_path) < 250 and photo_path like '%/%.jpg'))
);

create index if not exists costume_demandes_statut_idx on public.costume_demandes(statut, modifie_le desc);
alter table public.costume_demandes enable row level security;
drop policy if exists costume_demandes_lecture on public.costume_demandes;
create policy costume_demandes_lecture on public.costume_demandes for select to authenticated using (
  exists (
    select 1 from public.equipe e
    where lower(btrim(e.email)) = lower(auth.jwt()->>'email')
      and (coalesce(e.responsable, false) or lower(btrim(e.prenom)) = lower(btrim(membre)))
  )
);
revoke all on public.costume_demandes from anon, authenticated;
grant select on public.costume_demandes to authenticated;

-- Une demande est une préférence, pas une réservation d'une robe du stock.
-- Le responsable reste seul habilité à attribuer une pièce Fantasy précise.
create or replace function public.enregistrer_demande_tenue(
  p_evenement_id text,
  p_membre text,
  p_personnage text,
  p_type text,
  p_choix text,
  p_costume_id text default null,
  p_motif text default null,
  p_detail text default null,
  p_photo_path text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  acteur record;
  evenement record;
  ancienne public.costume_demandes%rowtype;
  attrib public.costume_attributions%rowtype;
  piece record;
  piece_actuelle record;
  statut_final text;
  modifie boolean;
  verrou boolean;
  contact_responsable record;
begin
  select e.prenom, e.responsable into acteur from public.equipe e
  where lower(btrim(e.email)) = lower(auth.jwt()->>'email') limit 1;
  if acteur.prenom is null then raise exception 'Compte non lié à l’équipe Fantasy.'; end if;
  if not coalesce(acteur.responsable, false) and lower(btrim(acteur.prenom)) <> lower(btrim(p_membre)) then
    raise exception 'Vous pouvez seulement choisir votre propre tenue.';
  end if;
  if p_type not in ('costume', 'perruque') or p_choix not in ('personnel', 'fantasy', 'sans_perruque') then
    raise exception 'Choix de tenue incorrect.';
  end if;
  if p_choix = 'sans_perruque' and p_type <> 'perruque' then
    raise exception 'Seule une perruque peut être déclarée inutile.';
  end if;
  if p_motif is not null and p_motif not in ('endommage', 'entretien', 'indisponible', 'preference', 'autre') then
    raise exception 'Motif incorrect.';
  end if;
  if length(coalesce(p_detail, '')) > 1000 then raise exception 'Description trop longue.'; end if;
  if p_motif = 'autre' and nullif(btrim(coalesce(p_detail, '')), '') is null then
    raise exception 'Précisez le problème rencontré.';
  end if;
  if p_photo_path is not null and (
    auth.uid() is null or p_photo_path not like auth.uid()::text || '/%.jpg'
    or p_photo_path like '%..%' or length(p_photo_path) > 240
  ) then raise exception 'Photo non autorisée.'; end if;

  select * into evenement from public.evenements where id::text = p_evenement_id;
  if not found or evenement.statut = 'annule' then raise exception 'Prestation indisponible.'; end if;
  if not exists (
    select 1 from unnest(string_to_array(coalesce(evenement.animateurs, ''), ',')) as x(texte)
    where lower(btrim(x.texte)) = lower(btrim(p_membre) || ' (' || btrim(p_personnage) || ')')
  ) then raise exception 'Ce personnage ne vous est pas attribué sur cette date.'; end if;

  select * into ancienne from public.costume_demandes
  where evenement_id = p_evenement_id and membre = p_membre
    and personnage = p_personnage and type = p_type for update;
  select * into attrib from public.costume_attributions
  where evenement_id = p_evenement_id and membre = p_membre
    and personnage = p_personnage and type = p_type for update;
  verrou := coalesce(attrib.verrouille, false) and not coalesce(acteur.responsable, false);

  if p_choix = 'personnel' then
    if nullif(btrim(coalesce(p_costume_id, '')), '') is null then
      raise exception 'Sélectionnez votre costume ou perruque personnel.';
    end if;
    select * into piece from public.costumes where id::text = p_costume_id;
    if not found or lower(btrim(coalesce(piece.proprietaire, ''))) <> lower(btrim(p_membre))
      or lower(btrim(piece.personnage)) <> lower(btrim(p_personnage))
      or coalesce(piece.type, 'costume') <> p_type then
      raise exception 'Cette pièce personnelle ne vous appartient pas ou ne correspond pas au personnage.';
    end if;
    if not verrou then
      perform public.attribuer_costume(p_evenement_id, p_membre, p_personnage, p_type, p_costume_id, false);
    end if;
  elsif not verrou and attrib.costume_id is not null then
    -- Une demande Fantasy retire l'ancienne attribution personnelle, devenue
    -- inutilisable. On conserve une vraie attribution Fantasy déjà décidée par Jordan.
    select * into piece_actuelle from public.costumes where id::text = attrib.costume_id;
    if p_choix = 'sans_perruque' or (p_choix = 'fantasy' and nullif(btrim(coalesce(piece_actuelle.proprietaire, '')), '') is not null) then
      update public.costume_attributions set costume_id = null, modifie_par = acteur.prenom, modifie_le = now()
      where evenement_id = p_evenement_id and membre = p_membre and personnage = p_personnage and type = p_type;
    end if;
  end if;

  statut_final := case
    when p_motif is not null or verrou then 'a_traiter'
    when p_choix = 'fantasy' and not (attrib.costume_id is not null and
      exists (select 1 from public.costumes c where c.id::text = attrib.costume_id
        and nullif(btrim(coalesce(c.proprietaire, '')), '') is null)) then 'a_traiter'
    else 'resolue' end;

  modifie := not found; -- Recalculé ci-dessous en comparant l'ancienne demande.
  modifie := ancienne.evenement_id is null
    or ancienne.choix is distinct from p_choix
    or ancienne.costume_id is distinct from (case when p_choix = 'personnel' then p_costume_id else null end)
    or ancienne.motif is distinct from p_motif
    or ancienne.detail is distinct from nullif(btrim(coalesce(p_detail, '')), '')
    or ancienne.photo_path is distinct from p_photo_path;

  insert into public.costume_demandes
    (evenement_id, membre, personnage, type, choix, costume_id, motif, detail, photo_path,
     statut, modifie_par, modifie_le, traite_par, traite_le)
  values
    (p_evenement_id, p_membre, p_personnage, p_type, p_choix,
     case when p_choix = 'personnel' then p_costume_id else null end,
     p_motif, nullif(btrim(coalesce(p_detail, '')), ''), p_photo_path,
     statut_final, acteur.prenom, now(), null, null)
  on conflict (evenement_id, membre, personnage, type) do update set
    choix = excluded.choix, costume_id = excluded.costume_id, motif = excluded.motif,
    detail = excluded.detail, photo_path = excluded.photo_path,
    statut = case when not modifie then public.costume_demandes.statut else excluded.statut end,
    modifie_par = excluded.modifie_par, modifie_le = excluded.modifie_le,
    traite_par = case when not modifie then public.costume_demandes.traite_par else null end,
    traite_le = case when not modifie then public.costume_demandes.traite_le else null end;

  if modifie and (p_choix = 'fantasy' or p_motif is not null or verrou) then
    for contact_responsable in select e.email from public.equipe e where e.responsable = true
      and nullif(btrim(e.email), '') is not null
      and lower(btrim(e.email)) <> lower(auth.jwt()->>'email') loop
      insert into public.notifications_app
        (destinataire_email, titre, message, type, evenement_id, lien)
      values
        (contact_responsable.email,
         case when p_motif is not null then '⚠️ Problème de tenue signalé' else '👗 Demande de tenue Fantasy' end,
         p_membre || ' (' || p_personnage || ') : ' || p_type || ' · ' ||
         case when p_choix = 'fantasy' then 'souhaite utiliser celui de Fantasy' else 'choix personnel à vérifier' end ||
         case when p_motif is not null then ' · ' || p_motif else '' end ||
         case when nullif(btrim(coalesce(p_detail, '')), '') is not null then ' · ' || left(p_detail, 200) else '' end ||
         ' · ' || coalesce(evenement.titre, evenement.enfant, 'prestation') || ' du ' || to_char(evenement.date::date, 'DD/MM/YYYY'),
         'costume', evenement.id, './index.html?tenue=' || p_evenement_id);
    end loop;
  end if;
end;
$$;

revoke all on function public.enregistrer_demande_tenue(text,text,text,text,text,text,text,text,text) from public;
grant execute on function public.enregistrer_demande_tenue(text,text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.traiter_demande_tenue(
  p_evenement_id text,
  p_membre text,
  p_personnage text,
  p_type text,
  p_statut text
)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare acteur record; demande public.costume_demandes%rowtype; email_membre text;
begin
  select prenom, responsable into acteur from public.equipe
    where lower(btrim(email)) = lower(auth.jwt()->>'email') limit 1;
  if acteur.prenom is null or not coalesce(acteur.responsable, false) then
    raise exception 'Seul un responsable peut traiter cette demande.';
  end if;
  if p_statut not in ('a_traiter', 'en_cours', 'resolue') then raise exception 'Statut incorrect.'; end if;
  update public.costume_demandes set statut = p_statut,
      traite_par = acteur.prenom, traite_le = now()
  where evenement_id = p_evenement_id and membre = p_membre
    and personnage = p_personnage and type = p_type
  returning * into demande;
  if not found then raise exception 'Demande introuvable.'; end if;
  select email into email_membre from public.equipe
    where lower(btrim(prenom)) = lower(btrim(p_membre)) limit 1;
  if nullif(btrim(coalesce(email_membre, '')), '') is not null then
    insert into public.notifications_app
      (destinataire_email, titre, message, type, evenement_id, lien)
    values (email_membre, '👗 Mise à jour de ta tenue',
      p_personnage || ' · ' || p_type || ' : ' ||
      case p_statut when 'resolue' then 'demande résolue' when 'en_cours' then 'demande en cours' else 'demande à traiter' end,
      'costume', p_evenement_id, './index.html?tenue=' || p_evenement_id);
  end if;
end;
$$;

revoke all on function public.traiter_demande_tenue(text,text,text,text,text) from public;
grant execute on function public.traiter_demande_tenue(text,text,text,text,text) to authenticated;

-- Photos privées : visibles seulement par leur auteur et les responsables.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('signalements-tenues', 'signalements-tenues', false, 5000000, array['image/jpeg'])
on conflict (id) do nothing;
drop policy if exists signalements_tenues_inserer on storage.objects;
create policy signalements_tenues_inserer on storage.objects for insert to authenticated
  with check (bucket_id = 'signalements-tenues' and split_part(name, '/', 1) = auth.uid()::text);
drop policy if exists signalements_tenues_lire on storage.objects;
create policy signalements_tenues_lire on storage.objects for select to authenticated using (
  bucket_id = 'signalements-tenues' and (
    split_part(name, '/', 1) = auth.uid()::text or exists (
      select 1 from public.equipe e
      where lower(btrim(e.email)) = lower(auth.jwt()->>'email') and e.responsable = true)
  )
);

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
       and schemaname = 'public' and tablename = 'costume_demandes') then
    alter publication supabase_realtime add table public.costume_demandes;
  end if;
end $$;

commit;
