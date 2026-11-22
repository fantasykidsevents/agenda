-- Fantasy App : supervision, incidents, e-mails — module Gestion.
-- A exécuter dans Supabase SQL Editor AVANT la mise en service des écrans.
-- Les commentaires de bilan restent dans la table bilans, sans duplication.
begin;

create table if not exists public.fantasy_suivi_incidents (
  bilan_id text primary key,
  evenement_id text not null,
  statut text not null default 'a_traiter'
    check (statut in ('a_traiter','en_cours','resolu')),
  responsable text not null default '',
  action_prevue text not null default '',
  maj_le timestamptz not null default now(),
  maj_par text not null default '',
  constraint fantasy_incident_responsable_taille check (length(responsable) <= 100),
  constraint fantasy_incident_action_taille check (length(action_prevue) <= 2000)
);
create index if not exists fantasy_suivi_incidents_evt_idx
  on public.fantasy_suivi_incidents(evenement_id);
alter table public.fantasy_suivi_incidents enable row level security;
drop policy if exists fantasy_incidents_responsables on public.fantasy_suivi_incidents;
create policy fantasy_incidents_responsables on public.fantasy_suivi_incidents
for all to authenticated
using (exists (
  select 1 from public.equipe e
  where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and e.responsable = true
))
with check (exists (
  select 1 from public.equipe e
  where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and e.responsable = true
));
revoke all on public.fantasy_suivi_incidents from anon, authenticated;
grant select, insert, update on public.fantasy_suivi_incidents to authenticated;

-- Journal du RESULTAT DE L'ENVOI, pas une garantie de livraison ou de boîte principale.
-- Les e-mails antérieurs ne sont pas inventés/reconstitués.
create table if not exists public.fantasy_emails_journal (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  canal text not null check (canal in ('client','interne')),
  fournisseur text not null check (fournisseur in ('gmail','resend')),
  destinataire text not null,
  sujet text not null,
  statut text not null check (statut in ('accepte','echec')),
  code_erreur text,
  identifiant_fournisseur text
);
create index if not exists fantasy_emails_journal_date_idx
  on public.fantasy_emails_journal (cree_le desc);
alter table public.fantasy_emails_journal enable row level security;
drop policy if exists fantasy_emails_admin_select on public.fantasy_emails_journal;
create policy fantasy_emails_admin_select on public.fantasy_emails_journal
for select to authenticated
using (exists (
  select 1 from public.equipe e
  where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and e.responsable = true
));
revoke all on public.fantasy_emails_journal from anon, authenticated;
grant select on public.fantasy_emails_journal to authenticated;
-- Les écritures sont réservées à la fonction notifier avec service_role.

create table if not exists public.fantasy_diagnostics (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  auteur_email text not null default (coalesce(auth.jwt()->>'email','')),
  categorie text not null check (categorie in ('javascript','promesse')),
  message text not null check (char_length(message) between 1 and 220),
  statut text not null default 'nouveau'
    check (statut in ('nouveau','resolu')),
  maj_le timestamptz
);
create index if not exists fantasy_diagnostics_date_idx
  on public.fantasy_diagnostics (cree_le desc);
alter table public.fantasy_diagnostics enable row level security;
drop policy if exists fantasy_diagnostics_member_insert on public.fantasy_diagnostics;
create policy fantasy_diagnostics_member_insert on public.fantasy_diagnostics
  for insert to authenticated
  with check (
    lower(btrim(auteur_email)) = lower(btrim(auth.jwt()->>'email'))
    and statut = 'nouveau' and maj_le is null
    and exists (
      select 1 from public.equipe e
      where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    )
  );
drop policy if exists fantasy_diagnostics_admin_select on public.fantasy_diagnostics;
create policy fantasy_diagnostics_admin_select on public.fantasy_diagnostics
for select to authenticated
using (exists (
  select 1 from public.equipe e
  where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and e.responsable = true
));
drop policy if exists fantasy_diagnostics_admin_update on public.fantasy_diagnostics;
create policy fantasy_diagnostics_admin_update on public.fantasy_diagnostics
for update to authenticated
using (exists (
  select 1 from public.equipe e
  where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and e.responsable = true
))
with check (exists (
  select 1 from public.equipe e
  where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and e.responsable = true
));
revoke all on public.fantasy_diagnostics from anon, authenticated;
grant select, insert, update on public.fantasy_diagnostics to authenticated;

commit;