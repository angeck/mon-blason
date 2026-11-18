-- MAJ_BETA_1_2_2.sql · mypocketclub · bêta 1.2.2
-- n° 267 : import de joueurs, « Relier à la fiche existante » et fusion automatique quand le n° de licence est le même
-- n° 264 : la notification « Attestation prête » ou « refusée » ouvre la fiche du joueur (plus Mon compte)
-- n° 268 : « Prévenir l'encadrement » : une notification aux autres coachs de l'équipe quand une séance reliée est prête
-- À lancer une fois dans Supabase › SQL Editor › Run, d'abord sur la base de TEST. Sans perte de données, relançable sans risque.

-- ---------- n° 267 · ressemblances à l'import ----------
-- kind : 'licence' (même n° de licence et même nom ou même date : fusion automatique),
--        'licence_conflit' (même n° de licence, mais nom et date différents : erreur de saisie probable),
--        'certain' (mêmes nom et prénom), 'possible' (simple ressemblance, ou homonyme avec un autre n° de licence).
-- diff : ce qui diffère entre la ligne et la fiche (la date n'est montrée qu'à qui peut voir la fiche).
-- team_archived : la fiche est dans une équipe archivée (saison passée) ou sans équipe : la relier la fait passer dans l'équipe de l'import.
drop function if exists match_players(uuid, jsonb);
create function match_players(p_club uuid, p_rows jsonb)
returns table(idx int, player_id uuid, kind text, label text, team_name text, same_team boolean, team_archived boolean, diff text)
language plpgsql stable security definer set search_path = public as $$
declare r record; i int := 0;
begin
  if not (is_board(p_club) or is_coach_in(p_club)) then raise exception 'Droit insuffisant'; end if;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, team_id uuid) loop
    r.licence := nullif(upper(regexp_replace(coalesce(r.licence, ''), '\s', '', 'g')), '');
    return query
      with m as (
        select x.id, x.first_name, x.last_name, x.birth_date, x.team_id, t.name as tname, t.state as tstate,
          (is_board(p_club) or can_see_player(x.id)) as sees,
          norm_name(x.first_name) = norm_name(r.first_name) and norm_name(x.last_name) = norm_name(r.last_name) as same_name,
          r.licence is not null and upper(regexp_replace(coalesce(a.licence_number, ''), '\s', '', 'g')) = r.licence as same_lic,
          r.licence is not null and coalesce(a.licence_number, '') <> '' and upper(regexp_replace(a.licence_number, '\s', '', 'g')) <> r.licence as other_lic,
          r.birth_date is not null and x.birth_date = r.birth_date as same_birth,
          r.birth_date is not null and x.birth_date is not null and x.birth_date <> r.birth_date as other_birth
        from players x left join player_admin a on a.player_id = x.id left join teams t on t.id = x.team_id
        where x.club_id = p_club and x.deleted_at is null and (
          (norm_name(x.first_name) = norm_name(r.first_name) and norm_name(x.last_name) = norm_name(r.last_name))
          or (r.licence is not null and upper(regexp_replace(coalesce(a.licence_number, ''), '\s', '', 'g')) = r.licence)
          or (norm_name(x.first_name) = norm_name(r.last_name) and norm_name(x.last_name) = norm_name(r.first_name))
          or (norm_name(x.last_name) = norm_name(r.last_name) and extensions.levenshtein(norm_name(x.first_name), norm_name(r.first_name)) <= 1)
          or (norm_name(x.first_name) = norm_name(r.first_name) and r.birth_date is not null and x.birth_date = r.birth_date))
      ), k as (
        select m.*, case
            when same_lic and (same_name or same_birth) then 'licence'
            when same_lic then 'licence_conflit'
            when same_name and not other_lic then 'certain'
            else 'possible' end as kd
        from m
      )
      select i, k.id, k.kd,
        k.first_name || ' ' || case when k.sees then k.last_name else case when k.last_name = '' then '' else left(k.last_name, 1) || '.' end end
          || case when k.birth_date is not null and k.sees then ' · ' || to_char(k.birth_date, 'DD/MM/YYYY') else '' end,
        coalesce(k.tname, 'sans équipe'), k.team_id is not distinct from r.team_id,
        k.team_id is null or k.tstate = 'Archivée',
        nullif(concat_ws(' · ',
          case when k.other_birth then 'date de naissance différente' || case when k.sees then ' (fiche : ' || to_char(k.birth_date, 'DD/MM/YYYY') || ')' else '' end end,
          case when k.other_lic then 'autre n° de licence sur la fiche' end,
          case when k.kd = 'licence_conflit' then 'même n° de licence, mais nom différent' end), '')
      from k
      order by case k.kd when 'licence' then 0 when 'licence_conflit' then 1 when 'certain' then 2 else 3 end, k.first_name;
    i := i + 1;
  end loop;
end $$;
revoke execute on function match_players(uuid, jsonb) from public, anon;
grant execute on function match_players(uuid, jsonb) to authenticated;

-- ---------- n° 267 · import : action 'link' (relier) ----------
-- 'link' = compléter les cases vides de la fiche existante (jamais écraser), puis la relier à l'équipe de l'import :
-- équipe principale si la fiche est sans équipe ou dans une équipe archivée, sinon équipe en plus.
-- 'complete' et 'addteam' restent acceptées (anciennes versions de l'application).
create or replace function import_players(p_club uuid, p_team uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; pid uuid; pname text; cur_team uuid; cur_state text;
begin
  if not (has_area(p_club, 'secretariat') or coaches_team(p_team)) then raise exception 'Droit insuffisant'; end if;
  if p_team is not null and not exists(select 1 from teams where id = p_team and club_id = p_club and deleted_at is null) then raise exception 'Équipe inconnue'; end if;
  if jsonb_array_length(p_rows) > 300 then raise exception 'Liste trop longue (300 lignes au plus)'; end if;
  select case when partner_state <> 'aucune' then nullif(lower(trim(partner_name)), '') end into pname from teams where id = p_team;
  for r in select * from jsonb_to_recordset(p_rows) as t(first_name text, last_name text, birth_date date, licence text, action text, existing uuid, email text, phone text, club text) loop
    if coalesce(r.action, 'create') = 'skip' or coalesce(trim(r.first_name), '') = '' then continue; end if;
    r.email := nullif(lower(trim(coalesce(r.email, ''))), ''); if r.email is not null and r.email not like '%@%' then r.email := null; end if;
    r.phone := nullif(trim(coalesce(r.phone, '')), '');
    if r.action in ('link', 'complete', 'addteam') then
      select x.team_id, t.state into cur_team, cur_state from players x left join teams t on t.id = x.team_id
        where x.id = r.existing and x.club_id = p_club and x.deleted_at is null;
      if not found then continue; end if;
      update players set birth_date = coalesce(birth_date, r.birth_date), parent_email = coalesce(parent_email, r.email), parent_phone = coalesce(parent_phone, r.phone) where id = r.existing;
      if coalesce(trim(r.licence), '') <> '' then
        insert into player_admin(player_id, licence_number) values (r.existing, trim(r.licence))
          on conflict (player_id) do update set licence_number = coalesce(nullif(player_admin.licence_number, ''), excluded.licence_number);
      end if;
      if r.action = 'link' and p_team is not null and cur_team is distinct from p_team then
        if cur_team is null or cur_state = 'Archivée' then
          update players set team_id = p_team where id = r.existing;
          perform log_action(p_club, null, r.existing, 'fiche reliée à la nouvelle équipe par un import', '{}'::jsonb);
        else
          insert into player_teams values (r.existing, p_team) on conflict do nothing;
        end if;
      elsif r.action = 'addteam' and p_team is not null then
        insert into player_teams values (r.existing, p_team) on conflict do nothing;
      end if;
      n := n + 1; continue;
    end if;
    insert into players(club_id, team_id, first_name, last_name, birth_date, parent_email, parent_phone, created_by, from_partner)
      values (p_club, p_team, r.first_name, coalesce(r.last_name, ''), r.birth_date, r.email, r.phone, auth.uid(),
              pname is not null and lower(trim(coalesce(r.club, ''))) = pname) returning id into pid;
    insert into player_admin(player_id, licence_number) values (pid, nullif(trim(coalesce(r.licence, '')), ''));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function import_players(uuid, uuid, jsonb) from public, anon;
grant execute on function import_players(uuid, uuid, jsonb) to authenticated;

-- ---------- n° 264 · la notification d'attestation ouvre la fiche du joueur ----------
-- Lien « ./#fiche=<club>.<joueur> » : l'application change de club si besoin, puis ouvre la fiche.
create or replace function deliver_attestation(p_id uuid, p_pdf text) returns void
language plpgsql security definer set search_path = public as $$
declare r attestation_requests; pn text;
begin
  select * into r from attestation_requests where id = p_id;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  if not (is_president(r.club_id) or has_area(r.club_id, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if r.status <> 'attente' then raise exception 'Demande déjà traitée'; end if;
  if p_pdf is null or p_pdf not like 'JVBERi0%' or length(p_pdf) > 2000000 then raise exception 'PDF illisible ou trop lourd'; end if;   -- « %PDF- » en base64
  update attestation_requests set status = 'delivree', pdf = p_pdf, decided_by = auth.uid(), decided_at = now(), reason = null where id = p_id;
  select first_name into pn from players where id = r.player_id;
  perform log_action(r.club_id, r.requested_by, r.player_id, 'attestation de paiement délivrée sur demande', '{}'::jsonb);
  if r.requested_by is not null then
    perform push_enqueue(r.requested_by, 'Attestation prête', 'L''attestation de paiement de ' || coalesce(pn, 'ton enfant') || ' est sur sa fiche, cadre « Licence et cotisation ».', 'attest', 'attok:' || p_id,
      './#fiche=' || r.club_id || '.' || r.player_id);
  end if;
end $$;
revoke execute on function deliver_attestation(uuid, text) from public, anon;
grant execute on function deliver_attestation(uuid, text) to authenticated;

create or replace function refuse_attestation(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare r attestation_requests; why text := nullif(left(trim(coalesce(p_reason, '')), 200), '');
begin
  select * into r from attestation_requests where id = p_id;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  if not (is_president(r.club_id) or has_area(r.club_id, 'tresorerie')) then raise exception 'Réservé au président et à la trésorerie'; end if;
  if r.status <> 'attente' then raise exception 'Demande déjà traitée'; end if;
  if why is null then raise exception 'Indique un motif court'; end if;
  update attestation_requests set status = 'refusee', reason = why, decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform log_action(r.club_id, r.requested_by, r.player_id, 'demande d''attestation refusée', jsonb_build_object('motif', why));
  if r.requested_by is not null then
    perform push_enqueue(r.requested_by, 'Attestation refusée', why, 'attest', 'attno:' || p_id, './#fiche=' || r.club_id || '.' || r.player_id);
  end if;
end $$;
revoke execute on function refuse_attestation(uuid, text) from public, anon;
grant execute on function refuse_attestation(uuid, text) to authenticated;

-- ---------- n° 268 · « Prévenir l'encadrement » ----------
alter table training_plans add column if not exists staff_notified_at timestamptz;

-- Le coach (auteur de la séance, coach de l'équipe ou bureau) prévient les AUTRES coachs de l'équipe, assistants compris.
-- Seulement pour une séance reliée à un entraînement à venir d'une équipe. Renvoie le nombre de personnes visées.
create or replace function notify_plan_staff(p_plan uuid) returns int
language plpgsql security definer set search_path = public as $$
declare p training_plans; e events; u uuid; n int := 0; again boolean; stamp text := to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'); quand text;
begin
  if auth.uid() is null then raise exception 'Connecte-toi d''abord'; end if;
  select * into p from training_plans where id = p_plan and deleted_at is null;
  if p.id is null then raise exception 'Séance introuvable'; end if;
  if not (p.created_by = auth.uid() or (p.team_id is not null and coaches_team(p.team_id)) or is_board(p.club_id)) then raise exception 'Droit insuffisant'; end if;
  if p.team_id is null or p.event_id is null then raise exception 'Relie d''abord la séance à un entraînement de l''équipe'; end if;
  select * into e from events where id = p.event_id;
  if e.id is null or e.starts_at < now() - interval '3 hours' then raise exception 'Cet entraînement est passé'; end if;
  again := p.staff_notified_at is not null;
  quand := (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from e.starts_at at time zone 'Europe/Paris')::int + 1]
           || ' ' || to_char(e.starts_at at time zone 'Europe/Paris', 'DD/MM') || ' à ' || to_char(e.starts_at at time zone 'Europe/Paris', 'HH24"h"MI');
  for u in select distinct m.user_id from memberships m
             where m.team_id = p.team_id and m.role = 'coach' and m.status = 'active' and m.user_id is not null and m.user_id <> auth.uid() loop
    perform push_enqueue(u, case when again then 'Séance modifiée' else 'Séance prête' end,
      left(p.title, 80) || ' · entraînement du ' || quand, 'seance', 'plan:' || p.id || ':' || stamp || ':' || u, './');
    n := n + 1;
  end loop;
  update training_plans set staff_notified_at = now() where id = p.id;
  return n;
end $$;
revoke execute on function notify_plan_staff(uuid) from public, anon;
grant execute on function notify_plan_staff(uuid) to authenticated;

select close_visitor_functions();
