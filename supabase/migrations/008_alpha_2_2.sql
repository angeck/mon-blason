-- ---------- Alpha 2.2 ----------
-- n° 21 : la réponse d'un parent est enregistrée au nom de l'enfant (fiche joueur), une seule réponse par enfant
alter table event_responses add column if not exists player_id uuid references players(id) on delete cascade;
alter table event_responses add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if exists(select 1 from pg_constraint where conname = 'event_responses_pkey' and conrelid = 'event_responses'::regclass
            and array_length(conkey, 1) = 2) then
    alter table event_responses drop constraint event_responses_pkey;
  end if;
  if not exists(select 1 from pg_constraint where contype = 'p' and conrelid = 'event_responses'::regclass) then
    alter table event_responses add constraint event_responses_pkey primary key (id);
  end if;
end $$;
create unique index if not exists event_responses_self on event_responses(event_id, user_id) where player_id is null;
create unique index if not exists event_responses_child on event_responses(event_id, player_id) where player_id is not null;

create or replace function respond_event(p_event uuid, p_player uuid, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null or not sees_event(p_event) then raise exception 'Rendez-vous introuvable'; end if;
  if p_answer is not null and p_answer not in ('oui','non') then raise exception 'Réponse invalide'; end if;
  select * into e from events where id = p_event;
  if p_player is not null then
    if not (is_parent_of(p_player) or exists(select 1 from players where id = p_player and user_id = auth.uid())) then raise exception 'Ce joueur n''est pas relié à votre compte'; end if;
    delete from event_responses where event_id = p_event and player_id = p_player;
    if p_answer is not null then insert into event_responses(event_id, user_id, player_id, answer) values (p_event, auth.uid(), p_player, p_answer); end if;
  else
    if e.team_id is not null and e.type in ('Entraînement','Match','Plateau','Tournoi') and coaches_team(e.team_id)
       and not exists(select 1 from memberships where team_id = e.team_id and user_id = auth.uid() and status = 'active' and role = 'joueur')
       and not exists(select 1 from players where user_id = auth.uid() and team_id = e.team_id) then
      raise exception 'Vous encadrez cette équipe : pas de réponse pour vous-même';
    end if;
    delete from event_responses where event_id = p_event and user_id = auth.uid() and player_id is null;
    if p_answer is not null then insert into event_responses(event_id, user_id, answer) values (p_event, auth.uid(), p_answer); end if;
  end if;
end $$;

-- Réponses seulement par la fonction (contrôles ci-dessus)
drop policy if exists "chacun répond pour soi" on event_responses;
drop policy if exists "chacun répond pour soi s'il est invité" on event_responses;
drop policy if exists "chacun change sa réponse" on event_responses;
drop policy if exists "chacun retire sa réponse" on event_responses;

-- n° 22 : interrupteur « Tout le club » mémorisé par compte
alter table profiles add column if not exists show_all_club boolean not null default false;
grant update (show_all_club) on profiles to authenticated;
grant select (show_all_club) on profiles to authenticated;

-- n° 23 : une demande en attente ou un rôle actif identique bloque ; rien d'autre
create or replace function join_guard() returns trigger language plpgsql as $$
begin
  if new.role <> 'parent' and exists(select 1 from memberships m where m.club_id = new.club_id and m.user_id = new.user_id and m.role = new.role
       and m.team_id is not distinct from new.team_id and m.id <> new.id) then
    raise exception 'Vous avez déjà ce rôle ou une demande en attente pour ce rôle';
  end if;
  return new;
end $$;
drop trigger if exists join_guard on memberships;
create trigger join_guard before insert on memberships for each row execute function join_guard();

-- Débloque les demandes restées en attente qui auraient dû être accordées tout de suite (président ; bureau qui demande coach)
do $$
declare m record;
begin
  for m in select x.id from memberships x where x.status = 'pending' and (
      exists(select 1 from memberships p where p.club_id = x.club_id and p.user_id = x.user_id and p.status = 'active' and p.role = 'president')
      or (x.role = 'coach' and exists(select 1 from memberships b where b.club_id = x.club_id and b.user_id = x.user_id and b.status = 'active' and b.role = 'bureau'))) loop
    perform activate_membership(m.id, null, null);
  end loop;
end $$;
