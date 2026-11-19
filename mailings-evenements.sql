-- Fantasy Kids Events · historique sécurisé des mails groupés aux participants.
-- À exécuter UNE fois dans Supabase > SQL Editor, avant de redéployer notifier.
-- Les campagnes sont créées et mises à jour uniquement par l'Edge Function
-- notifier (clé service_role). Aucun envoi n'est déclenché par ce script.

begin;

create table if not exists public.mailings_evenements (
  id uuid primary key,
  evenement_id uuid not null references public.evenements(id) on delete cascade,
  filtre text not null check (filtre in ('tous', 'confirmes', 'acomptes_manquants')),
  sujet text not null check (char_length(sujet) between 3 and 140),
  message text not null check (char_length(message) between 10 and 4000),
  statut text not null default 'en_cours'
    check (statut in ('en_cours', 'termine', 'partiel', 'erreur')),
  destinataires_total integer not null check (destinataires_total > 0),
  envoyes integer not null default 0 check (envoyes >= 0),
  erreurs integer not null default 0 check (erreurs >= 0),
  details jsonb not null default '[]'::jsonb,
  cree_par text not null,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz,
  termine_le timestamptz,
  constraint mailings_evenements_compteur check (envoyes + erreurs <= destinataires_total)
);

create index if not exists mailings_evenements_historique_idx
  on public.mailings_evenements (evenement_id, cree_le desc);

alter table public.mailings_evenements enable row level security;

-- Aucun accès direct du navigateur, même connecté. Toutes les opérations
-- passent par notifier, qui contrôle le JWT et le rôle de responsable.
revoke all on public.mailings_evenements from public, anon, authenticated;

commit;
