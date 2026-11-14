-- MAJ_ALPHA_5_15_0.sql · mypocketclub · n° 238 (qui peut écrire à qui dans Messages) et n° 242 (tactiques du carnet du coach) · à lancer une fois dans Supabase › SQL Editor › Run.
-- Sans perte de données, relançable sans risque. À lancer JUSTE APRÈS la mise en ligne du code 5.15.0. Aucune fonction Edge à redéployer.

-- mypocketclub · alpha 5.15.0 · mise à jour d'une base 5.13.0 / 5.14.0, sans perte de données, relançable.
--   N° 238 (Gaël, 14 novembre 2026) : dans Messages, chacun ne peut inviter que les personnes avec qui il a un lien :
--     tout le monde peut écrire au bureau (président et membres du bureau) ; les coachs de son équipe (ou de l'équipe de son enfant) ;
--     les autres coachs si l'on est coach ; les membres de son équipe (ou de celle de son enfant) ; le bureau peut écrire à tout le club.
--     La liste est donnée par contact_people() et la base le vérifie à l'invitation (can_contact dans la règle de group_members).
--     La règle « mineur » de la 5.3.0 (trigger group_members_minor_check) reste en place, inchangée.
--   N° 242 (Gaël, 14 novembre 2026) : carnet du coach, banque de tactiques (table tactics, schéma animé comme les exercices).

-- ---------- n° 238 ----------
-- Équipes auxquelles la personne connectée est liée dans le club : son profil d'équipe (coach, joueur, parent, contact),
-- sa fiche de joueur, ou la fiche d'un de ses enfants (équipe principale et équipes en plus)
create or replace function my_team_ids(c uuid) returns setof uuid language sql stable security definer set search_path = public as $$
  select m.team_id from memberships m where m.club_id = c and m.user_id = auth.uid() and m.status = 'active' and m.team_id is not null
  union
  select p.team_id from players p where p.club_id = c and p.deleted_at is null and p.team_id is not null
    and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))
  union
  select x.team_id from player_teams x join players p on p.id = x.player_id where p.club_id = c and p.deleted_at is null
    and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()));
$$;

-- Comptes que la personne connectée peut inviter dans un groupe d'échange du club
create or replace function contact_ids(c uuid) returns setof uuid language sql stable security definer set search_path = public as $$
  with mine as (select my_team_ids(c) as t), me_coach as (select is_coach_in(c) as y)
  select m.user_id from memberships m where m.club_id = c and m.status = 'active' and is_board(c)
  union
  select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role in ('president', 'bureau')
  union
  select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.role = 'coach'
    and (m.team_id in (select t from mine) or (select y from me_coach))
  union
  select m.user_id from memberships m where m.club_id = c and m.status = 'active' and m.team_id in (select t from mine)
  union
  select p.user_id from players p where p.club_id = c and p.deleted_at is null and p.user_id is not null
    and (p.team_id in (select t from mine) or exists(select 1 from player_teams x where x.player_id = p.id and x.team_id in (select t from mine)))
  union
  select pp.user_id from player_parents pp join players p on p.id = pp.player_id where p.club_id = c and p.deleted_at is null
    and (p.team_id in (select t from mine) or exists(select 1 from player_teams x where x.player_id = p.id and x.team_id in (select t from mine)));
$$;

create or replace function can_contact(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select u = auth.uid() or exists(select 1 from contact_ids(c) x where x = u);
$$;

-- La liste affichée dans « Nouveau groupe » : nom (« Prénom N. », comme club_roster, sauf pour le bureau et le coach de l'équipe), rôle, équipe
create or replace function contact_people(p_club uuid) returns table(user_id uuid, first_name text, last_name text, role text, team_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (m.user_id) m.user_id, pr.first_name,
    case when is_board(p_club) or coaches_team(m.team_id) then pr.last_name
         when coalesce(pr.last_name, '') = '' then '' else left(pr.last_name, 1) || '.' end,
    m.role, m.team_id
  from memberships m join profiles pr on pr.id = m.user_id
  where is_member(p_club) and m.club_id = p_club and m.status = 'active' and m.user_id <> auth.uid()
    and m.user_id in (select contact_ids(p_club))
  order by m.user_id, case m.role when 'president' then 0 when 'bureau' then 1 when 'coach' then 2 when 'joueur' then 3 when 'parent' then 4 else 5 end;
$$;
revoke execute on function my_team_ids(uuid), contact_ids(uuid), can_contact(uuid, uuid), contact_people(uuid) from public, anon;
grant execute on function contact_people(uuid), can_contact(uuid, uuid) to authenticated;

-- Compte actif dans le club (lu par la base : la personne qui invite ne voit pas toujours le profil de l'invité,
-- ce qui bloquait par exemple un parent qui voulait écrire au président)
create or replace function active_in_club(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships m where m.club_id = c and m.user_id = u and m.status = 'active');
$$;
revoke execute on function active_in_club(uuid, uuid) from public, anon;
grant execute on function active_in_club(uuid, uuid) to authenticated;

-- La règle d'invitation vérifie maintenant le lien (le créateur s'ajoute lui-même ; un groupe d'équipe garde sa règle propre)
drop policy if exists "le créateur invite des membres du club" on group_members;
create policy "le créateur invite des membres du club" on group_members for insert with check (
  exists(select 1 from groups g where g.id = group_id and g.created_by = auth.uid())
  and exists(select 1 from groups g where g.id = group_id and active_in_club(g.club_id, group_members.user_id)
             and (g.team_id is not null or can_contact(g.club_id, group_members.user_id))));

-- ---------- n° 242 · tactiques ----------
create table if not exists tactics (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  sport text not null default 'Basket-ball',
  steps jsonb not null,
  sharing text not null default 'me' check (sharing in ('me', 'club')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tactics_club on tactics(club_id);
alter table tactics enable row level security;
drop policy if exists "tactiques lues par l'auteur ou le club" on tactics;
create policy "tactiques lues par l'auteur ou le club" on tactics for select using (
  created_by = auth.uid() or (sharing = 'club' and deleted_at is null and is_member(club_id)));
drop policy if exists "tactiques créées par l'encadrement" on tactics;
create policy "tactiques créées par l'encadrement" on tactics for insert with check (
  created_by = auth.uid() and (is_coach_in(club_id) or is_board(club_id)) and octet_length(steps::text) < 60000);
drop policy if exists "tactiques modifiées par l'auteur" on tactics;
create policy "tactiques modifiées par l'auteur" on tactics for update using (created_by = auth.uid())
  with check (created_by = auth.uid() and octet_length(steps::text) < 60000);
drop policy if exists "tactiques supprimées par l'auteur" on tactics;
create policy "tactiques supprimées par l'auteur" on tactics for delete using (created_by = auth.uid());
grant select, insert, update, delete on tactics to authenticated;

select close_visitor_functions();
