-- Fantasy App : carnet d'entretien des COSTUMES ET PERRUQUES.
-- A executer par Jordan dans Supabase > SQL Editor.
-- Sans photos. Relancable sans supprimer l'historique.

alter table public.costumes
  add column if not exists entretien_seuil integer;

create table if not exists public.costume_entretiens (
  id uuid primary key default gen_random_uuid(),
  costume_id text not null,
  action text not null check (action in ('lavage', 'recoiffage', 'reparation', 'controle', 'autre')),
  note text check (note is null or length(note) <= 1000),
  effectue_par text not null,
  auteur_email text not null,
  effectue_le timestamptz not null default now()
);

create index if not exists costume_entretiens_piece_date_idx
  on public.costume_entretiens (costume_id, effectue_le desc);

-- Stock Fantasy lisible par les membres ; materiel personnel reserve
-- a son proprietaire et aux responsables, comme dans l'app.
create or replace function public.peut_lire_entretien(p_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.costumes c
    where c.id::text = p_id and (
      nullif(btrim(c.proprietaire), '') is null
      or exists (
        select 1 from public.equipe e
        where lower(btrim(e.email)) = lower(btrim(auth.jwt() ->> 'email'))
          and (e.responsable is true or lower(btrim(e.prenom)) = lower(btrim(c.proprietaire)))
      )
    )
  );
$$;

revoke all on function public.peut_lire_entretien(text) from public, anon;
grant execute on function public.peut_lire_entretien(text) to authenticated;

alter table public.costume_entretiens enable row level security;
revoke all on public.costume_entretiens from anon, authenticated;
grant select, insert on public.costume_entretiens to authenticated;

drop policy if exists costume_entretiens_lire on public.costume_entretiens;
create policy costume_entretiens_lire on public.costume_entretiens
  for select to authenticated
  using (public.peut_lire_entretien(costume_id));

drop policy if exists costume_entretiens_ajouter on public.costume_entretiens;
create policy costume_entretiens_ajouter on public.costume_entretiens
  for insert to authenticated
  with check (
    auteur_email = lower(btrim(auth.jwt() ->> 'email'))
    and public.peut_lire_entretien(costume_id)
  );

-- Pas d'UPDATE ni de DELETE depuis l'app : l'historique est conservé.
