-- mypocketclub · bêta 1.7.1 · script idempotent (se relance sans risque)
-- n° 78 suites (Gaël, 23 novembre : « tout le groupe d'équipe ») : le groupe d'une équipe en entente réunit les deux clubs
--   (messages et sondages) ; les coordonnées des joueurs de l'autre club vont au coach et au contact d'équipe (déjà permis
--   par la base depuis la 1.6.0 : l'écran les charge maintenant).
-- n° 293 : joueur « prêté à » un autre club (il joue ailleurs, sa licence reste chez nous : nous payons) ou « en prêt de »
--   un autre club (il joue chez nous, licence ailleurs : nous ne payons pas). Pour la saison. Un avis à l'autre club :
--   notification s'il est sur mpc, sinon un e-mail (règles du n° 96 : adresse publiée, lien de refus définitif, un seul
--   e-mail par club et par joueur).
-- Une règle de lecture/écriture des groupes est remplacée (« drop policy » puis « create policy ») : Supabase demande de confirmer.

-- ---------------------------------------------------------------------
-- N° 78 · groupe d'équipe commun aux deux clubs d'une entente
-- ---------------------------------------------------------------------
-- La personne fait-elle partie de l'équipe en entente du côté du club partenaire ? (coach, joueur, parent ; pas le bureau)
create or replace function entente_team_person(t uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select entente_club(t) is not null and (
    exists(select 1 from memberships m where m.club_id = entente_club(t) and m.user_id = u and m.status = 'active' and m.team_id = t and m.role in ('coach','joueur','parent'))
    or exists(select 1 from players p where p.club_id = entente_club(t) and p.deleted_at is null and p.team_id = t and p.user_id = u)
    or exists(select 1 from player_parents pp join players p on p.id = pp.player_id where pp.user_id = u and p.club_id = entente_club(t) and p.deleted_at is null and p.team_id = t));
$$;
revoke execute on function entente_team_person(uuid, uuid) from public, anon;
grant execute on function entente_team_person(uuid, uuid) to authenticated;

-- Créer le groupe : un coach du club partenaire le peut aussi (le groupe est rangé au club qui porte l'équipe)
drop policy if exists "tout membre actif crée un groupe" on groups;
create policy "tout membre actif crée un groupe" on groups for insert with check (
  created_by = auth.uid() and (is_member(club_id) or (team_id is not null and entente_team_person(team_id, auth.uid()) and coaches_team(team_id))));

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
            or exists(select 1 from team_contacts c where c.team_id = new.team_id and c.user_id = new.created_by)
            -- n° 78 : le coach de l'équipe venu du club partenaire
            or exists(select 1 from memberships m where m.club_id = entente_club(new.team_id) and m.user_id = new.created_by and m.status = 'active'
                      and m.role = 'coach' and m.team_id = new.team_id)) then
      raise exception 'Seuls le bureau, les coachs et le contact de l''équipe créent un groupe d''équipe';
    end if;
  end if;
  return new;
end $$;

-- Inviter : dans un groupe d'équipe en entente, les personnes de l'équipe du club partenaire aussi
drop policy if exists "le créateur invite des membres du club" on group_members;
create policy "le créateur invite des membres du club" on group_members for insert with check (
  exists(select 1 from groups g where g.id = group_id and g.created_by = auth.uid())
  and exists(select 1 from groups g where g.id = group_id and (
    (active_in_club(g.club_id, group_members.user_id) and (g.team_id is not null or can_contact(g.club_id, group_members.user_id)))
    or (g.team_id is not null and entente_team_person(g.team_id, group_members.user_id)))));

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
    if exists(select 1 from group_members gm where gm.group_id = gid and not user_in_team(g.club_id, g.team_id, gm.user_id)
              and not entente_team_person(g.team_id, gm.user_id)) then -- n° 78 : l'équipe du club partenaire compte
      return 'Un groupe d''équipe ne réunit que les personnes de cette équipe, du bureau et de ses coachs.';
    end if;
    return null;
  end if;
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

-- Après un ajout dans un groupe d'équipe : les parents d'un joueur mineur y entrent d'office (des deux clubs de l'entente)
create or replace function group_members_minor_check() returns trigger language plpgsql security definer set search_path = public as $$
declare g groups; msg text;
begin
  select * into g from groups where id = new.group_id;
  if not found then return null; end if;
  if g.team_id is not null then
    insert into group_members(group_id, user_id)
      select new.group_id, pp.user_id from players p join player_parents pp on pp.player_id = p.id
      where p.user_id = new.user_id and p.deleted_at is null
        and ((p.club_id = g.club_id and minor_account(g.club_id, new.user_id)
              and exists(select 1 from memberships m where m.club_id = g.club_id and m.user_id = pp.user_id and m.status = 'active'))
          or (p.club_id = entente_club(g.team_id) and p.team_id = g.team_id and not account_is_adult(p.club_id, new.user_id)))
      on conflict do nothing;
  end if;
  msg := group_minor_problem(new.group_id);
  if msg is not null then raise exception '%', msg; end if;
  return null;
end $$;

-- Remplir le groupe d'une équipe en entente avec toutes les personnes de l'équipe des deux clubs (appelé à la création)
create or replace function entente_group_fill(p_group uuid) returns int
language plpgsql security definer set search_path = public as $$
declare g groups; n int;
begin
  select * into g from groups where id = p_group;
  if g.id is null or g.created_by is distinct from auth.uid() or g.team_id is null then raise exception 'Groupe introuvable'; end if;
  if entente_club(g.team_id) is null then return 0; end if;
  insert into group_members(group_id, user_id)
    select distinct p_group, x.u from (
      select m.user_id u from memberships m where m.status = 'active' and m.team_id = g.team_id and m.role in ('coach','joueur','parent')
        and m.club_id in (g.club_id, entente_club(g.team_id))
      union select p.user_id from players p where p.deleted_at is null and p.team_id = g.team_id and p.user_id is not null
        and p.club_id in (g.club_id, entente_club(g.team_id))
      union select pp.user_id from player_parents pp join players p on p.id = pp.player_id where p.deleted_at is null and p.team_id = g.team_id
        and p.club_id in (g.club_id, entente_club(g.team_id))) x
    where x.u is not null
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function entente_group_fill(uuid) from public, anon;
grant execute on function entente_group_fill(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- N° 293 · joueur prêté / en prêt (pour la saison)
-- « sortant » = prêté à un autre club : il y joue, sa licence reste chez nous, notre club paye.
-- « entrant » = en prêt d'un autre club : il joue chez nous, sa licence est ailleurs, notre club ne paye pas.
-- ---------------------------------------------------------------------
create table if not exists player_loans (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  direction text not null check (direction in ('sortant','entrant')),
  other_club_id uuid references clubs(id) on delete set null,
  other_name text not null default '' check (length(other_name) <= 120),
  other_city text not null default '' check (length(other_city) <= 80),
  season text not null default season_label(now()),
  notice text not null default 'aucun' check (notice in ('aucun','mpc','email')),
  created_by uuid,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists player_loans_player on player_loans(player_id) where ended_at is null;
create index if not exists player_loans_club on player_loans(club_id, season);
alter table player_loans enable row level security;
revoke all on player_loans from anon, authenticated;
alter table club_requests add column if not exists loan_id uuid;

-- Prêt en cours (saison en cours, pas terminé)
create or replace function loan_active(l player_loans) returns boolean language sql stable as $$
  select l.ended_at is null and l.season = season_label(now());
$$;
-- Un joueur en prêt d'un autre club ne compte pas dans la facture de notre club
create or replace function player_loaned_in(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from player_loans l where l.player_id = p and l.direction = 'entrant' and loan_active(l));
$$;
revoke execute on function player_loaned_in(uuid) from public, anon, authenticated;
-- Même droits que la fiche du joueur (bureau, coach de son équipe)
create or replace function can_loan_player(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from players x where x.id = p and x.deleted_at is null
    and (is_board(x.club_id) or coaches_team(x.team_id) or exists(select 1 from player_teams pt where pt.player_id = x.id and coaches_team(pt.team_id))));
$$;
revoke execute on function can_loan_player(uuid) from public, anon;

create or replace function set_player_loan(p_player uuid, p_dir text, p_club uuid, p_name text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare x players; lid uuid; oname text; ocity text; u uuid; mine text; short text; ntc text := 'aucun'; me profiles;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into x from players where id = p_player and deleted_at is null;
  if x.id is null or not can_loan_player(p_player) then raise exception 'Réservé au bureau et au coach de l''équipe du joueur'; end if;
  if p_dir not in ('sortant','entrant') then raise exception 'Sens du prêt inconnu'; end if;
  if p_club = x.club_id then raise exception 'Choisis un autre club que le tien'; end if;
  if p_club is not null then
    select name, city into oname, ocity from clubs where id = p_club and deleted_at is null;
    if oname is null then raise exception 'Club introuvable'; end if;
  else
    oname := left(trim(coalesce(p_name, '')), 120); ocity := left(trim(coalesce(p_city, '')), 80);
    if length(oname) < 2 or ocity = '' then raise exception 'Nom et ville de l''autre club obligatoires'; end if;
  end if;
  update player_loans set ended_at = now() where player_id = p_player and ended_at is null;
  select name into mine from clubs where id = x.club_id;
  short := x.first_name || case when coalesce(x.last_name, '') <> '' then ' ' || left(x.last_name, 1) || '.' else '' end;
  if p_club is not null then
    ntc := 'mpc';
  elsif not exists(select 1 from player_loans l join club_requests r on r.loan_id = l.id
                   where l.player_id = p_player and norm_name(l.other_name) = norm_name(oname) and norm_name(l.other_city) = norm_name(ocity)) then
    ntc := 'email';   -- un seul e-mail par club et par joueur
  end if;
  insert into player_loans(club_id, player_id, direction, other_club_id, other_name, other_city, notice, created_by)
    values (x.club_id, p_player, p_dir, p_club, oname, ocity, ntc, auth.uid()) returning id into lid;
  perform log_action(x.club_id, null, null, case p_dir when 'sortant' then 'Joueur prêté' else 'Joueur en prêt' end,
    jsonb_build_object('joueur', short, 'club', oname, 'saison', season_label(now())));
  if ntc = 'mpc' then
    -- l'autre club est sur mypocketclub : son président est prévenu (prénom et initiale seulement)
    for u in select m.user_id from memberships m where m.club_id = p_club and m.role = 'president' and m.status = 'active' loop
      perform push_enqueue(u, case p_dir when 'sortant' then 'Joueur prêté à votre club' else 'Joueur en prêt chez ' || left(mine, 40) end,
        short || ' · ' || mine || ' · saison ' || season_label(now()), 'pret:' || p_club, 'pret:' || lid);
    end loop;
  elsif ntc = 'email' then
    -- l'autre club n'est pas sur mypocketclub : demande de prise de contact, traitée selon les règles du n° 96
    -- (adresse publiée par le club, lien de refus définitif, un envoi et une relance au plus)
    select * into me from profiles where id = auth.uid();
    insert into club_requests(first_name, last_name, email, club_name, city, sport, age_ok, consent, user_id, ip_hash, loan_id)
      values (left(coalesce(me.first_name, ''), 60), left(coalesce(me.last_name, ''), 60), '', oname, ocity,
              coalesce((select sport from clubs where id = x.club_id), ''), true, true, auth.uid(), '', lid);
    for u in select user_id from app_admins loop
      perform push_enqueue(u, 'Prise de contact (prêt) : ' || left(oname, 50),
        oname || ' (' || ocity || ') · ' || case p_dir when 'sortant' then 'joueur prêté par ' else 'joueur en prêt chez ' end || mine || '. À toi de contacter le club.',
        'clubreq', 'clubreq:' || lid::text, './');
    end loop;
  end if;
  return lid;
end $$;
revoke execute on function set_player_loan(uuid, text, uuid, text, text) from public, anon;
grant execute on function set_player_loan(uuid, text, uuid, text, text) to authenticated;

create or replace function end_player_loan(p_player uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_loan_player(p_player) then raise exception 'Réservé au bureau et au coach de l''équipe du joueur'; end if;
  update player_loans set ended_at = now() where player_id = p_player and ended_at is null;
end $$;
revoke execute on function end_player_loan(uuid) from public, anon;
grant execute on function end_player_loan(uuid) to authenticated;

-- Prêts en cours du club (lus par ceux qui voient les fiches)
create or replace function club_loans(p_club uuid) returns table(player_id uuid, direction text, other_club_id uuid, other_name text, season text, notice text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.player_id, l.direction, l.other_club_id, l.other_name, l.season, l.notice, l.created_at
  from player_loans l where l.club_id = p_club and loan_active(l) and can_loan_player(l.player_id);
$$;
revoke execute on function club_loans(uuid) from public, anon;
grant execute on function club_loans(uuid) to authenticated;

-- Facture : un joueur en prêt d'un autre club ne compte pas (la licence décide)
create or replace function paying_players(p_club uuid, p_free int) returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, (select count(*) from players where club_id = p_club and deleted_at is null and not player_loaned_in(id))::int
    - coalesce((select sum(c) from (select count(*) c from players x where x.club_id = p_club and x.deleted_at is null and x.team_id is not null and not player_loaned_in(x.id)
        group by x.team_id order by c desc limit greatest(coalesce(p_free, 1), 0)) f), 0)::int);
$$;
revoke execute on function paying_players(uuid, int) from public, anon, authenticated;

create or replace function club_client_view(p_club uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sub club_subscription; lic int; paying int; due int;
begin
  if not is_president(p_club) then raise exception 'Réservé au président du club'; end if;
  select * into sub from club_subscription where club_id = p_club;
  select count(*) into lic from players where club_id = p_club and deleted_at is null and not player_loaned_in(id);
  paying := paying_players(p_club, coalesce(sub.free_teams, 1));
  due := case when coalesce(sub.status, 'test') = 'payant' and sub.rate_cents is not null then paying * sub.rate_cents else null end;
  return jsonb_build_object('status', coalesce(sub.status, 'test'), 'engaged_from', sub.engaged_from, 'engaged_to', sub.engaged_to,
    'licensees', lic, 'paying_players', paying, 'rate_cents', sub.rate_cents, 'due_cents', due, 'note', coalesce(sub.note, ''),
    'loaned_in', (select count(*) from player_loans l where l.club_id = p_club and l.direction = 'entrant' and loan_active(l)));
end $$;
revoke execute on function club_client_view(uuid) from public, anon;
grant execute on function club_client_view(uuid) to authenticated;

select close_visitor_functions();
