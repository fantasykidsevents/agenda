-- Fantasy Kids Events · réservations anticipées (animations à plus de 3 mois).
-- Exécuter dans Supabase > SQL Editor, AVANT de déployer notifier-index.ts.
-- Aucune fiche existante n'est convertie automatiquement : seules les NOUVELLES
-- demandes futures sont détectées, puis leurs changements de date sont suivis.
-- Le statut original d'evenements n'est JAMAIS modifié par ce dispositif.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.demandes_anticipees (
  evenement_id uuid primary key references public.evenements(id) on delete cascade,
  statut text not null default 'anticipee'
    check (statut in ('anticipee', 'reconfirmee', 'abandonnee', 'sans_reponse', 'a_traiter', 'cloturee')),
  date_ouverture date not null,
  version integer not null default 1 check (version > 0),
  token_hash text unique,
  premier_email_le timestamptz,
  ouverture_envoyee_le timestamptz,
  rappel_j7_le timestamptz,
  reponse_le timestamptz,
  admin_notifie_le timestamptz,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);

create index if not exists demandes_anticipees_echeances_idx
  on public.demandes_anticipees (statut, date_ouverture);
create index if not exists demandes_anticipees_reponses_idx
  on public.demandes_anticipees (statut, reponse_le) where admin_notifie_le is null;

create table if not exists public.demandes_anticipees_emails (
  id uuid primary key default gen_random_uuid(),
  evenement_id uuid not null references public.evenements(id) on delete cascade,
  etape text not null check (etape in ('accuse', 'ouverture', 'j7', 'manuel')),
  version integer not null,
  destinataire text not null,
  statut text not null default 'en_cours' check (statut in ('en_cours', 'envoye', 'erreur')),
  erreur text,
  cree_le timestamptz not null default now(),
  envoye_le timestamptz
);
create unique index if not exists demandes_anticipees_emails_auto_unique
  on public.demandes_anticipees_emails (evenement_id, etape, version)
  where etape <> 'manuel';
create index if not exists demandes_anticipees_emails_historique_idx
  on public.demandes_anticipees_emails (evenement_id, cree_le desc);

-- Enregistrer automatiquement les nouvelles animations réellement au-delà
-- de trois mois CALENDAIRES, en heure belge. Une prestation confirmée ou
-- annulée ne devient jamais anticipée.
create or replace function public.suivre_demande_anticipee()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_ouverture date;
  v_suivi public.demandes_anticipees%rowtype;
  v_aujourd_hui date := (now() at time zone 'Europe/Brussels')::date;
begin
  select * into v_suivi from public.demandes_anticipees
    where evenement_id = new.id for update;

  if coalesce(new.type_evenement, 'animation') <> 'animation'
    or new.statut <> 'en_attente' then
    if found and v_suivi.statut <> 'cloturee' then
      update public.demandes_anticipees
        set statut = 'cloturee', token_hash = null, modifie_le = now()
        where evenement_id = new.id;
    end if;
    return new;
  end if;

  v_ouverture := (new.date::date - interval '3 months')::date;
  if tg_op = 'INSERT' then
    if v_ouverture > v_aujourd_hui then
      insert into public.demandes_anticipees (evenement_id, date_ouverture)
      values (new.id, v_ouverture) on conflict (evenement_id) do nothing;
    end if;
    return new;
  end if;

  if not found then return new; end if;
  if new.date is distinct from old.date then
    update public.demandes_anticipees set
      date_ouverture = v_ouverture,
      version = version + 1,
      token_hash = null,
      -- Si la nouvelle date est déjà dans les 3 mois, envoyer directement
      -- la demande d'intérêt plutôt que le message « agenda pas encore ouvert ».
      premier_email_le = case when v_ouverture <= v_aujourd_hui then now() else null end,
      ouverture_envoyee_le = null,
      rappel_j7_le = null,
      reponse_le = null,
      admin_notifie_le = null,
      statut = case
        when statut in ('abandonnee', 'cloturee') then statut
        else 'anticipee'
      end,
      modifie_le = now()
    where evenement_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_suivre_demande_anticipee on public.evenements;
create trigger tr_suivre_demande_anticipee
after insert or update of date, statut, type_evenement on public.evenements
for each row execute function public.suivre_demande_anticipee();

alter table public.demandes_anticipees enable row level security;
alter table public.demandes_anticipees_emails enable row level security;
revoke all on public.demandes_anticipees, public.demandes_anticipees_emails
  from public, anon, authenticated;
grant select on public.demandes_anticipees, public.demandes_anticipees_emails
  to authenticated;
drop policy if exists demandes_anticipees_lire_admin on public.demandes_anticipees;
create policy demandes_anticipees_lire_admin on public.demandes_anticipees
for select to authenticated using (exists (
  select 1 from public.equipe e where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and (coalesce(e.responsable, false) or coalesce(e.gestionnaire, false))
));
drop policy if exists demandes_anticipees_emails_lire_admin on public.demandes_anticipees_emails;
create policy demandes_anticipees_emails_lire_admin on public.demandes_anticipees_emails
for select to authenticated using (exists (
  select 1 from public.equipe e where lower(btrim(e.email)) = lower(btrim(auth.jwt()->>'email'))
    and (coalesce(e.responsable, false) or coalesce(e.gestionnaire, false))
));

-- Une URL comporte un jeton aléatoire de 256 bits. Seule son empreinte
-- SHA-256 est stockée. Les RPC ne révèlent ni téléphone ni adresse e-mail.
create or replace function public.anticipation_lire(p_token text)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare v record;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select d.statut, d.date_ouverture, d.version, e.date, e.heure_debut,
    e.theme, e.titre, e.options, e.parent
  into v from public.demandes_anticipees d
  join public.evenements e on e.id = d.evenement_id
  where d.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and e.statut = 'en_attente' and coalesce(e.type_evenement,'animation') = 'animation'
    and d.statut in ('anticipee','reconfirmee','abandonnee','sans_reponse')
    and (now() at time zone 'Europe/Brussels')::date <= d.date_ouverture + 60;
  if not found then return null; end if;
  return jsonb_build_object('statut', v.statut, 'date', v.date,
    'heure', v.heure_debut, 'formule', v.theme, 'titre', v.titre,
    'personnages', coalesce(v.options->>'personnages_client',''),
    'prenom', split_part(btrim(coalesce(v.parent,'')), ' ', 1));
end;
$$;

create or replace function public.anticipation_repondre(p_token text, p_choix text)
returns jsonb language plpgsql security definer
set search_path = public, extensions, pg_temp as $$
declare
  v record;
  v_statut text;
  m record;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$'
    or p_choix not in ('oui','non') then
    return jsonb_build_object('ok',false,'erreur','Lien ou réponse invalide');
  end if;
  v_statut := case when p_choix = 'oui' then 'reconfirmee' else 'abandonnee' end;
  select d.evenement_id, d.statut, d.version, d.date_ouverture,
    e.parent, e.titre, e.date
  into v from public.demandes_anticipees d
  join public.evenements e on e.id = d.evenement_id
  where d.token_hash = encode(digest(p_token,'sha256'),'hex')
    and e.statut = 'en_attente' and coalesce(e.type_evenement,'animation') = 'animation'
    and (now() at time zone 'Europe/Brussels')::date <= d.date_ouverture + 60
  for update of d;
  if not found then return jsonb_build_object('ok',false,'erreur','Lien expiré'); end if;
  if v.statut = v_statut then return jsonb_build_object('ok',true,'deja',true,'statut',v_statut); end if;
  if v.statut not in ('anticipee','sans_reponse') then
    return jsonb_build_object('ok',false,'erreur','Une réponse a déjà été enregistrée');
  end if;
  update public.demandes_anticipees set statut=v_statut, reponse_le=now(),
    admin_notifie_le=null, modifie_le=now() where evenement_id=v.evenement_id;
  for m in select email from public.equipe where coalesce(responsable,false)
    and nullif(btrim(email),'') is not null loop
    insert into public.notifications_app
      (destinataire_email, titre, message, type, evenement_id, lien, cle_unique)
    values (lower(btrim(m.email)),
      case when p_choix='oui' then '✅ Intérêt reconfirmé' else '❌ Demande anticipée abandonnée' end,
      coalesce(v.parent,'Client')||' · '||coalesce(v.titre,'Animation')||' · '||v.date,
      'demande', v.evenement_id, './index.html?ev='||v.evenement_id,
      'anticipation-'||v.evenement_id||'-'||v.version||'-'||p_choix)
    on conflict do nothing;
  end loop;
  return jsonb_build_object('ok',true,'statut',v_statut);
end;
$$;

revoke all on function public.anticipation_lire(text) from public;
revoke all on function public.anticipation_repondre(text,text) from public;
grant execute on function public.anticipation_lire(text) to anon, authenticated;
grant execute on function public.anticipation_repondre(text,text) to anon, authenticated;

commit;
