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
