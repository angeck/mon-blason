-- MAJ_BETA_1_5_1.sql · mypocketclub · bêta 1.5.1 (Gaël, 20 novembre 2026)
-- À lancer sur la base de test mpc-test (Supabase › SQL Editor). Il contient un « drop » (ancienne contrainte
-- d'unicité des relevés, remplacée par deux index) : Supabase demande de confirmer, c'est normal.
-- mypocketclub · bêta 1.5.1 · script idempotent (se relance sans risque)
-- n° 284 : relevé d'heures envoyé ÉQUIPE PAR ÉQUIPE (un coach à deux équipes : un envoi ferme une seule carte)
-- n° 278 (suite) : président prévenu quand une fonction n'a plus de titulaire ; demandes arrivées ensemble regroupées
-- Le doublon d'équipes créé par un import ne notifie personne (rien à changer : aucune notification n'existe pour ça).

-- ---------- n° 284 · relevés par équipe ----------
-- team_id : l'équipe du relevé (vide = les lignes « Sans équipe ») ; whole : ancien relevé « tout le mois »
-- Pas de clé étrangère sur team_id : une équipe effacée de la corbeille ne doit pas effacer ni bloquer un relevé payé.
alter table coach_statements add column if not exists team_id uuid;
alter table coach_statements add column if not exists whole boolean not null default true;
alter table coach_statements drop constraint if exists coach_statements_club_id_user_id_month_key;
create unique index if not exists coach_statements_whole on coach_statements (club_id, user_id, month) where whole;
create unique index if not exists coach_statements_team on coach_statements (club_id, user_id, month, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)) where not whole;

-- Mois entier envoyé (ancien relevé « tout le mois ») : plus rien ne se modifie ce mois-là
create or replace function month_locked(c uuid, u uuid, d date) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from coach_statements s where s.club_id = c and s.user_id = u and s.month = date_trunc('month', d)::date
                and s.whole and s.status in ('submitted','validated'));
$$;
-- Heures d'une équipe envoyées (ou mois entier) : les lignes de cette équipe ne se modifient plus
create or replace function team_locked(c uuid, u uuid, d date, t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from coach_statements s where s.club_id = c and s.user_id = u and s.month = date_trunc('month', d)::date
                and s.status in ('submitted','validated') and (s.whole or s.team_id is not distinct from t));
$$;

-- Relevé refusé par le bureau (équipe ou mois entier) : le coach peut corriger, même s'il avait confirmé ses heures
create or replace function team_refused(c uuid, u uuid, d date, t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from coach_statements s where s.club_id = c and s.user_id = u and s.month = date_trunc('month', d)::date
                and s.status = 'refused' and (s.whole or s.team_id is not distinct from t));
$$;

create or replace function coach_hours_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE','DELETE') and team_locked(old.club_id, old.user_id, old.day, old.team_id) then raise exception 'Ces heures sont envoyées au bureau : elles ne se modifient plus'; end if;
  if tg_op in ('UPDATE','DELETE') and auth.uid() = old.user_id and hours_frozen(old.club_id, old.user_id, old.day, old.team_id) and not team_refused(old.club_id, old.user_id, old.day, old.team_id) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' then new.user_id := old.user_id; new.club_id := old.club_id; end if;
  if team_locked(new.club_id, new.user_id, new.day, new.team_id) then raise exception 'Ces heures sont envoyées au bureau : elles ne se modifient plus'; end if;
  if auth.uid() = new.user_id and hours_frozen(new.club_id, new.user_id, new.day, new.team_id) and not team_refused(new.club_id, new.user_id, new.day, new.team_id) then
    raise exception 'Tu as confirmé ces heures : demande une correction au trésorier ou au président';
  end if;
  if new.team_id is not null and not exists(select 1 from teams where id = new.team_id and club_id = new.club_id) then raise exception 'Équipe d''un autre club'; end if;
  if auth.uid() is not null and new.team_id is not null and not coaches_team(new.team_id) then raise exception 'Tu n''encadres pas cette équipe'; end if;
  if new.day > current_date + 1 then raise exception 'On note les heures une fois faites'; end if;
  return new;
end $$;

-- « Ajouter mes séances du mois » : saute les équipes déjà envoyées ou confirmées (avant : tout échouait)
create or replace function fill_coach_hours(p_club uuid, p_month date) returns int
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; n int;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  if month_locked(p_club, auth.uid(), m) then raise exception 'Ce mois est envoyé au bureau : il ne se modifie plus'; end if;
  insert into coach_hours(club_id, user_id, team_id, event_id, day, minutes, kind)
    select p_club, auth.uid(), x.t, x.id, x.d, x.mn, x.type from (
      select e.id, e.type, (select t from unnest(e.team_ids) t where coaches_team(t) limit 1) as t, (e.starts_at at time zone 'Europe/Paris')::date as d,
        coalesce(case when e.all_day then null else e.duration_min end, case e.type when 'Entraînement' then 90 when 'Match' then 120 when 'Plateau' then 180 else 240 end) as mn
      from events e
      where e.club_id = p_club and not e.cancelled and e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_any(e.team_ids)
        and e.starts_at >= m and e.starts_at < (m + interval '1 month') and e.starts_at < now()
        and not exists(select 1 from coach_hours h where h.user_id = auth.uid() and h.event_id = e.id)
    ) x
    where not team_locked(p_club, auth.uid(), x.d, x.t) and (not hours_frozen(p_club, auth.uid(), x.d, x.t) or team_refused(p_club, auth.uid(), x.d, x.t));
  get diagnostics n = row_count;
  return n;
end $$;

-- Ancien envoi « tout le mois » (gardé pour une appli pas encore mise à jour)
create or replace function submit_coach_month(p_club uuid, p_month date) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; tot int; k uuid;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  if exists(select 1 from coach_statements s where s.club_id = p_club and s.user_id = auth.uid() and s.month = m and not s.whole) then
    raise exception 'Envoie tes heures équipe par équipe (mets l''application à jour)';
  end if;
  select coalesce(sum(minutes), 0) into tot from coach_hours where club_id = p_club and user_id = auth.uid() and day >= m and day < m + interval '1 month';
  if tot = 0 then raise exception 'Aucune heure notée ce mois-ci'; end if;
  insert into coach_statements(club_id, user_id, month, status, total_minutes, submitted_at, whole)
    values (p_club, auth.uid(), m, 'submitted', tot, now(), true)
    on conflict (club_id, user_id, month) where whole do update set status = 'submitted', total_minutes = tot, submitted_at = now(), decided_by = null, decided_at = null
    where coach_statements.status = 'refused';
  if not found then raise exception 'Ce mois est déjà envoyé au bureau'; end if;
  for k in select c.id from hours_checks c where c.club_id = p_club and c.month = m and exists(select 1 from hours_confirms h where h.check_id = c.id and h.user_id = auth.uid()) loop
    update hours_confirms set confirmed_at = coalesce(confirmed_at, now()), minutes = month_minutes_team(p_club, auth.uid(), m, team_id)
      where check_id = k and user_id = auth.uid();
    perform hours_after_confirm(k);
  end loop;
end $$;

-- n° 284 · envoyer les heures d'UNE équipe (p_team vide = les lignes « Sans équipe »)
-- Répond seulement à la carte de cette équipe ; quand toutes les équipes notées sont envoyées, toutes ses cartes du mois sont réglées.
create or replace function submit_coach_team(p_club uuid, p_month date, p_team uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_month)::date; tot int; k uuid; me uuid := auth.uid(); all_sent boolean;
begin
  if not is_coach_in(p_club) then raise exception 'Réservé aux coachs'; end if;
  if month_locked(p_club, me, m) then raise exception 'Ce mois est déjà envoyé au bureau'; end if;
  select coalesce(sum(minutes), 0) into tot from coach_hours
    where club_id = p_club and user_id = me and day >= m and day < m + interval '1 month' and team_id is not distinct from p_team;
  if tot = 0 then raise exception 'Aucune heure notée pour cette équipe ce mois-ci'; end if;
  insert into coach_statements(club_id, user_id, month, status, total_minutes, submitted_at, team_id, whole)
    values (p_club, me, m, 'submitted', tot, now(), p_team, false)
    on conflict (club_id, user_id, month, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)) where not whole
    do update set status = 'submitted', total_minutes = tot, submitted_at = now(), decided_by = null, decided_at = null
    where coach_statements.status = 'refused';
  if not found then raise exception 'Cette équipe est déjà envoyée au bureau pour ce mois'; end if;
  -- Toutes les équipes où il a noté des heures ce mois-ci sont-elles envoyées ?
  select not exists(select 1 from coach_hours h where h.club_id = p_club and h.user_id = me and h.day >= m and h.day < m + interval '1 month'
                    and not team_locked(p_club, me, h.day, h.team_id)) into all_sent;
  for k in select c.id from hours_checks c where c.club_id = p_club and c.month = m and exists(select 1 from hours_confirms h where h.check_id = c.id and h.user_id = me) loop
    update hours_confirms set confirmed_at = coalesce(confirmed_at, now()), minutes = month_minutes_team(p_club, me, m, team_id)
      where check_id = k and user_id = me and (all_sent or team_id is not distinct from p_team);
    perform hours_after_confirm(k);
  end loop;
end $$;
revoke execute on function submit_coach_team(uuid, date, uuid) from public, anon;
grant execute on function submit_coach_team(uuid, date, uuid) to authenticated;

-- n° 278 + 284 · « Relevé d'heures à valider » : une notification par relevé, donc par équipe, avec son nom
create or replace function notify_statement_sent() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; who text; lbl text; tn text;
begin
  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted') then return new; end if;
  select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'Un coach') into who from profiles p where p.id = new.user_id;
  lbl := (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from new.month)::int];
  if not new.whole then tn := coalesce((select name from teams where id = new.team_id), 'sans équipe'); end if;
  for u in select distinct m.user_id from memberships m where m.club_id = new.club_id and m.status = 'active' and m.role in ('president','bureau')
           and (m.role = 'president' or 'tresorerie' = any(areas_of(new.club_id, m.user_id))) and m.user_id <> new.user_id loop
    perform push_enqueue(u, 'Relevé d''heures à valider', coalesce(who, 'Un coach') || ' a envoyé ses heures de ' || lbl || coalesce(' · ' || tn, ''), 'hours-stmt',
      'stmt:' || new.id || ':' || extract(epoch from coalesce(new.submitted_at, now()))::bigint, './#ouvrir=' || new.club_id || '.heures');
  end loop;
  return new;
end $$;

-- ---------- n° 278 (suite) · demandes arrivées ensemble : une seule notification qui les regroupe ----------
alter table push_queue add column if not exists grp int not null default 1;
create or replace function push_on_join() returns trigger language plpgsql security definer set search_path = public as $$
declare m memberships; u uuid; who text; what text; cname text; q bigint; sub0 text := current_setting('request.jwt.claim.sub', true); uid0 text := current_setting('request.uid', true);
begin
  select * into m from memberships where id = new.id;
  if m.id is null or m.status <> 'pending' then return null; end if;
  select coalesce(nullif(full_name, ''), 'Quelqu''un') into who from profiles where id = m.user_id;
  select name into cname from clubs where id = m.club_id;
  what := case m.role when 'parent' then 'parent de joueur' when 'bureau' then lower(coalesce(m.fonction, 'membre du bureau')) else m.role end
          || coalesce(' ' || (select name from teams where id = m.team_id), '');
  for u in select distinct mm.user_id from memberships mm join push_subscriptions s on s.user_id = mm.user_id
           where mm.club_id = m.club_id and mm.status = 'active' and mm.user_id <> m.user_id loop
    perform push_as(u);
    if can_validate(m.id) then
      -- Une notification « Demande à valider » de ce club pas encore partie, de la dernière minute ? On la regroupe.
      select id into q from push_queue where user_id = u and tag = 'join:' || m.club_id and sent_at is null and tries = 0
        and created_at > now() - interval '1 minute' order by id desc limit 1 for update;
      if q is not null then
        update push_queue set grp = grp + 1, title = 'Demandes à valider', body = (grp + 1) || ' demandes à valider (' || coalesce(cname, '') || ')' where id = q;
      else
        perform push_enqueue(u, 'Demande à valider', coalesce(who, 'Quelqu''un') || ' : ' || what || ' (' || coalesce(cname, '') || ')', 'join:' || m.club_id, 'join:' || m.id);
      end if;
    end if;
  end loop;
  perform push_restore(sub0, uid0);
  return null;
end $$;

-- ---------- n° 278 (suite) · une fonction du bureau n'a plus de titulaire : le président est prévenu ----------
create or replace function notify_function_empty() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; cname text; f text := old.fonction;
begin
  if old.role <> 'bureau' or old.status <> 'active' or f is null or f = 'Membre du bureau' then return null; end if;
  if tg_op = 'UPDATE' and new.role = 'bureau' and new.status = 'active' and new.fonction is not distinct from f then return null; end if;
  select name into cname from clubs where id = old.club_id;
  if cname is null then return null; end if; -- club effacé : rien à dire
  if exists(select 1 from memberships x where x.club_id = old.club_id and x.id <> old.id and x.role = 'bureau' and x.status = 'active' and x.fonction = f) then return null; end if;
  for u in select distinct p.user_id from memberships p where p.club_id = old.club_id and p.role = 'president' and p.status = 'active'
           and p.user_id <> old.user_id and p.user_id is distinct from auth.uid() loop
    perform push_enqueue(u, 'Fonction sans titulaire', f || ' : plus personne n''occupe cette fonction (' || cname || ')', 'fonction:' || old.club_id,
      'fvide:' || old.club_id || ':' || f || ':' || extract(epoch from now())::bigint, './#ouvrir=' || old.club_id || '.bureau');
  end loop;
  return null;
end $$;
drop trigger if exists notify_function_empty on memberships;
create trigger notify_function_empty after update or delete on memberships for each row execute function notify_function_empty();

select close_visitor_functions();
