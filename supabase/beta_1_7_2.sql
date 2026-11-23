-- mypocketclub · bêta 1.7.2 · script idempotent (se relance sans risque)
-- n° 293 (correctif) : la demande de prise de contact née d'un prêt ne porte plus le nom du coach (il n'a rien choisi) ;
--   l'e-mail envoyé par Gaël a son propre texte (club qui prête ou accueille, jamais le nom du joueur ni du coach).
-- Textes légaux : « Vos données » 1.14 et conditions 1.4 (dans js/legal.js, rien à faire ici).
-- Rien n'est effacé.

-- Demandes déjà créées par la 1.7.1 : anonymes
update club_requests set first_name = '', last_name = '', consent = false, user_id = null where loan_id is not null and consent;

create or replace function set_player_loan(p_player uuid, p_dir text, p_club uuid, p_name text, p_city text) returns uuid
language plpgsql security definer set search_path = public as $$
declare x players; lid uuid; oname text; ocity text; u uuid; mine text; short text; ntc text := 'aucun';
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
    ntc := 'email';   -- un seul e-mail (et au plus une relance) par club et par joueur
  end if;
  insert into player_loans(club_id, player_id, direction, other_club_id, other_name, other_city, notice, created_by)
    values (x.club_id, p_player, p_dir, p_club, oname, ocity, ntc, auth.uid()) returning id into lid;
  perform log_action(x.club_id, null, null, case p_dir when 'sortant' then 'Joueur prêté' else 'Joueur en prêt' end,
    jsonb_build_object('joueur', short, 'club', oname, 'saison', season_label(now())));
  if ntc = 'mpc' then
    for u in select m.user_id from memberships m where m.club_id = p_club and m.role = 'president' and m.status = 'active' loop
      perform push_enqueue(u, case p_dir when 'sortant' then 'Joueur prêté à votre club' else 'Joueur en prêt chez ' || left(mine, 40) end,
        short || ' · ' || mine || ' · saison ' || season_label(now()), 'pret:' || p_club, 'pret:' || lid);
    end loop;
  elsif ntc = 'email' then
    -- demande anonyme (ni le coach ni le joueur ne sont nommés) ; traitée par Gaël selon les règles du n° 96
    insert into club_requests(first_name, last_name, email, club_name, city, sport, age_ok, consent, user_id, ip_hash, loan_id)
      values ('', '', '', oname, ocity, coalesce((select sport from clubs where id = x.club_id), ''), true, false, null, '', lid);
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

-- L'e-mail de prise de contact sait si la demande vient d'un prêt
create or replace function admin_outreach_prepare(p_request uuid, p_email text, p_source text, p_url text, p_relance boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r club_requests; k text; o club_outreach; em text := lower(trim(coalesce(p_email, ''))); n int; req record;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into r from club_requests where id = p_request;
  if r.id is null then raise exception 'Demande introuvable'; end if;
  k := outreach_key(r.club_name, r.city);
  select * into o from club_outreach where club_key = k for update;
  if coalesce(p_relance, false) then
    if o.id is null or o.status <> 'envoye' then raise exception 'Relance possible seulement après un premier envoi, et une seule fois'; end if;
    if o.sent_at > now() - interval '14 days' then raise exception 'Relance possible à partir du %', to_char(o.sent_at + interval '14 days', 'DD/MM/YYYY'); end if;
    em := o.email;
  else
    if o.id is not null and o.status in ('envoye', 'relance', 'refuse') then raise exception 'Ce club a déjà été contacté : une relance au plus'; end if;
    if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 160 then raise exception 'Adresse e-mail du club à vérifier'; end if;
    if length(trim(coalesce(p_source, ''))) < 2 then raise exception 'Indique d''où vient l''adresse (site du club, fédération…)'; end if;
  end if;
  if exists(select 1 from mail_blocklist where email_hash = mail_hash(em)) then
    if o.id is not null then update club_outreach set status = 'refuse' where id = o.id; end if;
    raise exception 'Cette adresse a refusé tout envoi : on ne lui écrit plus';
  end if;
  if exists(select 1 from clubs c where c.deleted_at is null and outreach_key(c.name, c.city) = k) then raise exception 'Ce club est déjà inscrit sur mypocketclub'; end if;
  if (select count(*) from mail_log where kind = 'information' and at >= date_trunc('day', now())) >= 10 then raise exception 'Limite du jour atteinte (10 e-mails aux clubs) : réessaie demain'; end if;
  if mails_today(null) >= 80 then raise exception 'Limite d''e-mails du jour atteinte : réessaie demain'; end if;
  -- la dernière demande dont l'auteur a accepté que son nom soit transmis ; et le nombre de demandeurs pour ce club
  select * into req from club_requests x where outreach_key(x.club_name, x.city) = k and x.consent order by x.created_at desc limit 1;
  select count(distinct lower(x.email)) into n from club_requests x where outreach_key(x.club_name, x.city) = k and x.consent;
  if coalesce(p_relance, false) then
    update club_outreach set status = 'relance', relance_at = now() where id = o.id returning * into o;
  else
    insert into club_outreach(club_key, club_name, city, email, source, source_url, sent_at, status)
      values (k, r.club_name, r.city, em, left(trim(p_source), 80), left(trim(coalesce(p_url, '')), 300), now(), 'envoye')
      on conflict (club_key) do update set email = excluded.email, source = excluded.source, source_url = excluded.source_url, sent_at = now(), status = 'envoye'
      returning * into o;
  end if;
  update club_requests set status = 'done', done_at = now() where outreach_key(club_name, city) = k and status = 'new';
  perform admin_note(case when coalesce(p_relance, false) then 'club absent relancé par e-mail' else 'club absent contacté par e-mail' end, null,
    jsonb_build_object('club', r.club_name, 'ville', r.city, 'source', o.source));
  return jsonb_build_object('outreach', o.id, 'email', em, 'token', mail_info_token(em), 'club', r.club_name, 'city', r.city,
    'first_name', coalesce(req.first_name, ''), 'last_name', coalesce(req.last_name, ''), 'count', greatest(n, 1), 'relance', coalesce(p_relance, false), 'source', o.source,
    -- bêta 1.7.2 · n° 293 : demande née d'un prêt : sens du prêt et nom du club qui prête ou accueille (jamais un nom de personne)
    'loan_dir', (select l.direction from player_loans l where l.id = r.loan_id),
    'loan_from', (select c.name from player_loans l join clubs c on c.id = l.club_id where l.id = r.loan_id));
end $$;
revoke execute on function admin_outreach_prepare(uuid, text, text, text, boolean) from public, anon;
grant execute on function admin_outreach_prepare(uuid, text, text, text, boolean) to authenticated;

-- Resend a refusé : l'envoi est annulé (on peut réessayer), noté « échec »
create or replace function admin_outreach_failed(p_outreach uuid, p_relance boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if coalesce(p_relance, false) then update club_outreach set status = 'envoye', relance_at = null where id = p_outreach;
  else update club_outreach set status = 'echec', sent_at = null where id = p_outreach; end if;
end $$;

revoke execute on function admin_outreach_prepare(uuid, text, text, text, boolean) from public, anon;
grant execute on function admin_outreach_prepare(uuid, text, text, text, boolean) to authenticated;

select close_visitor_functions();
