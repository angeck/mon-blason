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

select close_visitor_functions();
