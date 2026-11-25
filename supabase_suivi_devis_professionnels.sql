create table if not exists public.devis_fantasy_suivi (
devis_id uuid primary key references public.devis_fantasy(id) on delete cascade,
decision text not null default 'attente' check(decision in ('attente','accepte','refuse')),
decision_le timestamptz, decision_par uuid,
facture_id uuid unique references public.factures_fantasy(id) on delete set null
);
alter table public.devis_fantasy_suivi enable row level security;
revoke all on public.devis_fantasy_suivi from public,anon,authenticated;
grant select on public.devis_fantasy_suivi to authenticated;
drop policy if exists devis_fantasy_suivi_responsables on public.devis_fantasy_suivi;
create policy devis_fantasy_suivi_responsables on public.devis_fantasy_suivi for select to authenticated using (public.fk_factures_est_responsable());
create or replace function public.fk_devis_pro_decision(p_id uuid,p_decision text)
returns public.devis_fantasy_suivi language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.devis_fantasy; s public.devis_fantasy_suivi;
begin
 if auth.uid() is null or not public.fk_factures_est_responsable() then raise exception 'Accès refusé.';end if;
 if p_decision is null or p_decision not in ('attente','accepte','refuse') then raise exception 'Décision invalide.';end if;
 select * into d from public.devis_fantasy where id=p_id for update;
 if not found or d.statut<>'emis' then raise exception 'Seul un devis finalisé peut recevoir une décision.';end if;
 select * into s from public.devis_fantasy_suivi where devis_id=p_id for update;
 if s.facture_id is not null and p_decision<>'accepte' then raise exception 'Une facture est déjà liée à ce devis.';end if;
 insert into public.devis_fantasy_suivi(devis_id,decision,decision_le,decision_par)
 values(p_id,p_decision,case when p_decision='attente' then null else now() end,auth.uid())
 on conflict(devis_id) do update set decision=excluded.decision,decision_le=excluded.decision_le,decision_par=excluded.decision_par returning * into s;
 return s;
end;$$;
create or replace function public.fk_devis_pro_facture(p_id uuid)
returns public.factures_fantasy language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.devis_fantasy; s public.devis_fantasy_suivi; f public.factures_fantasy; doc jsonb;
begin
 if auth.uid() is null or not public.fk_factures_est_responsable() then raise exception 'Accès refusé.';end if;
 select * into d from public.devis_fantasy where id=p_id for update;
 if not found or d.statut<>'emis' then raise exception 'Devis non finalisé ou annulé.';end if;
 select * into s from public.devis_fantasy_suivi where devis_id=p_id for update;
 if not found or s.decision<>'accepte' then raise exception 'Marquez le devis comme accepté avant la conversion.';end if;
 if s.facture_id is not null then select * into f from public.factures_fantasy where id=s.facture_id; if found then return f;end if;end if;
 doc:=(d.contenu-'date_emission'-'echeance')||jsonb_build_object('echeance','','note',concat_ws(E'\n',nullif(d.contenu->>'note',''),'Référence : '||d.numero));
 insert into public.factures_fantasy(source_evenement_id,contenu) values(d.source_evenement_id,doc) returning * into f;
 update public.devis_fantasy_suivi set facture_id=f.id where devis_id=p_id;
 return f;
end;$$;
revoke all on function public.fk_devis_pro_decision(uuid,text) from public,anon;
revoke all on function public.fk_devis_pro_facture(uuid) from public,anon;
grant execute on function public.fk_devis_pro_decision(uuid,text),public.fk_devis_pro_facture(uuid) to authenticated;