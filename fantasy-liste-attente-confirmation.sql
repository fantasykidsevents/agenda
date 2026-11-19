-- Fantasy Kids Events · Complément à fantasy-places-liste-attente.sql (Mahin)
-- À lancer APRES le script de Mahin dans Supabase → SQL Editor.
-- La fonction de confirmation est appelée UNIQUEMENT depuis l'Edge Function
-- notifier avec la service role, jamais directement par le navigateur.

alter table public.liste_attente
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists adultes integer,
  add column if not exists enfants integer;

create unique index if not exists liste_attente_id_unique
  on public.liste_attente (id);

create unique index if not exists liste_attente_jeton_hash_unique
  on public.liste_attente (jeton_hash) where jeton_hash is not null;

create or replace function public.confirmer_liste_attente(p_jeton_hash text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  a public.liste_attente%rowtype;
  evenement record;
  encore integer;
  nouvelle_id uuid;
begin
  if p_jeton_hash is null or p_jeton_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('etat', 'invalide');
  end if;

  -- Verrou de la proposition : un double clic ne fait pas deux réservations.
  select * into a from public.liste_attente
    where jeton_hash = p_jeton_hash for update;
  if not found then return jsonb_build_object('etat', 'invalide'); end if;

  if a.statut = 'acceptee' and a.reservation_id is not null then
    return jsonb_build_object('etat', 'deja_confirmee');
  end if;
  if a.statut <> 'proposee' then return jsonb_build_object('etat', 'invalide'); end if;
  if a.proposition_expire_le is null or a.proposition_expire_le <= now() then
    update public.liste_attente set statut = 'expiree', reponse_le = now(),
      jeton_hash = null where id = a.id;
    return jsonb_build_object('etat', 'expiree');
  end if;
  if a.places is null or a.places < 1 or a.adultes is null or a.adultes < 1
    or a.enfants is null or a.enfants < 0 or a.places <> a.adultes + a.enfants then
    return jsonb_build_object('etat', 'invalide');
  end if;

  -- Les validations de liste d'attente pour UN MÊME événement sont
  -- sérialisées dans la même transaction : deux liens ne prennent pas
  -- simultanément les dernières places.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(a.evenement_id::text, 0));

  select evenement_id, restantes into evenement
    from public.places_evenements_calcul()
    where evenement_id = a.evenement_id limit 1;
  if not found then return jsonb_build_object('etat', 'invalide'); end if;
  encore := evenement.restantes;
  if encore is null or encore < a.places then
    return jsonb_build_object('etat', 'insuffisant');
  end if;

  -- Uniquement ICI la liste d'attente devient une vraie réservation.
  -- confirmee_le lance le circuit webhook « mailsReservation » habituel.
  nouvelle_id := pg_catalog.gen_random_uuid();
  insert into public.reservations (
    id, evenement_id, nom, email, telephone, adultes, enfants, places,
    bebes, source, notes, confirmee_le
  ) values (
    nouvelle_id, a.evenement_id, a.nom, a.email, a.telephone,
    a.adultes, a.enfants, a.places, coalesce(a.bebes, 0),
    'liste_attente', '💜 Confirmée depuis la liste d''attente', now()
  );

  update public.liste_attente set statut = 'acceptee', reponse_le = now(),
    reservation_id = nouvelle_id where id = a.id;

  return jsonb_build_object(
    'etat', 'confirmee', 'evenement_id', a.evenement_id,
    'reservation_id', nouvelle_id, 'nom', a.nom, 'places', a.places,
    'titre', (select titre from public.evenements where id = a.evenement_id)
  );
end;
$$;

revoke all on function public.confirmer_liste_attente(text) from public, anon, authenticated;
grant execute on function public.confirmer_liste_attente(text) to service_role;

-- Le cron déjà présent (RAPPELS) déclenchera aussi l'expiration des
-- propositions ; pas d'envoi automatique à un client en liste d'attente.
