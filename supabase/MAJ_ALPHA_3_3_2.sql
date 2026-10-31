-- MAJ_ALPHA_3_3_2.sql · Pocket Club · étape B 4 sur 5 (envoi automatique des notifications) · à lancer une fois dans Supabase > SQL Editor > Run (après la 3.3).
-- Remplacer METS_ICI_PUSH_SECRET par le mot de passe PUSH_SECRET avant de lancer. Sans perte de données, relançable sans risque.

-- =====================================================================
-- Pocket Club · alpha 3.3.2 · étape B 4 sur 5 : envoi automatique des notifications (relançable sans risque)
-- À installer APRÈS alpha_3_3.sql.
-- Chaque minute, la base :
--   1. prépare le rappel 72 h avant un rendez-vous, pour ceux qui n'ont pas encore répondu ;
--   2. prépare, à partir de 18 h la veille, le rappel aux bénévoles inscrits sur une mission ;
--   3. vide la corbeille de plus de 30 jours (une fois par jour, à 4 h) ;
--   4. appelle la fonction d'envoi « envoyer-notifications » s'il y a quelque chose à envoyer (et une fois par heure pour le ménage).
-- =====================================================================
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponible ici : %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net indisponible ici : %', sqlerrm; end $$;

-- Adresse de la fonction d'envoi et mot de passe d'appel (lisibles de la base seulement)
create table if not exists push_settings (
  id int primary key default 1 check (id = 1),
  function_url text not null default '',
  secret text not null default ''
);
alter table push_settings enable row level security;
revoke all on push_settings from public, anon, authenticated;
insert into push_settings(id, function_url, secret)
values (1, 'https://rmdszovbpmagtvugfrpr.supabase.co/functions/v1/envoyer-notifications', 'METS_ICI_PUSH_SECRET')
on conflict (id) do update set function_url = excluded.function_url,
  secret = case when excluded.secret = 'METS_ICI_PUSH_SECRET' then push_settings.secret else excluded.secret end;

create or replace function push_tick() returns text language plpgsql security definer set search_path = public as $$
declare e events; u uuid; m record; s push_settings; paris timestamp := now() at time zone 'Europe/Paris'; called boolean := false;
begin
  -- 1. Rappel 72 h avant, à ceux qui n'ont pas encore répondu (une fois par rendez-vous et par personne)
  for e in select * from events where not cancelled and starts_at between now() + interval '70 hours' and now() + interval '72 hours'
           and created_at < now() - interval '12 hours' loop
    foreach u in array coalesce(event_missing(e.id), '{}'::uuid[]) loop
      if not exists(select 1 from event_hidden h where h.event_id = e.id and h.user_id = u) then
        perform push_enqueue(u, 'Ta réponse est attendue', push_ev_line(e), 'ev:' || e.id, 'ev72:' || e.id);
      end if;
    end loop;
  end loop;
  -- 2. Bénévoles : rappel la veille, à partir de 18 h (heure de Paris)
  if extract(hour from paris) >= 18 then
    for m in select ms.user_id, em.id as mission_id, em.label, ev as evrow
             from mission_signups ms join event_missions em on em.id = ms.mission_id join events ev on ev.id = em.event_id
             where not ev.cancelled and (ev.starts_at at time zone 'Europe/Paris')::date = paris::date + 1 loop
      perform push_enqueue(m.user_id, 'Demain, tu es ' || lower(m.label), push_ev_line(m.evrow), 'ev:' || (m.evrow).id, 'benev:' || m.mission_id || ':' || m.user_id);
    end loop;
  end if;
  -- 3. Corbeille de plus de 30 jours, une fois par jour
  if to_char(paris, 'HH24MI') = '0400' then
    begin perform purge_trash(); exception when others then raise notice 'corbeille : %', sqlerrm; end;
  end if;
  -- 4. Appel de la fonction d'envoi
  select * into s from push_settings where id = 1;
  if s.function_url <> '' and s.secret not in ('', 'METS_ICI_PUSH_SECRET')
     and (extract(minute from paris) = 0 or exists(select 1 from push_queue where sent_at is null and tries < 5 and created_at > now() - interval '2 days')) then
    perform net.http_post(url := s.function_url, body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-pocket-secret', s.secret), timeout_milliseconds := 30000);
    called := true;
  end if;
  return case when called then 'envoi demandé' else 'rien à envoyer' end;
end $$;
revoke execute on function push_tick() from public, anon, authenticated;

-- Programme automatique : chaque minute
do $$ begin
  begin perform cron.unschedule('pocket-notifications'); exception when others then null; end;
  perform cron.schedule('pocket-notifications', '* * * * *', 'select public.push_tick()');
exception when others then raise notice 'programme automatique non créé ici : %', sqlerrm; end $$;

select 'Pocket Club alpha 3.3.2 : envoi automatique en place (étape 4 sur 5).' as resultat, (select secret <> 'METS_ICI_PUSH_SECRET' from push_settings) as mot_de_passe_enregistre;
