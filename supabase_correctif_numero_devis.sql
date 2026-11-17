-- Correctif du message : column reference "annee" is ambiguous.
-- À exécuter dans Supabase > SQL Editor > Run.
-- Met à jour seulement la fonction de numérotation des devis.
-- Ne supprime ni devis, ni numéros, ni compteurs existants.

create or replace function public.fk_devis_emettre(p_id uuid)
returns public.devis_fantasy
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_devis public.devis_fantasy;
  v_numero integer;
  v_jour date := (now() at time zone 'Europe/Brussels')::date;
  v_annee integer := extract(year from v_jour)::integer;
begin
  if not public.fk_factures_est_responsable() then
    raise exception 'Accès refusé.';
  end if;

  select * into v_devis
  from public.devis_fantasy
  where id = p_id
  for update;

  if not found or v_devis.statut <> 'brouillon' then
    raise exception 'Devis introuvable ou déjà finalisé.';
  end if;

  if coalesce(trim(v_devis.contenu #>> '{emetteur,nom}'),'') = ''
     or coalesce(trim(v_devis.contenu #>> '{client,nom}'),'') = ''
     or coalesce(trim(v_devis.contenu #>> '{client,adresse}'),'') = ''
     or jsonb_array_length(coalesce(v_devis.contenu -> 'lignes','[]'::jsonb)) = 0 then
    raise exception 'Complétez le client, son adresse et les lignes du devis.';
  end if;

  insert into public.devis_fantasy_compteurs(annee, dernier_numero)
  values(v_annee, 1)
  on conflict (annee) do update
    set dernier_numero = public.devis_fantasy_compteurs.dernier_numero + 1
  returning dernier_numero into v_numero;

  perform set_config('fk_devis.autorise_rpc','oui',true);
  update public.devis_fantasy
    set numero = 'DEV-' || v_annee::text || '/' || lpad(v_numero::text,3,'0'),
        statut = 'emis',
        contenu = jsonb_set(v_devis.contenu,'{date_emission}',to_jsonb(v_jour::text),true)
    where id = p_id
    returning * into v_devis;
  perform set_config('fk_devis.autorise_rpc','',true);

  return v_devis;
end;
$$;

revoke all on function public.fk_devis_emettre(uuid) from public, anon;
grant execute on function public.fk_devis_emettre(uuid) to authenticated;
