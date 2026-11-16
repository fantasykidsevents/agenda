-- Fantasy Kids Events — costumes et perruques attribués à la prestation
-- À exécuter dans Supabase > SQL Editor, avant d'utiliser la nouvelle interface.
-- Non destructif : ne supprime aucun costume, aucune perruque, aucune prestation.
-- Compatible avec les identifiants de costumes / événements UUID ou entiers (stockés ici en texte).

begin;

create table if not exists public.costume_attributions (
  evenement_id text not null,
  membre text not null,
  personnage text not null,
  type text not null check (type in ('costume', 'perruque')),
  costume_id text,
  verrouille boolean not null default false,
  modifie_par text,
  modifie_le timestamptz not null default now(),
  primary key (evenement_id, membre, personnage, type)
);

create index if not exists costume_attributions_piece_idx on public.costume_attributions(costume_id);
alter table public.costume_attributions enable row level security;

-- Lecture : seulement les personnes reliées à la véritable équipe Fantasy.
drop policy if exists costume_attributions_equipe_lecture on public.costume_attributions;
create policy costume_attributions_equipe_lecture on public.costume_attributions
  for select to authenticated using (
    exists (select 1 from public.equipe e
      where lower(e.email) = lower(auth.jwt()->>'email'))
  );
revoke all on public.costume_attributions from anon, authenticated;
grant select on public.costume_attributions to authenticated;

-- Actualisation des choix sur les téléphones sans devoir fermer l'application.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'costume_attributions') then
    alter publication supabase_realtime add table public.costume_attributions;
  end if;
end $$;

-- Fonction centrale : les droits et le verrouillage sont contrôlés par Supabase,
-- pas seulement par les boutons de l'application.
create or replace function public.attribuer_costume(
  p_evenement_id text,
  p_membre text,
  p_personnage text,
  p_type text,
  p_costume_id text,
  p_verrouille boolean default false
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  acteur record;
  prestation record;
  piece record;
  ancienne record;
  acteur_est_resp boolean;
  personnage_present boolean;
  proprio text;
  r record;
begin
  select prenom, responsable into acteur
  from public.equipe where lower(email) = lower(auth.jwt()->>'email') limit 1;
  if acteur.prenom is null then raise exception 'Compte non lié à l’équipe Fantasy.'; end if;
  acteur_est_resp := coalesce(acteur.responsable, false);

  select * into prestation from public.evenements where id::text = p_evenement_id;
  if not found then raise exception 'Prestation introuvable.'; end if;
  if prestation.statut = 'annule' then raise exception 'Prestation annulée.'; end if;
  if p_type not in ('costume', 'perruque') then raise exception 'Type de pièce incorrect.'; end if;

  -- Le membre doit réellement avoir CE personnage sur CET événement.
  select exists (
    select 1 from unnest(string_to_array(coalesce(prestation.animateurs, ''), ',')) as x(texte)
    where lower(btrim(x.texte)) = lower(btrim(p_membre) || ' (' || btrim(p_personnage) || ')')
  ) into personnage_present;
  if not personnage_present then raise exception 'Ce membre ne joue pas ce personnage sur la prestation.'; end if;

  if not acteur_est_resp and lower(btrim(acteur.prenom)) <> lower(btrim(p_membre)) then
    raise exception 'Vous ne pouvez choisir que vos propres tenues.';
  end if;

  select * into ancienne from public.costume_attributions
   where evenement_id = p_evenement_id and membre = p_membre
     and personnage = p_personnage and type = p_type for update;
  if not acteur_est_resp and coalesce(ancienne.verrouille, false) then
    raise exception 'Jordan a verrouillé cette tenue pour le spectacle.';
  end if;

  if p_costume_id is not null and btrim(p_costume_id) <> '' then
    select * into piece from public.costumes where id::text = p_costume_id;
    if not found then raise exception 'Costume ou perruque introuvable.'; end if;
    if lower(btrim(piece.personnage)) <> lower(btrim(p_personnage))
       or coalesce(piece.type, 'costume') <> p_type then
      raise exception 'Cette pièce ne correspond pas au personnage et au type choisis.';
    end if;
    proprio := nullif(btrim(piece.proprietaire), '');
    if proprio is not null and lower(proprio) <> lower(btrim(p_membre)) then
      raise exception 'Cette pièce personnelle est réservée à son propriétaire.';
    end if;
    if not acteur_est_resp and proprio is null then
      raise exception 'Seul Jordan peut attribuer ou modifier une pièce du stock Fantasy.';
    end if;

    -- Verrou transactionnel : deux affectations simultanées ne peuvent pas réserver
    -- la même robe ou perruque pour deux prestations qui se chevauchent.
    perform pg_advisory_xact_lock(hashtextextended(p_costume_id, 0));
    if exists (
      select 1 from public.costume_attributions ca
      join public.evenements autre on autre.id::text = ca.evenement_id
      where ca.costume_id = p_costume_id
        and ca.evenement_id <> p_evenement_id
        and autre.date = prestation.date and autre.statut <> 'annule'
        and (
          prestation.heure_debut is null or autre.heure_debut is null
          or (
            left(prestation.heure_debut::text, 5)::time <
              coalesce(left(autre.heure_fin::text, 5)::time, left(autre.heure_debut::text, 5)::time + interval '2 hours') + interval '1 hour'
            and left(autre.heure_debut::text, 5)::time <
              coalesce(left(prestation.heure_fin::text, 5)::time, left(prestation.heure_debut::text, 5)::time + interval '2 hours') + interval '1 hour'
          )
        )
    ) then raise exception 'Cette pièce est déjà réservée pour une autre prestation au même horaire.'; end if;
  else
    if not acteur_est_resp then raise exception 'Seul Jordan peut retirer une attribution.'; end if;
    p_costume_id := null;
  end if;

  insert into public.costume_attributions
    (evenement_id, membre, personnage, type, costume_id, verrouille, modifie_par, modifie_le)
  values (p_evenement_id, p_membre, p_personnage, p_type, p_costume_id,
          case when acteur_est_resp then p_verrouille else coalesce(ancienne.verrouille, false) end,
          acteur.prenom, now())
  on conflict (evenement_id, membre, personnage, type) do update set
    costume_id = excluded.costume_id,
    verrouille = excluded.verrouille,
    modifie_par = excluded.modifie_par,
    modifie_le = excluded.modifie_le;

  -- Un membre qui choisit son propre costume prévient tous les responsables
  -- directement dans leur cloche. La modification reste aussi historisée.
  if not acteur_est_resp and (ancienne.costume_id is distinct from p_costume_id) then
    for r in select email from public.equipe where responsable = true and nullif(btrim(email), '') is not null loop
      insert into public.notifications_app
        (destinataire_email, titre, message, type, evenement_id, lien)
      values (r.email,
        '👗 Tenue personnelle choisie',
        acteur.prenom || ' a choisi ' || coalesce(piece.nom, p_personnage) ||
        ' pour ' || coalesce(prestation.titre, prestation.enfant, 'une prestation') ||
        ' du ' || to_char(prestation.date::date, 'DD/MM/YYYY') || '.',
        'costume', prestation.id, './index.html?costumes=1');
    end loop;
  end if;
end;
$$;

revoke all on function public.attribuer_costume(text,text,text,text,text,boolean) from public;
grant execute on function public.attribuer_costume(text,text,text,text,text,boolean) to authenticated;

-- Protection des objets personnels : les membres créent et modifient leurs
-- propres pièces, jamais celles de quelqu'un d'autre ni le stock Fantasy.
-- L'équipe affectée peut tout de même signaler l'état d'une pièce Fantasy
-- effectivement attribuée sur une prestation (bilan de fin d'animation).
create or replace function public.verifier_gestion_costume()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  acteur record;
  est_resp boolean;
begin
  if auth.role() = 'service_role' then return coalesce(new, old); end if;
  select prenom, responsable into acteur from public.equipe
    where lower(email) = lower(auth.jwt()->>'email') limit 1;
  if acteur.prenom is null then raise exception 'Compte non lié à Fantasy.'; end if;
  est_resp := coalesce(acteur.responsable, false);
  if est_resp then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    if lower(btrim(coalesce(new.proprietaire, ''))) <> lower(btrim(acteur.prenom)) then
      raise exception 'Vous ne pouvez ajouter que votre matériel personnel.';
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if lower(btrim(coalesce(old.proprietaire, ''))) <> lower(btrim(acteur.prenom)) then
      raise exception 'Cette pièce ne vous appartient pas.';
    end if;
    if exists (select 1 from public.costume_attributions ca where ca.costume_id = old.id::text) then
      raise exception 'Cette pièce est attribuée à une prestation. Demandez à Jordan de la retirer avant suppression.';
    end if;
    return old;
  else
    if lower(btrim(coalesce(old.proprietaire, ''))) = lower(btrim(acteur.prenom)) then
      if new.proprietaire is distinct from old.proprietaire or new.id is distinct from old.id then
        raise exception 'Vous ne pouvez pas transférer la propriété de cette pièce.';
      end if;
      return new;
    end if;
    if nullif(btrim(old.proprietaire), '') is null and exists (
      select 1 from public.costume_attributions ca
      where ca.costume_id = old.id::text and lower(ca.membre) = lower(acteur.prenom)
    ) and new.id is not distinct from old.id
      and new.proprietaire is not distinct from old.proprietaire
      and new.personnage is not distinct from old.personnage
      and new.type is not distinct from old.type
      and new.nom is not distinct from old.nom
      and new.chez is not distinct from old.chez then
      return new;
    end if;
    raise exception 'Vous ne pouvez modifier que vos pièces ou signaler l’état d’une pièce attribuée.';
  end if;
end;
$$;

drop trigger if exists gestion_costume_securisee on public.costumes;
create trigger gestion_costume_securisee before insert or update or delete on public.costumes
  for each row execute function public.verifier_gestion_costume();

-- RLS : les nouvelles règles de la base garantissent que l'interface peut
-- fonctionner même si d'anciennes politiques sont plus restrictives.
alter table public.costumes enable row level security;
drop policy if exists costumes_equipe_lecture_2026 on public.costumes;
create policy costumes_equipe_lecture_2026 on public.costumes
  for select to authenticated using (
    exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt()->>'email'))
  );
drop policy if exists costumes_equipe_ajout_2026 on public.costumes;
create policy costumes_equipe_ajout_2026 on public.costumes
  for insert to authenticated with check (
    exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt()->>'email')
      and (e.responsable = true or lower(e.prenom) = lower(proprietaire)))
  );
drop policy if exists costumes_equipe_modif_2026 on public.costumes;
create policy costumes_equipe_modif_2026 on public.costumes
  for update to authenticated using (
    exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt()->>'email')
      and (e.responsable = true or lower(e.prenom) = lower(proprietaire) or
        exists (select 1 from public.costume_attributions ca
          where ca.costume_id = costumes.id::text and lower(ca.membre) = lower(e.prenom))))
  ) with check (
    exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt()->>'email'))
  );
drop policy if exists costumes_equipe_suppression_2026 on public.costumes;
create policy costumes_equipe_suppression_2026 on public.costumes
  for delete to authenticated using (
    exists (select 1 from public.equipe e where lower(e.email) = lower(auth.jwt()->>'email')
      and (e.responsable = true or lower(e.prenom) = lower(proprietaire)))
  );
grant select, insert, update, delete on public.costumes to authenticated;

commit;
