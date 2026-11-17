-- Fantasy Kids Events : module de facturation V1
-- À exécuter une fois dans Supabase > SQL Editor, avec un compte administrateur.
-- Les factures sont privées aux membres « responsable » de l'équipe.
-- Les factures émises restent conservées même si une prestation est supprimée.

create or replace function public.fk_factures_est_responsable()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.equipe e
    where lower(e.email) = lower(auth.jwt() ->> 'email')
      and e.responsable is true
  );
$$;

revoke all on function public.fk_factures_est_responsable() from public;
grant execute on function public.fk_factures_est_responsable() to authenticated;

create table if not exists public.factures_fantasy (
  id uuid primary key default gen_random_uuid(),
  source_evenement_id text,
  numero text unique,
  statut text not null default 'brouillon'
    check (statut in ('brouillon', 'emise', 'payee')),
  contenu jsonb not null default '{}'::jsonb,
  date_paiement date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_facture_numero_et_statut check (
    (statut = 'brouillon' and numero is null)
    or (statut in ('emise', 'payee') and numero is not null)
  )
);

create index if not exists factures_fantasy_created_idx
  on public.factures_fantasy (created_at desc);
create index if not exists factures_fantasy_evenement_idx
  on public.factures_fantasy (source_evenement_id);

alter table public.factures_fantasy enable row level security;
drop policy if exists fk_factures_lecture_responsables on public.factures_fantasy;
drop policy if exists fk_factures_creation_responsables on public.factures_fantasy;
drop policy if exists fk_factures_modification_responsables on public.factures_fantasy;
create policy fk_factures_lecture_responsables on public.factures_fantasy
  for select to authenticated using (public.fk_factures_est_responsable());
create policy fk_factures_creation_responsables on public.factures_fantasy
  for insert to authenticated with check (public.fk_factures_est_responsable());
create policy fk_factures_modification_responsables on public.factures_fantasy
  for update to authenticated
  using (public.fk_factures_est_responsable())
  with check (public.fk_factures_est_responsable());

-- Pas de politique DELETE : les factures ne sont jamais détruites dans l'app.
revoke all on public.factures_fantasy from anon;
grant select, insert, update on public.factures_fantasy to authenticated;

create table if not exists public.factures_fantasy_compteurs (
  annee integer primary key,
  dernier_numero integer not null check (dernier_numero > 0)
);
revoke all on public.factures_fantasy_compteurs from public, anon, authenticated;

-- IMPORTANT : si des factures papier ont déjà été émises cette année,
-- initialiser le compteur à leur DERNIER numéro avant la première émission
-- dans l'application (voir INSTALLATION-FACTURES.md).

create or replace function public.fk_factures_proteger()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.statut <> 'brouillon' and (
    new.contenu is distinct from old.contenu
    or new.numero is distinct from old.numero
    or new.source_evenement_id is distinct from old.source_evenement_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Une facture numérotée est définitive et ne peut pas être modifiée.';
  end if;

  if (new.statut is distinct from old.statut
      or new.numero is distinct from old.numero
      or new.date_paiement is distinct from old.date_paiement)
      and coalesce(current_setting('fk_factures.autorise_rpc', true), '') <> 'oui' then
    raise exception 'Utilisez les actions de facturation pour émettre ou marquer une facture payée.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.fk_factures_initialiser()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.statut <> 'brouillon' or new.numero is not null or new.date_paiement is not null then
    raise exception 'Une nouvelle facture doit commencer comme brouillon non numéroté.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fk_factures_initialiser on public.factures_fantasy;
create trigger trg_fk_factures_initialiser
before insert on public.factures_fantasy
for each row execute function public.fk_factures_initialiser();

drop trigger if exists trg_fk_factures_proteger on public.factures_fantasy;
create trigger trg_fk_factures_proteger
before update on public.factures_fantasy
for each row execute function public.fk_factures_proteger();

-- La numérotation se fait côté serveur, dans la même transaction que l'émission.
-- Deux responsables ne peuvent pas obtenir le même numéro.
create or replace function public.fk_factures_emettre(p_id uuid)
returns public.factures_fantasy
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  f public.factures_fantasy;
  n integer;
  v_jour date := (now() at time zone 'Europe/Brussels')::date;
  a integer := extract(year from v_jour)::integer;
  doc jsonb;
begin
  if not public.fk_factures_est_responsable() then
    raise exception 'Accès refusé.';
  end if;
  select * into f from public.factures_fantasy where id = p_id for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if f.statut <> 'brouillon' then raise exception 'Cette facture possède déjà un numéro.'; end if;
  doc := f.contenu;
  if coalesce(trim(doc #>> '{emetteur,nom}'), '') = ''
     or coalesce(trim(doc #>> '{emetteur,tva}'), '') = ''
     or coalesce(trim(doc #>> '{emetteur,adresse}'), '') = ''
     or coalesce(trim(doc #>> '{emetteur,iban}'), '') = ''
     or coalesce(trim(doc #>> '{client,nom}'), '') = ''
     or coalesce(trim(doc #>> '{client,adresse}'), '') = ''
     or coalesce(trim(doc ->> 'regime_tva'), '') = ''
     or coalesce(trim(doc ->> 'type_prix'), '') not in ('ht', 'ttc')
     or jsonb_array_length(coalesce(doc -> 'lignes', '[]'::jsonb)) = 0 then
    raise exception 'Complétez les coordonnées légales, le régime TVA et les lignes de facture.';
  end if;

  insert into public.factures_fantasy_compteurs(annee, dernier_numero)
  values(a, 1)
  on conflict (annee) do update
    set dernier_numero = public.factures_fantasy_compteurs.dernier_numero + 1
  returning dernier_numero into n;

  perform set_config('fk_factures.autorise_rpc', 'oui', true);
  update public.factures_fantasy
    set numero = a::text || '/' || lpad(n::text, 3, '0'),
        statut = 'emise',
        contenu = jsonb_set(doc, '{date_emission}', to_jsonb(v_jour::text), true)
  where id = p_id returning * into f;
  perform set_config('fk_factures.autorise_rpc', '', true);
  return f;
end;
$$;

revoke all on function public.fk_factures_emettre(uuid) from public, anon;
grant execute on function public.fk_factures_emettre(uuid) to authenticated;

create or replace function public.fk_factures_marquer_payee(p_id uuid, p_date date default current_date)
returns public.factures_fantasy
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare f public.factures_fantasy;
begin
  if not public.fk_factures_est_responsable() then raise exception 'Accès refusé.'; end if;
  select * into f from public.factures_fantasy where id = p_id for update;
  if not found or f.statut = 'brouillon' then
    raise exception 'Émettez la facture avant de noter son paiement.';
  end if;
  perform set_config('fk_factures.autorise_rpc', 'oui', true);
  update public.factures_fantasy
    set statut = 'payee', date_paiement = coalesce(p_date, current_date)
    where id = p_id returning * into f;
  perform set_config('fk_factures.autorise_rpc', '', true);
  return f;
end;
$$;

revoke all on function public.fk_factures_marquer_payee(uuid, date) from public, anon;
grant execute on function public.fk_factures_marquer_payee(uuid, date) to authenticated;
