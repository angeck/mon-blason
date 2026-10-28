-- ---------- Alpha 2.1 ----------
-- n° 16 et 19 : destinataires des rendez-vous (club, équipe, bureau, bureau et coachs, tous les coachs)
alter table events add column if not exists audience text not null default 'club';
alter table events drop constraint if exists events_audience_check;
alter table events add constraint events_audience_check check (audience in ('club','team','board','board_coaches','coaches'));
update events set audience = 'team' where team_id is not null and audience = 'club';

-- n° 19 : types Réunion et AG
alter table events drop constraint if exists events_type_check;
alter table events add constraint events_type_check check (type in ('Événement','Entraînement','Match','Plateau','Tournoi','Réunion','AG'));

-- Le compte fait-il partie de l'équipe (joueur, coach, parent d'un joueur, joueur adulte avec sa fiche) ?
create or replace function in_team(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select t is not null and (
    exists(select 1 from memberships where team_id = t and user_id = auth.uid() and status = 'active')
    or exists(select 1 from players p where (p.team_id = t or exists(select 1 from player_teams pt where pt.player_id = p.id and pt.team_id = t))
              and (p.user_id = auth.uid() or exists(select 1 from player_parents pp where pp.player_id = p.id and pp.user_id = auth.uid()))));
$$;
create or replace function is_coach_in(c uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from memberships where club_id = c and user_id = auth.uid() and status = 'active' and role = 'coach');
$$;
create or replace function sees_event(eid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from events e where e.id = eid and (
    e.created_by = auth.uid() or is_board(e.club_id)
    or (e.audience = 'club' and is_member(e.club_id))
    or (e.audience = 'team' and in_team(e.team_id))
    or (e.audience in ('coaches','board_coaches') and is_coach_in(e.club_id))));
$$;

drop policy if exists "événements lisibles par les membres" on events;
drop policy if exists "rendez-vous lisibles par les destinataires" on events;
create policy "rendez-vous lisibles par les destinataires" on events for select using (sees_event(id));

-- Un coach ne crée que pour son équipe et jamais de rendez-vous interne au bureau
drop policy if exists "rendez-vous créés selon les droits" on events;
create policy "rendez-vous créés selon les droits" on events for insert with check (
  created_by = auth.uid() and (is_board(club_id) or (coaches_team(team_id) and audience = 'team')));

drop policy if exists "réponses lisibles par les membres" on event_responses;
drop policy if exists "chacun répond pour soi" on event_responses;
drop policy if exists "réponses lisibles par les destinataires" on event_responses;
drop policy if exists "chacun répond pour soi s'il est invité" on event_responses;
create policy "réponses lisibles par les destinataires" on event_responses for select using (sees_event(event_id));
create policy "chacun répond pour soi s'il est invité" on event_responses for insert with check (user_id = auth.uid() and sees_event(event_id));

-- n° 17 : suppression d'un sondage (auteur, bureau, créateur du groupe), avec trace « supprimé par »
alter table polls add column if not exists deleted_by uuid references auth.users(id);
alter table polls add column if not exists deleted_at timestamptz;
create or replace function can_delete_poll(pid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from polls p join groups g on g.id = p.group_id where p.id = pid and (
    p.created_by = auth.uid() or g.created_by = auth.uid() or is_board(g.club_id)));
$$;
create or replace function delete_poll(pid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_delete_poll(pid) then raise exception 'Vous ne pouvez pas supprimer ce sondage'; end if;
  update polls set deleted_by = auth.uid(), deleted_at = now() where id = pid and deleted_at is null;
  delete from poll_votes where poll_id = pid;
end $$;

-- n° 18 : document des tarifs joint (PDF ou image), lisible par les membres, géré par le bureau
create table if not exists club_docs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  kind text not null default 'tarifs' check (kind in ('tarifs')),
  file_name text not null,
  data text not null check (data like 'data:application/pdf;%' or data like 'data:image/%'),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table club_docs drop constraint if exists club_docs_size;
alter table club_docs add constraint club_docs_size check (length(data) < 5600000);
alter table club_docs enable row level security;
drop policy if exists "documents lisibles par les membres" on club_docs;
drop policy if exists "documents gérés par le bureau" on club_docs;
create policy "documents lisibles par les membres" on club_docs for select using (is_member(club_id));
create policy "documents gérés par le bureau" on club_docs for all using (is_board(club_id)) with check (is_board(club_id) and uploaded_by = auth.uid());
