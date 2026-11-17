-- Fantasy Kids Events : contrats professionnels et devis.
-- À exécuter une fois dans le SQL Editor de Supabase APRÈS supabase_facturation.sql.
-- Ne supprime aucune donnée existante.

-- Numéro TVA du client enregistré avec les montants privés de la prestation.
alter table public.evenements_prive
  add column if not exists client_tva text;

create table if not exists public.devis_fantasy (
  id uuid primary key default gen_random_uuid(),
  source_evenement_id text,
  numero text unique,
  statut text not null default 'brouillon' check (statut in ('brouillon','emis')),
  contenu jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_devis_numero_statut check (
    (statut='brouillon' and numero is null)
    or (statut='emis' and numero is not null)
  )
);

create index if not exists devis_fantasy_created_idx on public.devis_fantasy (created_at desc);
create index if not exists devis_fantasy_evenement_idx on public.devis_fantasy (source_evenement_id);

alter table public.devis_fantasy enable row level security;
drop policy if exists fk_devis_lecture_responsables on public.devis_fantasy;
drop policy if exists fk_devis_creation_responsables on public.devis_fantasy;
drop policy if exists fk_devis_modification_responsables on public.devis_fantasy;
create policy fk_devis_lecture_responsables on public.devis_fantasy
  for select to authenticated using (public.fk_factures_est_responsable());
create policy fk_devis_creation_responsables on public.devis_fantasy
  for insert to authenticated with check (public.fk_factures_est_responsable());
create policy fk_devis_modification_responsables on public.devis_fantasy
  for update to authenticated using (public.fk_factures_est_responsable())
  with check (public.fk_factures_est_responsable());

revoke all on public.devis_fantasy from public, anon;
grant select, insert, update on public.devis_fantasy to authenticated;

create table if not exists public.devis_fantasy_compteurs (
  annee integer primary key,
  dernier_numero integer not null check (dernier_numero > 0)
);
revoke all on public.devis_fantasy_compteurs from public, anon, authenticated;

create or replace function public.fk_devis_verrouiller()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.statut = 'emis' then
    raise exception 'Ce devis est déjà finalisé et ne peut pas être modifié.';
  end if;
  if (new.statut is distinct from old.statut or new.numero is distinct from old.numero)
     and coalesce(current_setting('fk_devis.autorise_rpc',true),'') <> 'oui' then
    raise exception 'Utilisez le bouton Finaliser le devis.';
  end if;
  new.updated_at=now();
  return new;
end;
$$;

create or replace function public.fk_devis_initialiser()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.statut <> 'brouillon' or new.numero is not null then
    raise exception 'Un nouveau devis doit commencer comme brouillon.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fk_devis_initialiser on public.devis_fantasy;
create trigger trg_fk_devis_initialiser before insert on public.devis_fantasy
for each row execute function public.fk_devis_initialiser();
drop trigger if exists trg_fk_devis_verrouiller on public.devis_fantasy;
create trigger trg_fk_devis_verrouiller before update on public.devis_fantasy
for each row execute function public.fk_devis_verrouiller();

create or replace function public.fk_devis_emettre(p_id uuid)
returns public.devis_fantasy language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  d public.devis_fantasy;
  n integer;
  jour date := (now() at time zone 'Europe/Brussels')::date;
  v_annee integer := extract(year from jour)::integer;
begin
  if not public.fk_factures_est_responsable() then raise exception 'Accès refusé.'; end if;
  select * into d from public.devis_fantasy where id = p_id for update;
  if not found or d.statut <> 'brouillon' then raise exception 'Devis introuvable ou déjà finalisé.'; end if;
  if coalesce(trim(d.contenu #>> '{emetteur,nom}'),'') = ''
     or coalesce(trim(d.contenu #>> '{client,nom}'),'') = ''
     or coalesce(trim(d.contenu #>> '{client,adresse}'),'') = ''
     or jsonb_array_length(coalesce(d.contenu -> 'lignes','[]'::jsonb)) = 0 then
    raise exception 'Complétez le client, son adresse et les lignes du devis.';
  end if;
  insert into public.devis_fantasy_compteurs(annee, dernier_numero)
  values(v_annee,1)
  on conflict (annee) do update
     set dernier_numero=public.devis_fantasy_compteurs.dernier_numero+1
  returning dernier_numero into n;
  perform set_config('fk_devis.autorise_rpc','oui',true);
  update public.devis_fantasy
    set numero='DEV-'||v_annee::text||'/'||lpad(n::text,3,'0'),
        statut='emis',
        contenu=jsonb_set(d.contenu,'{date_emission}',to_jsonb(jour::text),true)
    where id=p_id returning * into d;
  perform set_config('fk_devis.autorise_rpc','',true);
  return d;
end;
$$;

revoke all on function public.fk_devis_emettre(uuid) from public, anon;
grant execute on function public.fk_devis_emettre(uuid) to authenticated;
