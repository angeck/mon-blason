-- MAJ_ALPHA_5_4_0.sql · mypocketclub · lot A du 12 novembre : renforts ciblés (n° 158), conversation avec un mineur et son parent (n° 201), notification des doublons d'exercices (n° 167), rappel par e-mail de validation du club (n° 182), droit à l'image d'un parent parti (n° 183), transfert d'une convocation reçue, saison automatique · contient la 5.3.1, la 5.3.0 et la 5.2.1 · à lancer une fois dans Supabase > SQL Editor > Run.
-- Sans perte de données, relançable sans risque. À lancer JUSTE APRÈS la mise en ligne du code 5.4.0, puis redéployer la fonction envoyer-email.

-- mypocketclub · alpha 5.2.1 · mise à jour d'une base 5.2.0, sans perte de données, relançable.
--   Un membre du bureau qui demande à devenir coach n'est plus validé automatiquement : la demande attend la validation
--   du président ou du Directeur technique (le secrétariat peut aussi la valider, comme avant).
--   Seuls restent immédiats : le supporteur, et toute demande faite par le président.
create or replace function join_club(p_code text, p_role text, p_team uuid, p_child_first text default null, p_child_last text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; mid uuid; auto boolean;
begin
  perform check_join_rate();
  select id into cid from clubs where join_code = upper(trim(p_code));
  if cid is null then insert into join_attempts(user_id) values (auth.uid()); return null; end if;
  if exists(select 1 from profiles where id = auth.uid() and deleted_at is not null) then raise exception 'Ton compte est en cours de suppression'; end if;
  if p_role not in ('bureau','coach','joueur','parent','supporteur') then raise exception 'Rôle invalide'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = cid and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if p_role = 'parent' and coalesce(trim(p_child_first), '') = '' then raise exception 'Indique le prénom de l''enfant'; end if;
  auto := p_role = 'supporteur' or is_president(cid);
  insert into memberships(club_id, user_id, role, team_id, child_first, child_last, status)
    values (cid, auth.uid(), p_role, p_team, nullif(nice_first(p_child_first), ''), nullif(nice_last(p_child_last), ''), 'pending') returning id into mid;
  if auto then perform activate_membership(mid, null, null); end if;
  return cid;
end $$;

select close_visitor_functions();

-- mypocketclub · alpha 5.3.0 · mise à jour d'une base 5.2.1, sans perte de données, relançable.
--   N° 186 · groupes d'échange avec un mineur (règles vérifiées par la base) :
--     - un mineur (compte d'un joueur de moins de 18 ans, ou sans date de naissance) n'est dans un groupe avec un adulte
--       que si un de ses parents y est aussi (sauf groupe d'équipe) ; ce parent ne peut pas en être retiré tant que le mineur y est ;
--     - un supporteur (sans autre profil dans le club) ne peut jamais être dans un groupe avec un mineur ;
--     - groupe d'équipe (groups.team_id) : les parents inscrits d'un mineur y sont ajoutés d'office ;
--     - bouton « Signaler » sur un message : le président du club est prévenu.

alter table groups add column if not exists team_id uuid references teams(id) on delete set null;

-- ---------- outils ----------
-- La personne est-elle, dans ce club, un compte de mineur ? (même règle que account_is_adult)
create or replace function minor_account(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select not account_is_adult(c, u);
$$;
-- Supporteur sans autre profil dans le club
create or replace function supporter_only(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role = 'supporteur')
     and not exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and m.role <> 'supporteur');
$$;
-- La personne a-t-elle sa place dans le groupe d'une équipe ? (bureau, coach ou profil de l'équipe, famille d'un joueur de l'équipe, joueur ou renfort)
create or replace function user_in_team(c uuid, t uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active' and (m.role in ('president', 'bureau') or m.team_id = t))
      or exists(select 1 from players p where p.club_id = c and p.deleted_at is null and p.user_id = u and (p.team_id = t
                or exists(select 1 from player_teams x where x.player_id = p.id and x.team_id = t)
                or exists(select 1 from team_reinforcements r where r.player_id = p.id and r.team_id = t and r.state = 'accepte')))
      or exists(select 1 from player_parents pp join players p on p.id = pp.player_id
                where pp.user_id = u and p.club_id = c and p.deleted_at is null and (p.team_id = t
                or exists(select 1 from player_teams x where x.player_id = p.id and x.team_id = t)
                or exists(select 1 from team_reinforcements r where r.player_id = p.id and r.team_id = t and r.state = 'accepte')));
$$;
revoke execute on function minor_account(uuid, uuid), supporter_only(uuid, uuid), user_in_team(uuid, uuid, uuid) from public, anon;

-- Un groupe d'équipe : l'équipe est du club, et le créateur est du bureau, coach de l'équipe ou contact d'équipe
create or replace function groups_team_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id then
    raise exception 'Le lien d''un groupe avec une équipe ne se change pas';
  end if;
  if new.team_id is not null then
    if not exists(select 1 from teams t where t.id = new.team_id and t.club_id = new.club_id and t.deleted_at is null) then
      raise exception 'Cette équipe n''est pas dans ce club';
    end if;
    if not (exists(select 1 from memberships m where m.club_id = new.club_id and m.user_id = new.created_by and m.status = 'active'
                   and (m.role in ('president', 'bureau') or (m.role = 'coach' and m.team_id = new.team_id)))
            or exists(select 1 from team_contacts c where c.team_id = new.team_id and c.user_id = new.created_by)) then
      raise exception 'Seuls le bureau, les coachs et le contact de l''équipe créent un groupe d''équipe';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists groups_team_check on groups;
create trigger groups_team_check before insert or update of team_id on groups for each row execute function groups_team_check();

-- Ce qui empêche un groupe (message de refus, ou null si tout va bien)
create or replace function group_minor_problem(gid uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare g groups;
begin
  select * into g from groups where id = gid;
  if not found then return null; end if;
  if not exists(select 1 from group_members gm where gm.group_id = gid and minor_account(g.club_id, gm.user_id)) then return null; end if;
  if exists(select 1 from group_members gm where gm.group_id = gid and supporter_only(g.club_id, gm.user_id)) then
    return 'Un supporteur ne peut pas être dans un groupe avec un mineur.';
  end if;
  if g.team_id is not null then
    if exists(select 1 from group_members gm where gm.group_id = gid and not user_in_team(g.club_id, g.team_id, gm.user_id)) then
      return 'Un groupe d''équipe ne réunit que les personnes de cette équipe, du bureau et de ses coachs.';
    end if;
    return null;
  end if;
  -- groupe libre : si un adulte y est, chaque mineur doit avoir un de ses parents dans le groupe
  if exists(select 1 from group_members a where a.group_id = gid and not minor_account(g.club_id, a.user_id))
     and exists(select 1 from group_members mn where mn.group_id = gid and minor_account(g.club_id, mn.user_id)
                and not exists(select 1 from players p join player_parents pp on pp.player_id = p.id
                               join group_members par on par.group_id = gid and par.user_id = pp.user_id
                               where p.user_id = mn.user_id and p.club_id = g.club_id and p.deleted_at is null)) then
    return 'Une conversation avec un mineur n''est pas possible sans un de ses parents.';
  end if;
  return null;
end $$;
revoke execute on function group_minor_problem(uuid) from public, anon;

-- Après un ajout : le groupe d'équipe reçoit d'office les parents du mineur, puis on vérifie les règles
create or replace function group_members_minor_check() returns trigger language plpgsql security definer set search_path = public as $$
declare g groups; msg text;
begin
  select * into g from groups where id = new.group_id;
  if not found then return null; end if;
  if g.team_id is not null and minor_account(g.club_id, new.user_id) then
    insert into group_members(group_id, user_id)
      select new.group_id, pp.user_id from players p join player_parents pp on pp.player_id = p.id
      where p.user_id = new.user_id and p.club_id = g.club_id and p.deleted_at is null
        and exists(select 1 from memberships m where m.club_id = g.club_id and m.user_id = pp.user_id and m.status = 'active')
      on conflict do nothing;
  end if;
  msg := group_minor_problem(new.group_id);
  if msg is not null then raise exception '%', msg; end if;
  return null;
end $$;
drop trigger if exists group_members_minor_check on group_members;
create trigger group_members_minor_check after insert on group_members for each row execute function group_members_minor_check();

-- Après un retrait : un parent ne quitte pas un groupe où son enfant mineur reste sans autre parent
create or replace function group_members_parent_stays() returns trigger language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  select * into g from groups where id = old.group_id;
  if not found then return null; end if;   -- groupe supprimé
  if exists(select 1 from group_members mn join players p on p.user_id = mn.user_id and p.club_id = g.club_id and p.deleted_at is null
            join player_parents pp on pp.player_id = p.id
            where mn.group_id = old.group_id and pp.user_id = old.user_id and minor_account(g.club_id, mn.user_id)
              and not exists(select 1 from player_parents pp2 join group_members o on o.group_id = old.group_id and o.user_id = pp2.user_id
                             where pp2.player_id = p.id)) then
    raise exception 'Un parent ne peut pas quitter ce groupe tant que son enfant mineur y est.';
  end if;
  return null;
end $$;
drop trigger if exists group_members_parent_stays on group_members;
create trigger group_members_parent_stays after delete on group_members for each row execute function group_members_parent_stays();

-- ---------- Signaler un message ----------
create table if not exists message_reports (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  group_id uuid references groups(id) on delete set null,
  message_id bigint references messages(id) on delete set null,
  reporter uuid references auth.users(id) on delete set null,
  reason text check (reason is null or length(reason) <= 300),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users(id) on delete set null,
  unique (message_id, reporter)
);
alter table message_reports enable row level security;
drop policy if exists "signalements lus par le président" on message_reports;
create policy "signalements lus par le président" on message_reports for select using (is_president(club_id));
drop policy if exists "signalements traités par le président" on message_reports;
create policy "signalements traités par le président" on message_reports for update using (is_president(club_id)) with check (is_president(club_id));
revoke all on message_reports from anon;
grant select, update on message_reports to authenticated;

-- Le seul moyen de signaler : cette fonction (le signalant doit être dans le groupe ; le président est prévenu ; le bureau ne lit pas le groupe)
create or replace function report_message(p_message bigint, p_reason text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare m messages; g groups; rid uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into m from messages where id = p_message;
  if not found then raise exception 'Message introuvable'; end if;
  select * into g from groups where id = m.group_id;
  if not exists(select 1 from group_members gm where gm.group_id = m.group_id and gm.user_id = auth.uid()) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;
  insert into message_reports(club_id, group_id, message_id, reporter, reason)
    values (g.club_id, g.id, m.id, auth.uid(), nullif(left(trim(coalesce(p_reason, '')), 300), ''))
    on conflict (message_id, reporter) do update set reason = coalesce(excluded.reason, message_reports.reason)
    returning id into rid;
  perform push_enqueue(x.user_id, 'Message signalé', 'Un message a été signalé dans le groupe « ' || left(g.name, 60) || ' ».', 'rep:' || g.club_id, 'rep:' || rid || ':' || x.user_id, './')
    from memberships x where x.club_id = g.club_id and x.role = 'president' and x.status = 'active';
  return rid;
end $$;
revoke execute on function report_message(bigint, text) from public, anon;
grant execute on function report_message(bigint, text) to authenticated;

-- Le président lit le message signalé (et celui-là seulement), avec son auteur
create or replace function reported_messages(p_club uuid) returns table(report_id uuid, group_name text, message_id bigint, body text, author uuid, reporter uuid, reason text, created_at timestamptz, handled_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_president(p_club) then raise exception 'Réservé au président'; end if;
  return query select r.id, g.name, r.message_id, m.body, m.user_id, r.reporter, r.reason, r.created_at, r.handled_at
    from message_reports r left join groups g on g.id = r.group_id left join messages m on m.id = r.message_id
    where r.club_id = p_club order by r.created_at desc limit 100;
end $$;
revoke execute on function reported_messages(uuid) from public, anon;
grant execute on function reported_messages(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- N° 200 · le contact d'équipe reçoit les convocations des autres clubs (envoyées dans mypocketclub seulement)
--   Une convocation est adressée à un club, pas à une équipe : le contact d'une équipe reçoit les matchs de la convocation dont
--   l'équipe de l'autre club a la même catégorie et le même genre que la sienne (genre vide ou « Mixte » : accepté).
--   Il ne voit que ces matchs ; le contact rencontres, le vice-président et le président gardent tout.
-- ---------------------------------------------------------------------
create or replace function contact_matches_event(c uuid, x jsonb) returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and coalesce((x->>'cancelled')::boolean, false) = false
    and exists(select 1 from team_contacts tc join teams t on t.id = tc.team_id
               where tc.club_id = c and tc.user_id = auth.uid() and t.deleted_at is null and team_contact_eligible(t.id, auth.uid())
                 and t.category <> '' and lower(t.category) = lower(coalesce(x->'team'->>'category', ''))
                 and (t.gender = coalesce(x->'team'->>'gender', '') or t.gender in ('', 'Mixte') or coalesce(x->'team'->>'gender', '') in ('', 'Mixte')));
$$;
create or replace function convocation_events_of(p jsonb) returns jsonb language sql immutable as $$
  select coalesce(p->'data'->'events', p->'events', '[]'::jsonb);
$$;
create or replace function contact_gets_send(p_send uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from convocation_sends s, jsonb_array_elements(convocation_events_of(s.payload)) x
                where s.id = p_send and s.channel = 'app' and s.target_club_id is not null and contact_matches_event(s.target_club_id, x));
$$;
revoke execute on function contact_matches_event(uuid, jsonb), convocation_events_of(jsonb), contact_gets_send(uuid) from public, anon;

create or replace function convocations_received(p_club uuid) returns table(id uuid, from_club text, step text, version int, ref text, sent_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare full_access boolean := receives_convocations(p_club);
begin
  return query select s.id, (select c.name from clubs c where c.id = s.club_id), s.step, s.version, s.ref, s.sent_at, s.read_at
    from convocation_sends s where s.target_club_id = p_club and s.channel = 'app' and s.sent_at > now() - interval '120 days'
      and (full_access or contact_gets_send(s.id)) order by s.sent_at desc limit 30;
end $$;
revoke execute on function convocations_received(uuid) from public, anon;
grant execute on function convocations_received(uuid) to authenticated;

create or replace function convocation_open(p_send uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s convocation_sends; cn text; full_access boolean; pl jsonb;
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' then raise exception 'Document introuvable'; end if;
  full_access := receives_convocations(s.target_club_id);
  if not full_access and not contact_gets_send(p_send) then
    if has_area(s.club_id, 'evenements') then return jsonb_build_object('step', s.step, 'version', s.version, 'data', s.payload); end if;
    raise exception 'Document réservé au correspondant rencontres du club reçu et au contact de l''équipe concernée';
  end if;
  if s.read_at is null then
    update convocation_sends set read_at = now(), read_by = auth.uid(), status = 'lu' where id = s.id;
    select name into cn from clubs where id = s.target_club_id;
    if s.sent_by is not null then
      perform push_enqueue(s.sent_by, 'Convocation lue', coalesce(cn, 'Le club reçu') || ' a ouvert ' || case when s.step = 'P' then 'la pré-convocation' else 'la convocation' end, 'convocation', 'convread:' || s.id);
    end if;
  end if;
  pl := s.payload;
  if not full_access then   -- le contact d'équipe ne lit que les matchs de son équipe
    select jsonb_agg(x order by ord) into pl from (select x, ord from jsonb_array_elements(convocation_events_of(s.payload)) with ordinality t(x, ord)) z where contact_matches_event(s.target_club_id, x);
    pl := case when s.payload ? 'data' then jsonb_set(s.payload, '{data,events}', coalesce(pl, '[]'::jsonb)) else jsonb_set(s.payload, '{events}', coalesce(pl, '[]'::jsonb)) end;
  end if;
  return jsonb_build_object('step', s.step, 'version', s.version, 'data', pl);
end $$;
revoke execute on function convocation_open(uuid) from public, anon;
grant execute on function convocation_open(uuid) to authenticated;

create or replace function convocation_received_events(p_send uuid) returns table(source_event_id uuid, title text, starts_at timestamptz, place text, team text, linked_event uuid)
language plpgsql stable security definer set search_path = public as $$
declare s convocation_sends; full_access boolean;
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' or s.target_club_id is null then return; end if;
  full_access := receives_convocations(s.target_club_id);
  if not full_access and not contact_gets_send(p_send) then return; end if;
  return query
    select (x->>'id')::uuid, coalesce(x->>'title', ''), (x->>'starts_at')::timestamptz, coalesce(x->>'place', ''),
           coalesce(x->'team'->>'name', ''),
           (select l.event_id from convocation_links l join events e on e.id = l.event_id
             where l.send_id = s.id and l.source_event_id = (x->>'id')::uuid and l.club_id = s.target_club_id)
    from jsonb_array_elements(convocation_events_of(s.payload)) x
    where coalesce((x->>'cancelled')::boolean, false) = false and x->>'id' is not null
      and (full_access or contact_matches_event(s.target_club_id, x))
    order by 3, 2;
end $$;
revoke execute on function convocation_received_events(uuid) from public, anon;
grant execute on function convocation_received_events(uuid) to authenticated;

create or replace function link_convocation(p_send uuid, p_source uuid, p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s convocation_sends; e events; full_access boolean; ok_src boolean;
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' or s.target_club_id is null then raise exception 'Convocation introuvable'; end if;
  full_access := receives_convocations(s.target_club_id);
  select exists(select 1 from jsonb_array_elements(convocation_events_of(s.payload)) x where (x->>'id')::uuid = p_source and (full_access or contact_matches_event(s.target_club_id, x))) into ok_src;
  if not ok_src then raise exception 'Convocation introuvable'; end if;
  select * into e from events where id = p_event;
  if e.id is null or e.club_id <> s.target_club_id or not (has_area(e.club_id, 'evenements') or is_team_contact_all(e.team_ids)) then raise exception 'Rendez-vous introuvable dans ton club'; end if;
  insert into convocation_links(send_id, source_event_id, club_id, event_id, created_by) values (p_send, p_source, s.target_club_id, p_event, auth.uid())
    on conflict (send_id, source_event_id, club_id) do update set event_id = excluded.event_id, created_by = excluded.created_by, created_at = now();
end $$;
revoke execute on function link_convocation(uuid, uuid, uuid) from public, anon;
grant execute on function link_convocation(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- N° 136 (2) · profil « Aide coach » pour les mineurs
--   Un joueur de 15 à 17 ans (compte à lui) est choisi par un coach de l'équipe ou le président. Il n'a AUCUN droit en plus, sauf voir les
--   joueurs de l'équipe en « Prénom I. » (sans coordonnées ni photo) et le nom des coachs. Le droit se calcule à chaque usage : il tombe
--   dès que la personne n'est plus mineure ou plus membre du club. Aucun accès aux rendez-vous, à l'appel, aux messages ni aux fiches.
-- ---------------------------------------------------------------------
create table if not exists team_helpers (
  team_id uuid not null references teams(id) on delete cascade,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table team_helpers enable row level security;
drop policy if exists "aides coach lues" on team_helpers;
create policy "aides coach lues" on team_helpers for select using (user_id = auth.uid() or is_president(club_id) or coaches_team(team_id));
revoke all on team_helpers from anon;
grant select on team_helpers to authenticated;

create or replace function team_helper_eligible(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u is not null and exists(select 1 from players p where p.club_id = c and p.user_id = u and p.deleted_at is null)
    and not account_is_adult(c, u)
    and exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active');
$$;
create or replace function can_set_team_helper(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from teams x where x.id = t and x.deleted_at is null) and (coaches_team(t) or is_president((select club_id from teams where id = t)));
$$;
revoke execute on function team_helper_eligible(uuid, uuid), can_set_team_helper(uuid) from public, anon;

create or replace function team_helper_candidates(p_team uuid) returns table(uid uuid, label text)
language plpgsql stable security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or not can_set_team_helper(p_team) then raise exception 'Réservé au coach de l''équipe et au président'; end if;
  return query
    select p.user_id, p.first_name || ' ' || upper(left(coalesce(nullif(p.last_name, ''), ' '), 1)) || '.'
    from players p where p.club_id = t.club_id and p.user_id is not null and p.deleted_at is null and team_helper_eligible(t.club_id, p.user_id)
      and not exists(select 1 from team_helpers h where h.team_id = p_team and h.user_id = p.user_id)
    order by p.first_name;
end $$;

create or replace function team_helpers_of(p_team uuid) returns table(uid uuid, label text, set_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or not (can_set_team_helper(p_team) or is_board(t.club_id)) then raise exception 'Réservé à l''encadrement de l''équipe'; end if;
  return query select h.user_id, p.first_name || ' ' || upper(left(coalesce(nullif(p.last_name, ''), ' '), 1)) || '.', h.set_at
    from team_helpers h join profiles p on p.id = h.user_id where h.team_id = p_team order by h.set_at;
end $$;

create or replace function set_team_helper(p_team uuid, p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t teams; tn text;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or not can_set_team_helper(p_team) then raise exception 'Réservé au coach de l''équipe et au président'; end if;
  if p_on then
    if not team_helper_eligible(t.club_id, p_user) then raise exception 'Seul un joueur mineur du club, avec son propre compte, peut être aide coach'; end if;
    insert into team_helpers(team_id, club_id, user_id, set_by) values (p_team, t.club_id, p_user, auth.uid()) on conflict do nothing;
    if found then
      perform push_enqueue(x, 'Aide coach', 'Tu es aide coach de l''équipe ' || left(t.name, 40) || '. Tu vois les noms des joueurs et des coachs, rien de plus.', 'aide:' || p_team, 'aide:' || p_team || ':' || x || ':' || to_char(now(), 'YYYYMMDDHH24'), './')
        from (select p_user x union select pp.user_id from players pl join player_parents pp on pp.player_id = pl.id where pl.user_id = p_user and pl.club_id = t.club_id) z;
    end if;
  else
    delete from team_helpers where team_id = p_team and user_id = p_user;
  end if;
  perform log_action(t.club_id, p_user, null, case when p_on then 'aide coach ajouté' else 'aide coach retiré' end, jsonb_build_object('equipe', t.name));
end $$;

create or replace function my_helper_teams() returns table(team_id uuid, team_name text, club_id uuid)
language sql stable security definer set search_path = public as $$
  select h.team_id, t.name, h.club_id from team_helpers h join teams t on t.id = h.team_id
  where h.user_id = auth.uid() and t.deleted_at is null and team_helper_eligible(h.club_id, h.user_id);
$$;

-- Ce que voit l'aide coach : les coachs (nom complet) et les joueurs (« Prénom I. »), au format de club_roster
create or replace function helper_roster(p_team uuid) returns table(kind text, ref uuid, user_id uuid, first_name text, last_name text, role text, team_id uuid, assistant boolean, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare t teams;
begin
  select * into t from teams where id = p_team and deleted_at is null;
  if t.id is null or not exists(select 1 from team_helpers h where h.team_id = p_team and h.user_id = auth.uid()) or not team_helper_eligible(t.club_id, auth.uid()) then return; end if;
  return query
    select 'membre'::text, m.id, m.user_id, p.first_name, p.last_name, m.role, m.team_id, m.assistant, m.created_at
      from memberships m join profiles p on p.id = m.user_id where m.club_id = t.club_id and m.team_id = p_team and m.role = 'coach' and m.status = 'active'
    union all
    select 'joueur'::text, x.id, null::uuid, x.first_name, case when x.last_name = '' then '' else left(x.last_name, 1) || '.' end, 'joueur'::text, p_team, false, x.created_at
      from players x where x.club_id = t.club_id and x.deleted_at is null and (x.team_id = p_team or exists(select 1 from player_teams pt where pt.player_id = x.id and pt.team_id = p_team));
end $$;
revoke execute on function team_helper_candidates(uuid), team_helpers_of(uuid), set_team_helper(uuid, uuid, boolean), my_helper_teams(), helper_roster(uuid) from public, anon;
grant execute on function team_helper_candidates(uuid), team_helpers_of(uuid), set_team_helper(uuid, uuid, boolean), my_helper_teams(), helper_roster(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- N° 187 · durées de conservation : suppressions automatiques (temps 2)
--   Une saison court du 1er juillet au 30 juin. Les règles sont écrites dans purge_expired(), qui NE TOURNE PAS toute seule :
--   Gaël la lance à la main (purge_expired() = simple comptage, purge_expired(true) = suppression), puis la planifie quand il est sûr.
--     - messages : effacés quand la 3e saison après leur saison commence (on garde la saison en cours et la précédente) ;
--     - présences : anonymisées quand la saison suivante commence (totaux gardés par équipe et par saison, plus aucun nom) ;
--     - journal des actions sensibles : 1 an ;
--     - e-mail d'un responsable invité (entente) : effacé 30 jours après l'invitation s'il n'y a pas eu d'inscription ;
--     - comptes : aucune connexion depuis 2 saisons (la saison en cours et la précédente) ; l'avertissement par e-mail se prépare avec
--       warn_inactive_accounts() (l'envoi n'est pas branché) ;
--       30 jours après l'avertissement, le compte entre dans la suppression habituelle (30 jours de corbeille).
--   Pas encore codé : la fiche d'un joueur parti du club (« 2 saisons après le départ ») : l'application ne note pas encore le départ.
-- ---------------------------------------------------------------------
create table if not exists attendance_archive (
  club_id uuid not null references clubs(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  season text not null,
  present int not null default 0,
  absent int not null default 0,
  retard int not null default 0,
  primary key (club_id, season, team_id)
);
alter table attendance_archive enable row level security;
drop policy if exists "totaux de présence lus par l'encadrement" on attendance_archive;
create policy "totaux de présence lus par l'encadrement" on attendance_archive for select using (is_board(club_id) or coaches_team(team_id));
revoke all on attendance_archive from anon;
grant select on attendance_archive to authenticated;
alter table profiles add column if not exists inactive_warned_at timestamptz;

-- Premier jour de la saison qui contient la date (1er juillet)
create or replace function season_start(ts timestamptz) returns date language sql immutable as $$
  select make_date(extract(year from ((ts at time zone 'Europe/Paris') - interval '6 months'))::int, 7, 1);
$$;
create or replace function season_label(ts timestamptz) returns text language sql immutable as $$
  select extract(year from season_start(ts))::int || '-' || (extract(year from season_start(ts))::int + 1);
$$;

create or replace function warn_inactive_accounts(p_apply boolean default false) returns table(user_id uuid, email text, first_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query select u.id, u.email::text, pr.first_name
    from auth.users u join profiles pr on pr.id = u.id
    where pr.deleted_at is null and pr.inactive_warned_at is null
      and coalesce(u.last_sign_in_at, u.created_at) < (season_start(now()) - interval '1 year') + interval '30 days';
  if p_apply then
    update profiles pr set inactive_warned_at = now() from auth.users u
      where u.id = pr.id and pr.deleted_at is null and pr.inactive_warned_at is null and coalesce(u.last_sign_in_at, u.created_at) < (season_start(now()) - interval '1 year') + interval '30 days';
  end if;
end $$;

create or replace function purge_expired(p_apply boolean default false) returns table(item text, n bigint)
language plpgsql security definer set search_path = public as $$
declare cur date := season_start(now()); k bigint;
begin
  -- messages : saison de création + 2 saisons
  select count(*) into k from messages m where season_start(m.created_at) + interval '2 years' <= now();
  item := 'messages à effacer'; n := k; return next;
  if p_apply then delete from messages m where season_start(m.created_at) + interval '2 years' <= now(); end if;

  -- présences : totaux gardés, noms retirés dès la saison suivante
  select count(*) into k from attendance a join events e on e.id = a.event_id where e.starts_at < cur;
  item := 'présences à anonymiser'; n := k; return next;
  if p_apply then
    insert into attendance_archive(club_id, team_id, season, present, absent, retard)
      select e.club_id, p.team_id, season_label(e.starts_at), count(*) filter (where a.status = 'present'), count(*) filter (where a.status = 'absent'), count(*) filter (where a.status = 'retard')
      from attendance a join events e on e.id = a.event_id join players p on p.id = a.player_id where e.starts_at < cur
      group by e.club_id, p.team_id, season_label(e.starts_at)
      on conflict (club_id, season, team_id) do update set present = attendance_archive.present + excluded.present, absent = attendance_archive.absent + excluded.absent, retard = attendance_archive.retard + excluded.retard;
    delete from attendance a using events e where e.id = a.event_id and e.starts_at < cur;
  end if;

  -- journal des actions sensibles : 1 an
  select count(*) into k from action_log where at < now() - interval '1 year';
  item := 'lignes du journal à effacer'; n := k; return next;
  if p_apply then delete from action_log where at < now() - interval '1 year'; end if;

  -- e-mail d'un responsable invité (entente) : 30 jours après l'invitation (date lue au journal)
  select count(*) into k from teams t where t.partner_state = 'invitee' and coalesce(t.partner_contact->>'email', '') <> ''
    and coalesce((select max(l.at) from action_log l where l.club_id = t.club_id and l.action = 'Entente : club invité' and l.detail->>'équipe' = t.name), t.created_at) < now() - interval '30 days';
  item := 'e-mails de responsables invités à effacer'; n := k; return next;
  if p_apply then
    perform set_config('pc.partner', 'on', true);
    update teams t set partner_contact = t.partner_contact - 'email'
      where t.partner_state = 'invitee' and coalesce(t.partner_contact->>'email', '') <> ''
        and coalesce((select max(l.at) from action_log l where l.club_id = t.club_id and l.action = 'Entente : club invité' and l.detail->>'équipe' = t.name), t.created_at) < now() - interval '30 days';
    perform set_config('pc.partner', 'off', true);
  end if;

  -- comptes : aucune connexion depuis 2 saisons et prévenus depuis 30 jours : ils passent en corbeille (30 jours, comme une suppression demandée)
  select count(*) into k from profiles pr join auth.users u on u.id = pr.id
    where pr.deleted_at is null and pr.inactive_warned_at < now() - interval '30 days' and coalesce(u.last_sign_in_at, u.created_at) < season_start(now()) - interval '1 year';
  item := 'comptes inactifs à mettre à la corbeille'; n := k; return next;
  if p_apply then
    update profiles pr set deleted_at = now() from auth.users u
      where u.id = pr.id and pr.deleted_at is null and pr.inactive_warned_at < now() - interval '30 days' and coalesce(u.last_sign_in_at, u.created_at) < season_start(now()) - interval '1 year';
  end if;

  -- invitations de parent (adresse saisie par le joueur) : effacées 30 jours après leur création
  select count(*) into k from parent_invitations where created_at < now() - interval '30 days';
  item := 'invitations de parent à effacer'; n := k; return next;
  if p_apply then delete from parent_invitations where created_at < now() - interval '30 days'; end if;
end $$;
revoke execute on function purge_expired(boolean), warn_inactive_accounts(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- N° 188 · vue client du président (la vue mairie / comité est repoussée, décision de Gaël du 11 novembre)
--   Le président voit, en lecture seule : le statut de son club (test, gratuit, payant), la période d'engagement, le nombre de licenciés
--   et, si le club est payant, le montant estimé. Gaël fixe ces valeurs à la main (table club_subscription) ; rien n'est modifiable par le club.
-- ---------------------------------------------------------------------
create table if not exists club_subscription (
  club_id uuid primary key references clubs(id) on delete cascade,
  status text not null default 'test' check (status in ('test', 'gratuit', 'payant')),
  engaged_from date,
  engaged_to date,
  rate_cents int check (rate_cents is null or rate_cents between 0 and 10000),   -- prix par joueur et par an, en centimes (200 = 2,00 €)
  free_teams int not null default 1 check (free_teams between 0 and 20),         -- équipes gratuites (la première équipe est gratuite)
  note text not null default '' check (length(note) <= 300),
  updated_at timestamptz not null default now()
);
alter table club_subscription enable row level security;
revoke all on club_subscription from anon, authenticated;

create or replace function club_client_view(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sub club_subscription; lic int; paying int; due int;
begin
  if not is_president(p_club) then raise exception 'Réservé au président du club'; end if;
  select * into sub from club_subscription where club_id = p_club;
  select count(*) into lic from players where club_id = p_club and deleted_at is null;
  -- joueurs payants : tous, sauf ceux des équipes gratuites (les plus nombreuses)
  select greatest(0, lic - coalesce((select sum(c) from (select count(*) c from players x where x.club_id = p_club and x.deleted_at is null and x.team_id is not null group by x.team_id order by c desc limit coalesce(sub.free_teams, 1)) f), 0)) into paying;
  due := case when coalesce(sub.status, 'test') = 'payant' and sub.rate_cents is not null then paying * sub.rate_cents else null end;
  return jsonb_build_object('status', coalesce(sub.status, 'test'), 'engaged_from', sub.engaged_from, 'engaged_to', sub.engaged_to,
    'licensees', lic, 'paying_players', paying, 'rate_cents', sub.rate_cents, 'due_cents', due, 'note', coalesce(sub.note, ''));
end $$;
revoke execute on function club_client_view(uuid) from public, anon;
grant execute on function club_client_view(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Supprimer le compte d'un joueur dans ce club (président seulement)
--    Le compte global n'est pas touché (la personne peut être dans un autre club).
--    Ici : l'accès au club est retiré et la fiche part à la corbeille 30 jours.
--    Restaurer la fiche rend l'accès. Après 30 jours, la fiche est effacée et l'accès ne revient plus.
-- ---------------------------------------------------------------------
create table if not exists trashed_memberships (
  player_id uuid not null references players(id) on delete cascade,
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  team_id uuid,
  assistant boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (player_id, user_id)
);
alter table trashed_memberships enable row level security;   -- aucune lecture directe : tout passe par les fonctions

create or replace function trash_player_account(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
declare pl players;
begin
  select * into pl from players where id = p_player and deleted_at is null;
  if pl.id is null or not is_president(pl.club_id) then raise exception 'Seul le président supprime le compte d''un joueur'; end if;
  if pl.user_id is null then raise exception 'Ce joueur n''a pas de compte : mets simplement sa fiche à la corbeille'; end if;
  if pl.user_id = auth.uid() then raise exception 'Tu ne peux pas supprimer ton propre compte ici'; end if;
  if exists(select 1 from memberships where club_id = pl.club_id and user_id = pl.user_id and role in ('president','bureau')) then
    raise exception 'Cette personne a une fonction au bureau : retire-la d''abord';
  end if;
  insert into trashed_memberships(player_id, club_id, user_id, role, team_id, assistant)
    select pl.id, m.club_id, m.user_id, m.role, m.team_id, m.assistant from memberships m
     where m.club_id = pl.club_id and m.user_id = pl.user_id and m.status = 'active'
  on conflict do nothing;
  delete from group_members where user_id = pl.user_id and group_id in (select id from groups where club_id = pl.club_id);
  delete from memberships where club_id = pl.club_id and user_id = pl.user_id;
  perform set_config('pc.trash', 'on', true);
  update players set deleted_at = now(), deleted_by = auth.uid() where id = pl.id;
  perform set_config('pc.trash', 'off', true);
  insert into action_log(club_id, actor, action, detail) values (pl.club_id, auth.uid(), 'compte joueur supprimé du club (corbeille 30 jours)', jsonb_build_object('player', pl.id));
end $$;
revoke execute on function trash_player_account(uuid) from public, anon;
grant execute on function trash_player_account(uuid) to authenticated;

-- Fiche restaurée : l'accès au club revient (sauf si la personne y est déjà revenue par une autre voie)
create or replace function restore_trashed_memberships() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.deleted_at is not null and new.deleted_at is null then
    insert into memberships(club_id, user_id, role, team_id, assistant, status)
      select t.club_id, t.user_id, t.role, t.team_id, t.assistant, 'active' from trashed_memberships t
       where t.player_id = new.id and not exists(select 1 from memberships m where m.club_id = t.club_id and m.user_id = t.user_id);
    delete from trashed_memberships where player_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists players_restore_memberships on players;
create trigger players_restore_memberships after update of deleted_at on players for each row execute function restore_trashed_memberships();


-- ---------------------------------------------------------------------
-- 7. Invitation du parent d'un joueur de 15 à 17 ans
--    Le joueur (compte à lui) saisit l'e-mail d'un parent. Le parent reçoit un lien (14 jours, une seule fois),
--    crée son compte avec CETTE adresse, et sa demande « parent » arrive chez le président, pré-remplie : la validation
--    du président reste la règle (rien n'est relié sans lui).
-- ---------------------------------------------------------------------
create table if not exists parent_invitations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  email text not null,
  token text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);
alter table parent_invitations enable row level security;   -- aucune lecture directe : tout passe par les fonctions

create or replace function invite_parent(p_player uuid, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare pl players; em text := lower(trim(coalesce(p_email, ''))); own text; k int; iid uuid;
begin
  select * into pl from players where id = p_player and deleted_at is null;
  if pl.id is null or pl.user_id is distinct from auth.uid() then raise exception 'Seul le joueur invite son parent'; end if;
  if pl.birth_date is null or pl.birth_date > current_date - interval '15 years' or pl.birth_date <= current_date - interval '18 years' then
    raise exception 'L''invitation d''un parent concerne les joueurs de 15 à 17 ans';
  end if;
  if em !~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$' then raise exception 'Adresse e-mail non valide'; end if;
  select lower(email) into own from auth.users where id = auth.uid();
  if own = em then raise exception 'Indique l''e-mail d''un parent, pas le tien'; end if;
  select count(*) into k from parent_invitations where player_id = pl.id and created_at > now() - interval '24 hours';
  if k >= 3 then raise exception 'Trois invitations par jour au maximum : réessaie demain'; end if;
  insert into parent_invitations(club_id, player_id, email, token, created_by)
    values (pl.club_id, pl.id, em, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), auth.uid()) returning id into iid;
  return iid;
end $$;
revoke execute on function invite_parent(uuid, text) from public, anon;
grant execute on function invite_parent(uuid, text) to authenticated;

-- Lue une seule fois, au nom du joueur, par la fonction d'envoi des e-mails
create or replace function parent_invitation_take(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i parent_invitations; r jsonb;
begin
  select * into i from parent_invitations where id = p_id and created_by = auth.uid() and sent_at is null and used_at is null and expires_at > now();
  if i.id is null then return null; end if;
  update parent_invitations set sent_at = now() where id = i.id;
  select jsonb_build_object('email', i.email, 'token', i.token, 'expires_at', i.expires_at,
           'child_first', pl.first_name, 'club', c.name) into r
    from players pl join clubs c on c.id = pl.club_id where pl.id = i.player_id;
  return r;
end $$;
revoke execute on function parent_invitation_take(uuid) from public, anon;
grant execute on function parent_invitation_take(uuid) to authenticated;

-- Le parent ouvre le lien : sa demande « parent » part chez le président (adresse du compte = adresse invitée)
create or replace function accept_parent_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare i parent_invitations; pl players; own text; code text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into i from parent_invitations where token = p_token;
  if i.id is null or i.used_at is not null or i.expires_at < now() then raise exception 'Cette invitation n''est plus valable'; end if;
  select lower(email) into own from auth.users where id = auth.uid();
  if own is distinct from i.email then raise exception 'Cette invitation est pour une autre adresse e-mail'; end if;
  select * into pl from players where id = i.player_id and deleted_at is null;
  if pl.id is null then raise exception 'Cette invitation n''est plus valable'; end if;
  if exists(select 1 from memberships where club_id = i.club_id and user_id = auth.uid()) then raise exception 'Tu as déjà une demande ou un accès dans ce club'; end if;
  select join_code into code from clubs where id = i.club_id;
  perform join_club(code, 'parent', pl.team_id, pl.first_name, pl.last_name);
  update parent_invitations set used_at = now(), used_by = auth.uid() where id = i.id;
  return i.club_id;
end $$;
revoke execute on function accept_parent_invitation(text) from public, anon;
grant execute on function accept_parent_invitation(text) to authenticated;


select close_visitor_functions();

-- mypocketclub · alpha 5.4.0 · mise à jour d'une base 5.3.1, sans perte de données, relançable.
-- Lot A du 12 novembre 2026 (« go » de Gaël, 10 h 03) :
--   1. Saison : la valeur par défaut d'une équipe ou d'un tarif suit la date (1er juillet au 30 juin), plus « 2026-2027 » écrit en dur.
--   2. N° 158 (suite) · renforts ciblés : un renfort accepté ne voit plus tous les rendez-vous de l'équipe qu'il renforce,
--      seulement ceux où le coach l'invite (« avec tous les renforts », renforts choisis, ou convoqué nommément).
--      Les annonces de l'équipe ne lui parviennent plus non plus.
--   3. N° 167 · un doublon d'exercice signalé prévient ceux qui décident (Directeur technique et président, ou l'administrateur).
--   4. N° 183 · droit à l'image : le choix d'un parent qui n'est plus relié à l'enfant ne compte plus.
--   5. N° 182 · rappel par e-mail au président, 7 jours avant la date limite de validation (envoyé par la fonction envoyer-email).
--   6. Transférer une convocation reçue à des personnes choisies du club (date, heure, lieu ; jamais le contact de l'autre club).
--   7. N° 201 · conversation avec un mineur : l'adulte ajoute un parent (choisi ou invité par e-mail) ; la conversation
--      n'est créée qu'une fois le parent inscrit et d'accord. Refus ou silence de 14 jours : annulée, le créateur est prévenu.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- ---------------------------------------------------------------------
-- 1. Saison par défaut (season_label vient de la 5.3.0)
-- ---------------------------------------------------------------------
alter table teams alter column season set default season_label(now());
alter table fee_grid alter column season set default season_label(now());

-- ---------------------------------------------------------------------
-- 2. N° 158 (suite) · renforts ciblés
-- ---------------------------------------------------------------------
-- reinforcements : 'aucun' (l'équipe seule), 'tous' (avec tous les renforts acceptés), 'choisis' (reinforcement_players)
alter table events add column if not exists reinforcements text not null default 'aucun';
alter table events add column if not exists reinforcement_players uuid[] not null default '{}';
do $$ begin
  alter table events add constraint events_reinforcements_check check (reinforcements in ('aucun','tous','choisis'));
exception when duplicate_object then null; end $$;

create or replace function events_reinforcements_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.audience <> 'team' then new.reinforcements := 'aucun'; new.reinforcement_players := '{}'; return new; end if;
  if new.reinforcements <> 'choisis' then new.reinforcement_players := '{}'; end if;
  -- seuls les renforts acceptés de l'équipe restent (un renfort retiré depuis ne bloque pas une modification)
  if tg_op = 'INSERT' or new.reinforcement_players is distinct from old.reinforcement_players then
    if exists(select 1 from unnest(new.reinforcement_players) x
              where (tg_op = 'INSERT' or not (x = any(old.reinforcement_players)))
                and not exists(select 1 from team_reinforcements r where r.player_id = x and r.team_id = any(new.team_ids) and r.state = 'accepte')) then
      raise exception 'Un renfort choisi n''est pas un renfort accepté de l''équipe';
    end if;
  end if;
  new.reinforcement_players := array(select distinct x from unnest(new.reinforcement_players) x
    where exists(select 1 from team_reinforcements r where r.player_id = x and r.team_id = any(new.team_ids) and r.state = 'accepte'));
  if new.reinforcements = 'choisis' and cardinality(new.reinforcement_players) = 0 then new.reinforcements := 'aucun'; end if;
  return new;
end $$;
drop trigger if exists events_reinforcements_guard on events;
create trigger events_reinforcements_guard before insert or update on events for each row execute function events_reinforcements_guard();

-- Comme in_team, sans le lien d'un renfort : le renfort n'est pas « dans l'équipe » pour ses rendez-vous et ses annonces
create or replace function in_team_regular(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and team_visible(t) and (
    exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active')
    or exists(select 1 from players p where p.deleted_at is null
              and (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t
                                           and not exists(select 1 from team_reinforcements r where r.player_id = p.id and r.team_id = t and r.state = 'accepte')))
              and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))));
$$;
-- Le compte (joueur ou parent) est-il invité à ce rendez-vous au titre d'un renfort ?
create or replace function reinforcement_invited(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e
    join team_reinforcements r on r.team_id = any(e.team_ids) and r.state = 'accepte'
    join players p on p.id = r.player_id and p.deleted_at is null
    where e.id = eid and e.audience = 'team'
      and (e.reinforcements = 'tous' or r.player_id = any(e.reinforcement_players) or r.player_id = any(e.convoked))
      and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid())));
$$;
revoke execute on function in_team_regular(uuid), reinforcement_invited(uuid) from public, anon;
grant execute on function in_team_regular(uuid), reinforcement_invited(uuid) to authenticated;

-- Reprise de la 3.6.0 : seule la ligne « équipe » change (in_team_regular, plus l'invitation des renforts)
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and is_member(e.club_id) and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or (e.audience = 'club' and (e.with_supporters or has_real_role(e.club_id, auth.uid())))
    or (e.audience = 'team' and exists(select 1 from unnest(e.team_ids) t where in_team_regular(t)))
    or (e.audience = 'team' and reinforcement_invited(e.id))
    or (e.audience = 'team' and e.type in ('Match','Plateau','Tournoi') and follows_any(e.team_ids))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))
    or (e.audience = 'people' and auth.uid() = any(e.people))
    or exists(select 1 from announcements a where a.kind = 'missions' and a.event_id = e.id and a.deleted_at is null and auth.uid() = any(a.people))));
$$;

-- Reprise de la 3.2 : les annonces d'une équipe ne vont pas à ses renforts
create or replace function sees_announcement(aid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from announcements a where a.id = aid and a.deleted_at is null and is_member(a.club_id) and (
    a.created_by = auth.uid()
    or a.audience = 'club'
    or (a.audience = 'team' and (exists(select 1 from unnest(a.team_ids) t where in_team_regular(t)) or is_board(a.club_id)))
    or (a.audience = 'board' and is_board(a.club_id))
    or (a.audience in ('coaches','board_coaches') and (is_coach_in(a.club_id) or is_board(a.club_id)))
    or (a.audience = 'people' and auth.uid() = any(a.people))));
$$;

-- Reprise de la 3.6.0, avec le choix des renforts
create or replace function create_events(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := (p->>'club_id')::uuid; aud text := coalesce(p->>'audience', 'club');
  ts uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'team_ids', '[]'))::uuid), '{}');
  ppl uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'people', '[]'))::uuid), '{}');
  conv uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'convoked', '[]'))::uuid), '{}');
  rf uuid[] := coalesce(array(select jsonb_array_elements_text(coalesce(p->'reinforcement_players', '[]'))::uuid), '{}');
  starts timestamptz[] := array(select jsonb_array_elements_text(coalesce(p->'starts', '[]'))::timestamptz);
  sid uuid; n int;
begin
  if auth.uid() is null or not is_member(c) then raise exception 'Connexion requise'; end if;
  if aud <> 'team' then ts := '{}'; end if;
  if aud <> 'people' then ppl := '{}'; end if;
  if not can_create_event(c, aud, ts, ppl) then raise exception 'Tu ne peux pas créer ce rendez-vous pour ces destinataires'; end if;
  if cardinality(starts) = 0 then raise exception 'Aucune date'; end if;
  if cardinality(starts) > 60 then raise exception 'Trop de séances (60 au plus)'; end if;
  if p->'series' is not null and jsonb_typeof(p->'series') = 'object' then
    insert into event_series(club_id, title, weekday, start_time, until, skip_holidays, created_by)
      values (c, p->>'title', (p->'series'->>'weekday')::int, p->'series'->>'start_time', (p->'series'->>'until')::date, coalesce((p->'series'->>'skip_holidays')::boolean, true), auth.uid())
      returning id into sid;
  end if;
  insert into events(club_id, audience, team_ids, people, type, title, starts_at, place, opponents, series_id, created_by, convoked, at_home, duration_min, all_day, with_supporters,
                     reinforcements, reinforcement_players)
    select c, aud, ts, ppl, coalesce(p->>'type', 'Événement'), trim(p->>'title'), s, coalesce(p->>'place', ''), coalesce(p->>'opponents', ''), sid, auth.uid(),
           conv, coalesce((p->>'at_home')::boolean, true),
           case when coalesce((p->>'all_day')::boolean, false) then null else nullif(p->>'duration_min', '')::int end, coalesce((p->>'all_day')::boolean, false),
           case when aud = 'club' then coalesce((p->>'with_supporters')::boolean, false) else true end,
           coalesce(nullif(p->>'reinforcements', ''), 'aucun'), rf
    from unnest(starts) s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Renforts ajoutés après la création : leurs familles sont prévenues (une fois par rendez-vous)
create or replace function push_on_event_reinforcements() returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; b text; added uuid[];
begin
  if new.cancelled or new.starts_at < now() or new.audience <> 'team' then return null; end if;
  added := array(select r.player_id from team_reinforcements r
                 where r.team_id = any(new.team_ids) and r.state = 'accepte'
                   and (new.reinforcements = 'tous' or r.player_id = any(new.reinforcement_players))
                   and not (old.audience = 'team' and (old.reinforcements = 'tous' or r.player_id = any(old.reinforcement_players) or r.player_id = any(old.convoked))));
  if cardinality(added) = 0 then return null; end if;
  b := push_ev_line(new);
  for u in select y from push_event_targets(new.id, auth.uid(), false, true) y
           where exists(select 1 from players p where p.id = any(added) and p.deleted_at is null
                        and (p.user_id = y or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = y))) loop
    perform push_enqueue(u, 'Renfort : ' || lower(new.type), b, 'ev:' || new.id, 'evreinf:' || new.id || ':' || u);
  end loop;
  return null;
end $$;
drop trigger if exists push_event_reinforcements on events;
create trigger push_event_reinforcements after update of reinforcements, reinforcement_players on events
  for each row execute function push_on_event_reinforcements();
revoke execute on function push_on_event_reinforcements(), events_reinforcements_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. N° 167 · un doublon signalé prévient ceux qui décident
-- ---------------------------------------------------------------------
create or replace function report_duplicate(p_exercise uuid, p_other uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a exercises; b exercises; did uuid; u uuid;
begin
  if auth.uid() is null then raise exception 'Connecte-toi'; end if;
  if p_exercise = p_other then raise exception 'Choisis un autre exercice'; end if;
  select * into a from exercises where id = p_exercise and deleted_at is null;
  select * into b from exercises where id = p_other and deleted_at is null;
  if a.id is null or b.id is null or not can_see_exercise(a.id) or not can_see_exercise(b.id) then raise exception 'Exercice introuvable'; end if;
  if not exists(select 1 from memberships m where m.user_id = auth.uid() and m.status = 'active' and m.role in ('coach', 'president', 'bureau')) then
    raise exception 'Seuls les coachs et le bureau signalent un doublon';
  end if;
  if exists(select 1 from exercise_duplicates d where d.status = 'signale' and least(d.exercise_id, d.other_id) = least(p_exercise, p_other) and greatest(d.exercise_id, d.other_id) = greatest(p_exercise, p_other)) then
    raise exception 'Ce doublon est déjà signalé';
  end if;
  insert into exercise_duplicates(exercise_id, other_id, reported_by) values (p_exercise, p_other, auth.uid()) returning id into did;
  perform log_action(a.club_id, null, null, 'doublon d''exercice signalé', jsonb_build_object('exercice', a.title, 'autre', b.title));
  -- 5.4.0 · n° 167 : même règle que can_decide_duplicate (administrateur pour un exercice public validé, sinon DT et président du club)
  for u in
    select x.user_id from app_admins x where a.sharing = 'public' and a.public_state = 'validated'
    union
    select m.user_id from memberships m
     where not (a.sharing = 'public' and a.public_state = 'validated') and m.club_id = a.club_id and m.status = 'active'
       and (m.role = 'president' or 'technique' = any(areas_of(a.club_id, m.user_id)))
  loop
    if u is distinct from auth.uid() then
      perform push_enqueue(u, 'Doublon d''exercice signalé', left(a.title, 60) || ' ressemble à ' || left(b.title, 60) || '. À trancher dans Exercices.', 'doublon', 'dup:' || did || ':' || u);
    end if;
  end loop;
end $$;
revoke execute on function report_duplicate(uuid, uuid) from public, anon;
grant execute on function report_duplicate(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. N° 183 · droit à l'image : seuls comptent les choix des personnes qui ont encore le droit de décider
-- ---------------------------------------------------------------------
-- Compte : un parent relié à l'enfant, le joueur lui-même (sa propre fiche) ou le bureau du club (réglage fait pour la famille).
create or replace function image_voter_valid(pl players, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = pl.user_id
      or exists(select 1 from player_parents pp where pp.player_id = pl.id and pp.user_id = u)
      or exists(select 1 from memberships m where m.club_id = pl.club_id and m.user_id = u and m.status = 'active' and m.role in ('president','bureau'));
$$;
revoke execute on function image_voter_valid(players, uuid) from public, anon, authenticated;

-- Recalcule l'accord d'une fiche à partir des choix encore valables (p_new : le choix qui vient d'être fait, ou null)
create or replace function image_recompute(p_player uuid, p_user uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare pl players; cur jsonb; votes jsonb; eff boolean; yes boolean; no boolean; was boolean; u uuid; okv jsonb;
begin
  select * into pl from players where id = p_player;
  if not found then return; end if;
  cur := coalesce(pl.consents->'image', '{}'::jsonb);
  votes := coalesce(cur->'votes', '{}'::jsonb);
  if p_user is not null then votes := votes || jsonb_build_object(p_user::text, jsonb_build_object('ok', p_ok, 'at', now())); end if;
  -- les choix des personnes qui n'ont plus le droit de décider sont retirés (parent qui a quitté la famille, n° 183)
  select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb) into okv from jsonb_each(votes) v
    where v.key ~ '^[0-9a-f-]{36}$' and image_voter_valid(pl, v.key::uuid);
  yes := exists(select 1 from jsonb_each(okv) v where (v.value->>'ok')::boolean);
  no := exists(select 1 from jsonb_each(okv) v where not (v.value->>'ok')::boolean);
  eff := yes and not no;
  was := coalesce((cur->>'conflict')::boolean, false);
  if p_user is null and okv = votes then return; end if;   -- rien n'a changé
  perform set_config('pc.consent_rpc', 'on', true);
  update players set consents = consents || jsonb_build_object('image',
    jsonb_build_object('ok', eff, 'at', now(), 'by', coalesce(p_user, (cur->>'by')::uuid), 'votes', okv, 'conflict', yes and no)) where id = p_player;
  perform set_config('pc.consent_rpc', '', true);
  -- le président est prévenu d'un désaccord, sans motif ni échange
  if yes and no and not was then
    perform log_action(pl.club_id, null, p_player, 'désaccord sur le droit à l''image', '{}'::jsonb);
    for u in select m.user_id from memberships m where m.club_id = pl.club_id and m.role = 'president' and m.status = 'active' loop
      perform push_enqueue(u, 'Droit à l''image : désaccord', 'Les parents de ' || pl.first_name || ' ne sont pas d''accord. Le refus s''applique.',
        'imgdis', 'imgdis:' || p_player || ':' || floor(extract(epoch from now()))::text);
    end loop;
  end if;
end $$;
revoke execute on function image_recompute(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function apply_image_vote(p_player uuid, p_user uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform image_recompute(p_player, p_user, p_ok);
end $$;
revoke execute on function apply_image_vote(uuid, uuid, boolean) from public, anon, authenticated;

-- Un parent qui n'est plus relié à l'enfant : son choix ne compte plus
create or replace function player_parents_image_recompute() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform image_recompute(old.player_id, null, null);
  return null;
end $$;
drop trigger if exists player_parents_image_recompute on player_parents;
create trigger player_parents_image_recompute after delete on player_parents for each row execute function player_parents_image_recompute();
revoke execute on function player_parents_image_recompute() from public, anon, authenticated;

-- Reprise une seule fois : les fiches où un ancien parent avait voté
do $$ declare r record; begin
  for r in select p.id from players p where p.consents ? 'image' and jsonb_typeof(p.consents->'image'->'votes') = 'object' loop
    perform image_recompute(r.id, null, null);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. N° 182 · rappel par e-mail au président (7 jours avant la date limite)
-- ---------------------------------------------------------------------
-- Pas de tâche planifiée : à chaque ouverture de l'application par n'importe qui, l'écran demande s'il y a des rappels
-- à envoyer (oui / non, rien d'autre) ; si oui, il appelle envoyer-email, qui lit les adresses avec la clé du serveur.
alter table clubs add column if not exists valid_mailed_at timestamptz;
-- Le président qui change reçoit un nouveau rappel
create or replace function clubs_valid_mail_reset() returns trigger language plpgsql as $$
begin
  if new.valid_by is distinct from old.valid_by and new.valid_by > coalesce(old.valid_by, '-infinity'::timestamptz) then new.valid_mailed_at := null; end if;
  return new;
end $$;
drop trigger if exists clubs_valid_mail_reset on clubs;
create trigger clubs_valid_mail_reset before update of valid_by on clubs for each row execute function clubs_valid_mail_reset();

create or replace function validation_reminders_due() returns table(club_id uuid) language sql stable security definer set search_path = public as $$
  select c.id from clubs c
  where c.deleted_at is null and c.valid_mailed_at is null and c.valid_by between now() and now() + interval '7 days'
    and exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active')
    and not exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active' and president_validated(c.id, m.user_id));
$$;
revoke execute on function validation_reminders_due() from public, anon, authenticated;
-- Pour l'écran : oui ou non, sans aucune autre information
create or replace function validation_reminders_pending() returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(select 1 from validation_reminders_due());
$$;
revoke execute on function validation_reminders_pending() from public, anon;
grant execute on function validation_reminders_pending() to authenticated;
-- Pour la fonction envoyer-email seulement (clé du serveur) : chaque rappel n'est remis qu'une fois
create or replace function validation_reminders_take() returns table(club text, valid_by timestamptz, email text, first_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    with due as (
      update clubs c set valid_mailed_at = now() where c.id in (select d.club_id from validation_reminders_due() d)
      returning c.id, c.name, c.valid_by)
    select due.name, due.valid_by, lower(u.email)::text, coalesce(pr.first_name, '')::text
    from due join memberships m on m.club_id = due.id and m.role = 'president' and m.status = 'active'
    join auth.users u on u.id = m.user_id left join profiles pr on pr.id = m.user_id
    where u.email is not null;
end $$;
revoke execute on function validation_reminders_take() from public, anon, authenticated;
do $$ begin grant execute on function validation_reminders_take() to service_role; exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------
-- 6. Transférer une convocation reçue à des personnes choisies du club
-- ---------------------------------------------------------------------
-- Ceux qui reçoivent le document (contact rencontres, président, contact de l'équipe concernée) le font suivre
-- dans le club : une annonce privée avec les matchs (titre, jour, heure, lieu). Le nom et les coordonnées du contact
-- de l'autre club n'y sont pas : ils restent dans le document, que lisent le coach et le bureau.
create or replace function forward_convocation(p_send uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare s convocation_sends; full_access boolean; lines text; who text; frm text; ppl uuid[];
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.channel <> 'app' or s.target_club_id is null then raise exception 'Document introuvable'; end if;
  full_access := receives_convocations(s.target_club_id);
  if not full_access and not contact_gets_send(p_send) then raise exception 'Document introuvable'; end if;
  ppl := array(select distinct u from unnest(coalesce(p_users, '{}')) u where u is distinct from auth.uid());
  if cardinality(ppl) = 0 then raise exception 'Choisis au moins une personne'; end if;
  if cardinality(ppl) > 100 then raise exception 'Cent personnes au plus'; end if;
  if exists(select 1 from unnest(ppl) u where not exists(select 1 from memberships m where m.club_id = s.target_club_id and m.user_id = u and m.status = 'active')) then
    raise exception 'Une personne choisie n''est pas membre du club';
  end if;
  select string_agg('• ' || coalesce(nullif(x->>'title', ''), 'Match')
           || coalesce(' (' || nullif(x->'team'->>'name', '') || ')', '')
           || ' · ' || push_when((x->>'starts_at')::timestamptz)
           || coalesce(' · ' || nullif(x->>'place', ''), ''), E'\n' order by (x->>'starts_at'))
    into lines
    from jsonb_array_elements(convocation_events_of(s.payload)) x
    where coalesce((x->>'cancelled')::boolean, false) = false and x->>'starts_at' is not null
      and (full_access or contact_matches_event(s.target_club_id, x));
  if lines is null then raise exception 'Aucun match à transmettre'; end if;
  select coalesce(first_name, 'Un membre du club') into who from profiles where id = auth.uid();
  select name into frm from clubs where id = s.club_id;
  perform set_config('pc.announce', 'on', true);
  insert into announcements(club_id, audience, people, kind, title, body)
    values (s.target_club_id, 'people', ppl, 'annonce',
            left((case when s.step = 'P' then 'Pré-convocation' else 'Convocation' end) || ' de ' || coalesce(frm, 'un autre club'), 120),
            left(lines || E'\n\nTransmis par ' || coalesce(who, 'un membre du club') || '.', 3000));
  perform set_config('pc.announce', '', true);
  perform log_action(s.target_club_id, null, null, 'convocation transférée', jsonb_build_object('ref', s.ref, 'personnes', cardinality(ppl)));
  return cardinality(ppl);
end $$;
revoke execute on function forward_convocation(uuid, uuid[]) from public, anon;
grant execute on function forward_convocation(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 7. N° 201 · conversation avec un mineur : demande au parent
-- ---------------------------------------------------------------------
alter table parent_invitations add column if not exists purpose text not null default 'joueur';
alter table parent_invitations add column if not exists requested_by_name text;

create table if not exists group_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  player_id uuid not null references players(id) on delete cascade,      -- la fiche du mineur
  minor_user uuid not null references auth.users(id) on delete cascade,  -- son compte
  members uuid[] not null default '{}',                                   -- les autres adultes invités
  parent_user uuid references auth.users(id) on delete set null,          -- le parent choisi (sinon : tout parent relié)
  invitation_id uuid references parent_invitations(id) on delete set null,
  state text not null default 'attente' check (state in ('attente','acceptee','refusee','annulee','expiree')),
  group_id uuid references groups(id) on delete set null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references auth.users(id) on delete set null,
  last_reminded_at timestamptz
);
create index if not exists group_requests_player on group_requests(player_id) where state = 'attente';
alter table group_requests enable row level security;   -- aucune lecture directe : tout passe par les fonctions

-- Le parent qui peut répondre : relié à l'enfant, membre actif du club, et le parent choisi s'il y en a un
create or replace function group_request_answerer(r group_requests, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select (r.parent_user is null or r.parent_user = u)
     and exists(select 1 from player_parents pp where pp.player_id = r.player_id and pp.user_id = u)
     and exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = u and m.status = 'active');
$$;
revoke execute on function group_request_answerer(group_requests, uuid) from public, anon, authenticated;

-- Le prénom d'un compte, pour les notifications
create or replace function first_name_of(u uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif((select first_name from profiles where id = u), ''), 'Un membre du club');
$$;
revoke execute on function first_name_of(uuid) from public, anon, authenticated;

-- Pour l'écran, avant de créer un groupe : les mineurs choisis qui n'ont aucun parent dans la liste, et leurs parents inscrits
create or replace function group_minor_check(p_club uuid, p_users uuid[]) returns table(user_id uuid, player_id uuid, first_name text, parents jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member(p_club) then raise exception 'Connexion requise'; end if;
  if minor_account(p_club, auth.uid()) then return; end if;   -- un mineur qui écrit : la base vérifie seule (deux mineurs : libre)
  if supporter_only(p_club, auth.uid()) then return; end if;  -- un supporteur n'écrit jamais à un mineur : il n'apprend rien
  if cardinality(coalesce(p_users, '{}')) > 200 then raise exception 'Deux cents personnes au plus'; end if;
  return query
    select p.user_id, p.id, p.first_name,
           coalesce((select jsonb_agg(jsonb_build_object('user_id', pp.user_id, 'name', coalesce(pr.full_name, pr.first_name, 'Parent')) order by pr.first_name)
                     from player_parents pp left join profiles pr on pr.id = pp.user_id
                     where pp.player_id = p.id and exists(select 1 from memberships m where m.club_id = p_club and m.user_id = pp.user_id and m.status = 'active')), '[]'::jsonb)
    from players p
    where p.club_id = p_club and p.deleted_at is null and p.user_id = any(coalesce(p_users, '{}'))
      and exists(select 1 from memberships m where m.club_id = p_club and m.user_id = p.user_id and m.status = 'active')
      and minor_account(p_club, p.user_id)
      and not exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = any(coalesce(p_users, '{}') || auth.uid()));
end $$;
revoke execute on function group_minor_check(uuid, uuid[]) from public, anon;
grant execute on function group_minor_check(uuid, uuid[]) to authenticated;

-- Créer la demande : un parent choisi (relié et inscrit) ou l'e-mail d'un parent à inviter
create or replace function request_minor_group(p_club uuid, p_name text, p_player uuid, p_parent uuid, p_email text, p_members uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl players; nm text := trim(coalesce(p_name, '')); em text := lower(trim(coalesce(p_email, ''))); own text; k int; rid uuid; iid uuid;
  mem uuid[]; me text;
begin
  if auth.uid() is null or not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = auth.uid() and m.status = 'active') then
    raise exception 'Connexion requise';
  end if;
  if minor_account(p_club, auth.uid()) then raise exception 'Cette demande est faite par un adulte'; end if;
  if supporter_only(p_club, auth.uid()) then raise exception 'Un supporteur ne peut pas échanger avec un mineur'; end if;
  if length(nm) not between 1 and 80 then raise exception 'Donne un nom au groupe'; end if;
  select * into pl from players where id = p_player and club_id = p_club and deleted_at is null;
  if pl.id is null or pl.user_id is null or not minor_account(p_club, pl.user_id)
     or not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = pl.user_id and m.status = 'active') then
    raise exception 'Ce joueur mineur n''a pas de compte dans le club';
  end if;
  mem := array(select distinct u from unnest(coalesce(p_members, '{}')) u where u is distinct from auth.uid() and u is distinct from pl.user_id and u is distinct from p_parent);
  if cardinality(mem) > 50 then raise exception 'Cinquante personnes au plus'; end if;
  if exists(select 1 from unnest(mem) u where not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = u and m.status = 'active')) then
    raise exception 'Une personne choisie n''est pas membre du club';
  end if;
  if exists(select 1 from unnest(mem) u where minor_account(p_club, u)) then raise exception 'Une demande concerne un seul mineur'; end if;
  if exists(select 1 from unnest(mem) u where supporter_only(p_club, u)) then raise exception 'Un supporteur ne peut pas être dans un groupe avec un mineur.'; end if;
  if exists(select 1 from group_requests r where r.created_by = auth.uid() and r.player_id = pl.id and r.state = 'attente') then
    raise exception 'Une demande pour ce joueur attend déjà la réponse du parent';
  end if;
  select count(*) into k from group_requests r where r.created_by = auth.uid() and r.state = 'attente';
  if k >= 10 then raise exception 'Dix demandes en attente au plus'; end if;
  if p_parent is not null then
    if not exists(select 1 from player_parents pp where pp.player_id = pl.id and pp.user_id = p_parent)
       or not exists(select 1 from memberships m where m.club_id = p_club and m.user_id = p_parent and m.status = 'active') then
      raise exception 'Ce parent n''est pas relié à ce joueur dans le club';
    end if;
  else
    if em !~ '^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$' then raise exception 'Adresse e-mail non valide'; end if;
    select lower(email) into own from auth.users where id = auth.uid();
    if own = em then raise exception 'Indique l''e-mail d''un parent, pas le tien'; end if;
    if exists(select 1 from auth.users u where lower(u.email) = em and u.id = pl.user_id) then raise exception 'Indique l''e-mail d''un parent, pas celui du joueur'; end if;
    select count(*) into k from parent_invitations where player_id = pl.id and created_at > now() - interval '24 hours';
    if k >= 3 then raise exception 'Trois invitations par jour au maximum pour ce joueur : réessaie demain'; end if;
    me := first_name_of(auth.uid());
    insert into parent_invitations(club_id, player_id, email, token, created_by, purpose, requested_by_name)
      values (p_club, pl.id, em, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), auth.uid(), 'conversation', me)
      returning id into iid;
  end if;
  insert into group_requests(club_id, created_by, name, player_id, minor_user, members, parent_user, invitation_id)
    values (p_club, auth.uid(), nm, pl.id, pl.user_id, mem, p_parent, iid) returning id into rid;
  if p_parent is not null then
    perform push_enqueue(p_parent, 'Conversation avec ' || pl.first_name, first_name_of(auth.uid()) || ' souhaite échanger avec ' || pl.first_name
      || ' dans « ' || left(nm, 40) || ' ». Ton accord est demandé (onglet Messages).', 'grpreq', 'grpreq:' || rid);
  end if;
  perform log_action(p_club, p_parent, pl.id, 'conversation avec un mineur demandée', jsonb_build_object('groupe', nm, 'invitation', iid is not null));
  return jsonb_build_object('id', rid, 'invitation_id', iid);
end $$;
revoke execute on function request_minor_group(uuid, text, uuid, uuid, text, uuid[]) from public, anon;
grant execute on function request_minor_group(uuid, text, uuid, uuid, text, uuid[]) to authenticated;

-- Demandes sans réponse depuis 14 jours (durée du lien d'invitation) : annulées, le créateur est prévenu.
-- Les demandes finies sont effacées 30 jours après (comme l'adresse d'un parent invité).
create or replace function group_requests_tidy() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in update group_requests g set state = 'expiree', answered_at = now()
           where g.state = 'attente' and g.created_at < now() - interval '14 days'
           returning g.id, g.created_by, (select first_name from players where id = g.player_id) as child loop
    perform push_enqueue(r.created_by, 'Conversation annulée', 'Le parent de ' || coalesce(r.child, 'ce joueur') || ' n''a pas répondu sous 14 jours.', 'grpreq', 'grpexp:' || r.id);
  end loop;
  delete from group_requests where state <> 'attente' and coalesce(answered_at, created_at) < now() - interval '30 days';
end $$;
revoke execute on function group_requests_tidy() from public, anon, authenticated;

-- Ce que je vois : mes demandes (envoyées) et celles qui attendent ma réponse de parent
create or replace function my_group_requests(p_club uuid) returns table(id uuid, mine boolean, to_answer boolean, name text, child_first text, creator text,
  members text[], state text, created_at timestamptz, parent_label text, waiting_signup boolean, group_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member(p_club) then return; end if;
  perform group_requests_tidy();
  return query
    select r.id, r.created_by = auth.uid(), r.state = 'attente' and group_request_answerer(r, auth.uid()), r.name, pl.first_name, first_name_of(r.created_by),
           array(select coalesce(pr.full_name, pr.first_name, '') from unnest(r.members) u left join profiles pr on pr.id = u),
           r.state, r.created_at,
           case when r.parent_user is not null then (select coalesce(pr.full_name, pr.first_name) from profiles pr where pr.id = r.parent_user)
                when r.invitation_id is not null then 'parent invité par e-mail' end,
           r.state = 'attente' and not exists(select 1 from player_parents pp join memberships m on m.user_id = pp.user_id and m.club_id = r.club_id and m.status = 'active'
                                               where pp.player_id = r.player_id and (r.parent_user is null or pp.user_id = r.parent_user)),
           r.group_id
    from group_requests r join players pl on pl.id = r.player_id
    where r.club_id = p_club and (r.created_by = auth.uid() or (r.state = 'attente' and group_request_answerer(r, auth.uid())))
    order by r.created_at desc;
end $$;
revoke execute on function my_group_requests(uuid) from public, anon;
grant execute on function my_group_requests(uuid) to authenticated;

-- Le parent répond. Oui : le groupe est créé avec le créateur, le parent, le mineur et les autres adultes.
create or replace function answer_group_request(p_id uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare r group_requests; gid uuid; child text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  perform group_requests_tidy();
  select * into r from group_requests where id = p_id for update;
  if r.id is null or r.state <> 'attente' then raise exception 'Cette demande n''attend plus de réponse'; end if;
  if not group_request_answerer(r, auth.uid()) then raise exception 'Seul un parent du joueur répond à cette demande'; end if;
  select first_name into child from players where id = r.player_id;
  if not coalesce(p_accept, false) then
    update group_requests set state = 'refusee', answered_at = now(), answered_by = auth.uid() where id = r.id;
    perform push_enqueue(r.created_by, 'Conversation annulée', 'Le parent de ' || coalesce(child, 'ce joueur') || ' a refusé la conversation « ' || left(r.name, 40) || ' ».', 'grpreq', 'grpno:' || r.id);
    perform log_action(r.club_id, r.created_by, r.player_id, 'conversation avec un mineur refusée par le parent', jsonb_build_object('groupe', r.name));
    return null;
  end if;
  if not exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = r.created_by and m.status = 'active') then
    update group_requests set state = 'annulee', answered_at = now(), answered_by = auth.uid() where id = r.id;
    raise exception 'La personne qui a fait la demande n''est plus dans le club';
  end if;
  insert into groups(club_id, name, created_by) values (r.club_id, r.name, r.created_by) returning id into gid;
  -- une seule requête : les règles du n° 186 sont vérifiées une fois tout le monde ajouté (parent compris)
  insert into group_members(group_id, user_id)
    select gid, u from (select distinct u from unnest(array[r.created_by, auth.uid(), r.minor_user] || array(
        select x from unnest(r.members) x where exists(select 1 from memberships m where m.club_id = r.club_id and m.user_id = x and m.status = 'active'))) u) z;
  update group_requests set state = 'acceptee', answered_at = now(), answered_by = auth.uid(), group_id = gid where id = r.id;
  perform push_enqueue(r.created_by, 'Conversation ouverte', 'Le parent de ' || coalesce(child, 'ce joueur') || ' a accepté : « ' || left(r.name, 40) || ' » est ouverte.', 'grpreq', 'grpyes:' || r.id);
  perform log_action(r.club_id, r.created_by, r.player_id, 'conversation avec un mineur acceptée par le parent', jsonb_build_object('groupe', r.name));
  return gid;
end $$;
revoke execute on function answer_group_request(uuid, boolean) from public, anon;
grant execute on function answer_group_request(uuid, boolean) to authenticated;

create or replace function cancel_group_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update group_requests set state = 'annulee', answered_at = now(), answered_by = auth.uid() where id = p_id and created_by = auth.uid() and state = 'attente';
  if not found then raise exception 'Cette demande n''attend plus de réponse'; end if;
end $$;
revoke execute on function cancel_group_request(uuid) from public, anon;
grant execute on function cancel_group_request(uuid) to authenticated;

-- Relance : notification au parent relié (au plus toutes les 12 heures)
create or replace function remind_group_request(p_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r group_requests; child text; u uuid; n int := 0;
begin
  select * into r from group_requests where id = p_id and created_by = auth.uid();
  if r.id is null or r.state <> 'attente' then raise exception 'Cette demande n''attend plus de réponse'; end if;
  if r.last_reminded_at > now() - interval '12 hours' then raise exception 'Relance déjà faite : réessaie dans quelques heures'; end if;
  select first_name into child from players where id = r.player_id;
  for u in select pp.user_id from player_parents pp where pp.player_id = r.player_id and group_request_answerer(r, pp.user_id) loop
    perform push_enqueue(u, 'Conversation avec ' || coalesce(child, 'ton enfant'), first_name_of(r.created_by) || ' attend ta réponse pour « ' || left(r.name, 40) || ' » (onglet Messages).',
      'grpreq', 'grprem:' || r.id || ':' || floor(extract(epoch from now()))::text);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Le parent n''est pas encore inscrit dans le club : il a reçu l''invitation par e-mail'; end if;
  update group_requests set last_reminded_at = now() where id = r.id;
  return n;
end $$;
revoke execute on function remind_group_request(uuid) from public, anon;
grant execute on function remind_group_request(uuid) to authenticated;

-- Un parent relié à l'enfant après coup (invitation acceptée, validée par le président) : il est prévenu des demandes en attente
create or replace function player_parents_group_requests() returns trigger language plpgsql security definer set search_path = public as $$
declare r group_requests;
begin
  for r in select * from group_requests g where g.player_id = new.player_id and g.state = 'attente' and (g.parent_user is null or g.parent_user = new.user_id) loop
    perform push_enqueue(new.user_id, 'Conversation avec ' || coalesce((select first_name from players where id = r.player_id), 'ton enfant'),
      first_name_of(r.created_by) || ' souhaite échanger avec ton enfant dans « ' || left(r.name, 40) || ' ». Ton accord est demandé (onglet Messages).', 'grpreq', 'grpreq:' || r.id || ':' || new.user_id);
  end loop;
  return null;
end $$;
drop trigger if exists player_parents_group_requests on player_parents;
create trigger player_parents_group_requests after insert on player_parents for each row execute function player_parents_group_requests();
revoke execute on function player_parents_group_requests() from public, anon, authenticated;

-- L'invitation par e-mail (5.3.0) sait maintenant dire pourquoi : joueur de 15 à 17 ans, ou conversation demandée par un adulte du club
create or replace function parent_invitation_take(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i parent_invitations; r jsonb;
begin
  select * into i from parent_invitations where id = p_id and created_by = auth.uid() and sent_at is null and used_at is null and expires_at > now();
  if i.id is null then return null; end if;
  update parent_invitations set sent_at = now() where id = i.id;
  select jsonb_build_object('email', i.email, 'token', i.token, 'expires_at', i.expires_at,
           'child_first', pl.first_name, 'club', c.name, 'purpose', i.purpose, 'requested_by', i.requested_by_name) into r
    from players pl join clubs c on c.id = pl.club_id where pl.id = i.player_id;
  return r;
end $$;
revoke execute on function parent_invitation_take(uuid) from public, anon;
grant execute on function parent_invitation_take(uuid) to authenticated;

select close_visitor_functions();

select 'mypocketclub alpha 5.4.0 installée' as resultat;
