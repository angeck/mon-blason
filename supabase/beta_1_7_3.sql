-- mypocketclub · bêta 1.7.3 · script idempotent (se relance sans risque)
-- n° 293 suite (Gaël, 24 novembre : « pour le moment on fait confiance ») : la Vue d'ensemble de l'administrateur compte les
--   prêts en cours (joueurs prêtés, joueurs en prêt) et nomme le club qui déclare le plus de joueurs « en prêt » (contrôle
--   du contournement de la facture, sans blocage). Aucun nom de joueur.
-- Rien n'est effacé.

create or replace function admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; due bigint;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select coalesce(sum(paying_players(s.club_id, s.free_teams)::bigint * s.rate_cents), 0) into due
    from club_subscription s join clubs c on c.id = s.club_id where c.deleted_at is null and s.status = 'payant' and s.rate_cents is not null;
  select jsonb_build_object(
    'clubs', (select count(*) from clubs where deleted_at is null),
    'accounts', (select count(*) from profiles where deleted_at is null),
    'players', (select count(*) from players p join clubs c on c.id = p.club_id where p.deleted_at is null and c.deleted_at is null),
    'active7', (select count(*) from auth.users u where u.last_sign_in_at > now() - interval '7 days'),
    'to_validate', (select count(*) from clubs c where c.deleted_at is null
        and exists(select 1 from memberships m where m.club_id = c.id and m.role = 'president' and m.status = 'active')
        and not exists(select 1 from memberships m join sender_validations v on v.club_id = m.club_id and v.user_id = m.user_id
                       where m.club_id = c.id and m.role = 'president' and m.status = 'active')),
    'club_requests', (select count(*) from club_requests where status = 'new'),
    'schemas', (select count(*) from schema_requests where status = 'pending'),
    'duplicates', (select count(*) from exercise_duplicates d join exercises e on e.id = d.exercise_id
        where d.status = 'signale' and e.sharing = 'public' and e.public_state = 'validated'),
    'reports', (select count(*) from message_reports where forwarded_at is not null and admin_done_at is null),
    'sub_test', (select count(*) from clubs c left join club_subscription s on s.club_id = c.id where c.deleted_at is null and coalesce(s.status, 'test') = 'test'),
    'sub_free', (select count(*) from club_subscription s join clubs c on c.id = s.club_id where c.deleted_at is null and s.status = 'gratuit'),
    'sub_paid', (select count(*) from club_subscription s join clubs c on c.id = s.club_id where c.deleted_at is null and s.status = 'payant'),
    'due_cents', due,
    'last_purge', (select max(at) from admin_log where action = 'suppressions automatiques lancées'),
    -- n° 293 : prêts en cours (saison en cours, pas terminés), clubs dans la corbeille exclus
    'loans_out', (select count(*) from player_loans l join clubs c on c.id = l.club_id join players p on p.id = l.player_id
        where c.deleted_at is null and p.deleted_at is null and l.direction = 'sortant' and loan_active(l)),
    'loans_in', (select count(*) from player_loans l join clubs c on c.id = l.club_id join players p on p.id = l.player_id
        where c.deleted_at is null and p.deleted_at is null and l.direction = 'entrant' and loan_active(l)),
    'loans_clubs', (select count(distinct l.club_id) from player_loans l join clubs c on c.id = l.club_id
        where c.deleted_at is null and loan_active(l)),
    'loans_top', (select jsonb_build_object('club', c.name, 'n', count(*), 'players', (select count(*) from players x where x.club_id = c.id and x.deleted_at is null))
        from player_loans l join clubs c on c.id = l.club_id join players p on p.id = l.player_id
        where c.deleted_at is null and p.deleted_at is null and l.direction = 'entrant' and loan_active(l)
        group by c.id, c.name order by count(*) desc, c.name limit 1)) into r;
  return r;
end $$;
revoke execute on function admin_overview() from public, anon;
grant execute on function admin_overview() to authenticated;

select close_visitor_functions();
