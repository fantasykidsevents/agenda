-- Fantasy Kids Events — réponses et suivi des devis envoyés depuis l'agenda.
-- À exécuter une seule fois dans Supabase > SQL Editor, sans supprimer les devis existants.
-- Cela ne concerne pas les devis PDF numérotés de devis_fantasy.

alter table public.devis add column if not exists reponse_client text;
alter table public.devis add column if not exists reponse_motif text;
alter table public.devis add column if not exists reponse_message text;
alter table public.devis add column if not exists reponse_le timestamptz;
alter table public.devis add column if not exists relance_le timestamptz;
alter table public.devis add column if not exists relance_nombre integer not null default 0;
alter table public.devis add column if not exists reponse_push_le timestamptz;

alter table public.devis drop constraint if exists devis_reponse_client_check;
alter table public.devis add constraint devis_reponse_client_check
  check (reponse_client is null or reponse_client in ('refuse', 'modification'));

create table if not exists public.devis_suivi_actions (
  id uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references public.evenements(id) on delete cascade,
  action text not null check (action in ('envoi', 'relance', 'accepte', 'refuse', 'modification')),
  detail text,
  cree_le timestamptz not null default now()
);
create index if not exists devis_suivi_actions_evenement_idx
  on public.devis_suivi_actions(evenement_id, cree_le desc);
alter table public.devis_suivi_actions enable row level security;
drop policy if exists devis_suivi_lecture_responsables on public.devis_suivi_actions;
create policy devis_suivi_lecture_responsables on public.devis_suivi_actions
  for select to authenticated
  using (exists (
    select 1 from public.equipe m
    where lower(m.email) = lower(auth.jwt() ->> 'email') and m.responsable = true
  ));
revoke all on public.devis_suivi_actions from public, anon, authenticated;
grant select on public.devis_suivi_actions to authenticated;

-- Le token aléatoire du devis est la seule autorisation accordée au client.
-- Aucun accès direct à la table devis n'est ouvert au public.
create or replace function public.devis_etat(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare d public.devis%rowtype;
begin
  if p_token is null or length(p_token) < 24 then return null; end if;
  select * into d from public.devis where token::text = p_token limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'reponse_client', d.reponse_client,
    'reponse_le', d.reponse_le,
    'accepte_le', d.accepte_le
  );
end;
$$;
revoke all on function public.devis_etat(text) from public;
grant execute on function public.devis_etat(text) to anon, authenticated;

create or replace function public.devis_repondre(
  p_token text,
  p_reponse text,
  p_motif text default '',
  p_message text default ''
)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  d public.devis%rowtype;
  ev public.evenements%rowtype;
  membre record;
  titre text;
  motif text := left(trim(coalesce(p_motif, '')), 120);
  message text := left(trim(coalesce(p_message, '')), 1000);
begin
  if p_token is null or length(p_token) < 24 or p_reponse not in ('refuse', 'modification') then
    raise exception 'Réponse ou lien invalide.';
  end if;
  if p_reponse = 'modification' and length(message) < 5 then
    raise exception 'Précisez la modification souhaitée.';
  end if;
  select * into d from public.devis where token::text = p_token for update;
  if not found or d.envoye_le is null then raise exception 'Devis introuvable ou non envoyé.'; end if;
  select * into ev from public.evenements where id = d.evenement_id;
  if not found or ev.statut in ('confirme', 'termine', 'annule') or d.accepte_le is not null then
    raise exception 'Ce devis n''attend plus de réponse.';
  end if;
  if d.reponse_client is not null then
    if d.reponse_client = p_reponse then
      return jsonb_build_object('ok', true, 'deja', true, 'reponse', d.reponse_client);
    end if;
    raise exception 'Une réponse a déjà été transmise. Contactez Fantasy Kids Events pour la modifier.';
  end if;

  update public.devis set
    reponse_client = p_reponse,
    reponse_motif = case when p_reponse = 'refuse' then nullif(motif, '') else null end,
    reponse_message = nullif(message, ''),
    reponse_le = now()
  where evenement_id = d.evenement_id;

  -- Une réponse reçue clôt les anciennes alertes "toujours sans réponse".
  update public.notifications_app set lue_le = now()
    where evenement_id::text = d.evenement_id::text and type = 'devis'
      and titre like '⏰%' and lue_le is null;

  insert into public.devis_suivi_actions(evenement_id, action, detail)
  values (d.evenement_id, p_reponse,
    nullif(concat_ws(' · ', nullif(motif, ''), nullif(message, '')), ''));

  titre := coalesce(nullif(ev.titre, ''), nullif(ev.enfant, ''), 'Animation');
  for membre in
    select distinct lower(trim(email)) as email from public.equipe
    where responsable = true and nullif(trim(email), '') is not null
  loop
    insert into public.notifications_app(
      destinataire_email, titre, message, type, evenement_id, lien, cle_unique
    ) values (
      membre.email,
      case when p_reponse = 'refuse' then '❌ Devis refusé' else '💬 Modification du devis demandée' end,
      concat_ws(E'\n', coalesce(nullif(ev.parent, ''), 'Le client') || ' · ' || titre,
        nullif(motif, ''), nullif(message, '')),
      'devis', d.evenement_id,
      './index.html?ev=' || d.evenement_id::text,
      'devis-reponse-' || d.evenement_id::text || '-' || p_reponse || '-'
        || to_char(d.envoye_le, 'YYYYMMDDHH24MISS') || '-' || membre.email
    ) on conflict do nothing;
  end loop;

  return jsonb_build_object('ok', true, 'reponse', p_reponse);
end;
$$;
revoke all on function public.devis_repondre(text, text, text, text) from public;
grant execute on function public.devis_repondre(text, text, text, text) to anon, authenticated;

-- Un ancien onglet encore ouvert ne peut pas accepter un devis déjà refusé
-- ou signalé "à modifier". L'envoi d'une nouvelle proposition le réactive.
create or replace function public.devis_bloquer_accord_tardif()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.accepte_le is null and new.accepte_le is not null
    and old.reponse_client is not null then
    raise exception 'Ce devis a déjà reçu une réponse. Demandez une nouvelle proposition.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_devis_bloquer_accord_tardif on public.devis;
create trigger trg_devis_bloquer_accord_tardif
  before update of accepte_le on public.devis
  for each row execute function public.devis_bloquer_accord_tardif();

-- Trace aussi l'acceptation qui utilise la fonction devis_accepter déjà existante.
create or replace function public.devis_journal_accepte()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if old.accepte_le is null and new.accepte_le is not null then
    insert into public.devis_suivi_actions(evenement_id, action)
    values (new.evenement_id, 'accepte');
    update public.notifications_app set lue_le = now()
      where evenement_id::text = new.evenement_id::text and type = 'devis'
        and titre like '⏰%' and lue_le is null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_devis_journal_accepte on public.devis;
create trigger trg_devis_journal_accepte
  after update of accepte_le on public.devis
  for each row execute function public.devis_journal_accepte();
