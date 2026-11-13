-- MAJ_ALPHA_5_10_0.sql · mypocketclub · n° 161 (exercices avec l'IA) · à lancer une fois dans Supabase > SQL Editor > Run (après la 5.9.0).
-- Sans perte de données, relançable sans risque. À lancer JUSTE APRÈS la mise en ligne du code 5.10.0, puis déployer la fonction Edge « generer-exercice ».

-- mypocketclub · alpha 5.10.0 · mise à jour d'une base 5.9.0, sans perte de données, relançable.
--   N° 161 · exercices avec l'IA (décision de Gaël du 13 novembre 2026, doc claude/05f) :
--     1. exercises.steps : le schéma animé, par étapes (éléments, positions de chaque étape, texte de l'étape).
--        L'ancien schéma fixe (exercises.diagram) reste lu tel quel.
--     2. ai_usage : chaque appel à l'IA (date, club, compte, modèle, jetons, coût estimé). Jamais le texte de l'exercice ni un nom.
--     3. ai_credit et ai_settings : crédit acheté (saisi par l'administrateur à chaque achat), seuil d'alerte, budget par club, pause.
--     4. ai_state(club) : la fonction Edge « generer-exercice » demande, au nom du coach, s'il peut lancer l'IA.
--        Refus : IA en pause, solde épuisé, budget du club atteint pour la saison, 20 schémas par jour et par compte.
--     5. ai_log_usage(...) : réservée à la fonction Edge (clé de service), note l'appel.
--     6. admin_ai_stats(), admin_ai_credit(), admin_ai_settings() : vue du solde dans l'espace admin (double vérification).
--   Budget par club et par saison (1er juillet) : 11 $ (environ 10 €) pour un club en test ou gratuit ;
--   un club payant a 10 % de son abonnement estimé, et jamais moins que ce budget.
-- Termine par « select close_visitor_functions(); » (règle de la 4.3.0).

-- 1. Schéma animé ----------------------------------------------------------------
alter table exercises add column if not exists steps jsonb not null default '{}'::jsonb;
alter table exercises drop constraint if exists exercises_steps_ok;
alter table exercises add constraint exercises_steps_ok check (jsonb_typeof(steps) = 'object' and pg_column_size(steps) <= 60000);

-- un schéma modifié repasse aussi par la validation du bureau (partage public)
create or replace function exercises_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if auth.uid() is not null and not (is_coach_in(new.club_id) or is_board(new.club_id)) then
      raise exception 'Seuls les coachs et le bureau ajoutent des exercices';
    end if;
    new.up_count := 0; new.down_count := 0; new.validated_by := null; new.validated_at := null; new.deleted_at := null; new.deleted_by := null;
  else
    new.created_by := old.created_by; new.club_id := old.club_id; new.created_at := old.created_at;
    if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
      new.up_count := old.up_count; new.down_count := old.down_count;
      new.validated_by := old.validated_by; new.validated_at := old.validated_at;
      new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;
    end if;
  end if;
  if not (exercise_text_ok(new.title) and exercise_text_ok(new.description) and exercise_text_ok(new.source) and exercise_text_ok(new.steps::text)) then
    raise exception 'Texte refusé : il contient une mention de droits d''auteur (©, « tous droits réservés »…). Écris l''exercice avec tes propres mots.';
  end if;
  if coalesce(current_setting('pc.exsys', true), '') <> 'on' then
    if new.sharing <> 'public' then new.public_state := 'none';
    elsif tg_op = 'INSERT' or old.sharing <> 'public' or old.public_state = 'none'
      or (new.title, new.description, new.diagram, new.steps, new.source, new.origin) is distinct from (old.title, old.description, old.diagram, old.steps, old.source, old.origin) then
      new.public_state := 'pending'; new.validated_by := null; new.validated_at := null;
    else new.public_state := old.public_state;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- 2 et 3. Suivi des appels, crédit, réglages ----------------------------------------
create table if not exists ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  club_id uuid references clubs(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  model text not null default '' check (length(model) <= 60),
  tokens_in int not null default 0 check (tokens_in >= 0),
  tokens_out int not null default 0 check (tokens_out >= 0),
  cost_usd numeric(10, 5) not null default 0 check (cost_usd >= 0),
  ok boolean not null default true          -- faux : l'IA a répondu, mais le schéma n'était pas utilisable (coût quand même compté)
);
create index if not exists ai_usage_at on ai_usage(at desc);
create index if not exists ai_usage_club on ai_usage(club_id, at);
create index if not exists ai_usage_user on ai_usage(user_id, at);
alter table ai_usage enable row level security;
revoke all on ai_usage from anon, authenticated;

create table if not exists ai_credit (
  id bigserial primary key,
  at timestamptz not null default now(),
  amount_usd numeric(10, 2) not null check (amount_usd > 0 and amount_usd <= 1000),
  note text not null default '' check (length(note) <= 200),
  admin_id uuid references auth.users(id) on delete set null
);
alter table ai_credit enable row level security;
revoke all on ai_credit from anon, authenticated;

create table if not exists ai_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  alert_usd numeric(10, 2) not null default 2 check (alert_usd >= 0),
  club_cap_usd numeric(10, 2) not null default 11 check (club_cap_usd >= 0),
  per_day int not null default 20 check (per_day between 1 and 200)
);
insert into ai_settings(id) values (1) on conflict (id) do nothing;
alter table ai_settings enable row level security;
revoke all on ai_settings from anon, authenticated;

-- début de la saison en cours (1er juillet), comme seasonOf() dans l'application
create or replace function ai_season_start() returns timestamptz language sql stable as $$
  select make_timestamptz(case when extract(month from now()) >= 7 then extract(year from now())::int else extract(year from now())::int - 1 end, 7, 1, 0, 0, 0, 'Europe/Paris');
$$;

create or replace function ai_balance() returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount_usd) from ai_credit), 0) - coalesce((select sum(cost_usd) from ai_usage), 0);
$$;
revoke execute on function ai_balance() from public, anon, authenticated;

create or replace function ai_club_cap(p_club uuid) returns numeric language sql stable security definer set search_path = public as $$
  select greatest(
    (select club_cap_usd from ai_settings where id = 1),
    coalesce((select case when s.status = 'payant' and s.rate_cents is not null
      then 0.10 * s.rate_cents / 100.0 * 1.1 * (select count(*) from players p where p.club_id = p_club and p.deleted_at is null) end
      from club_subscription s where s.club_id = p_club), 0));
$$;
revoke execute on function ai_club_cap(uuid) from public, anon, authenticated;

-- 4. Le coach peut-il lancer l'IA ? (appelée par la fonction Edge avec la session du coach)
create or replace function ai_state(p_club uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st ai_settings; spent numeric; cap numeric; today int;
begin
  if auth.uid() is null or not (is_coach_in(p_club) or is_board(p_club)) then
    return jsonb_build_object('ok', false, 'reason', 'droits');
  end if;
  select * into st from ai_settings where id = 1;
  spent := coalesce((select sum(cost_usd) from ai_usage where club_id = p_club and at >= ai_season_start()), 0);
  cap := ai_club_cap(p_club);
  today := (select count(*) from ai_usage where user_id = auth.uid() and at >= date_trunc('day', now()));
  return jsonb_build_object(
    'ok', st.enabled and ai_balance() > 0 and spent < cap and today < st.per_day,
    'reason', case when not st.enabled then 'pause' when ai_balance() <= 0 then 'solde' when spent >= cap then 'club' when today >= st.per_day then 'jour' end,
    'uid', auth.uid(), 'left_today', greatest(st.per_day - today, 0));
end $$;
revoke execute on function ai_state(uuid) from public, anon;
grant execute on function ai_state(uuid) to authenticated;

-- 5. Note d'un appel (clé de service seulement)
create or replace function ai_log_usage(p_club uuid, p_user uuid, p_model text, p_in int, p_out int, p_cost numeric, p_ok boolean) returns void
language sql security definer set search_path = public as $$
  insert into ai_usage(club_id, user_id, model, tokens_in, tokens_out, cost_usd, ok)
  values (p_club, p_user, left(coalesce(p_model, ''), 60), greatest(coalesce(p_in, 0), 0), greatest(coalesce(p_out, 0), 0), greatest(coalesce(p_cost, 0), 0), coalesce(p_ok, true));
$$;
revoke execute on function ai_log_usage(uuid, uuid, text, int, int, numeric, boolean) from public, anon, authenticated;
do $$ begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function ai_log_usage(uuid, uuid, text, int, int, numeric, boolean) to service_role';
    execute 'grant execute on function ai_state(uuid) to service_role';
  end if;
end $$;

-- 6. Espace admin ---------------------------------------------------------------------
create or replace function admin_ai_stats() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st ai_settings; r jsonb;
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into st from ai_settings where id = 1;
  select jsonb_build_object(
    'enabled', st.enabled, 'alert_usd', st.alert_usd, 'club_cap_usd', st.club_cap_usd, 'per_day', st.per_day,
    'credit', coalesce((select sum(amount_usd) from ai_credit), 0),
    'spent_total', coalesce((select sum(cost_usd) from ai_usage), 0),
    'spent_month', coalesce((select sum(cost_usd) from ai_usage where at >= date_trunc('month', now())), 0),
    'count_total', (select count(*) from ai_usage where ok),
    'count_month', (select count(*) from ai_usage where ok and at >= date_trunc('month', now())),
    'fails', (select count(*) from ai_usage where not ok),
    'balance', ai_balance(),
    'credits', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'amount', amount_usd, 'note', note) order by at desc) from (select * from ai_credit order by at desc limit 5) c), '[]'::jsonb),
    'clubs', coalesce((select jsonb_agg(x order by x->>'spent' desc) from (
      select jsonb_build_object('name', coalesce(c.name, 'Club supprimé'), 'spent', round(sum(u.cost_usd), 4), 'n', count(*) filter (where u.ok), 'cap', round(ai_club_cap(u.club_id), 2)) x
      from ai_usage u left join clubs c on c.id = u.club_id where u.at >= ai_season_start() group by u.club_id, c.name order by sum(u.cost_usd) desc limit 10) t), '[]'::jsonb)
  ) into r;
  return r;
end $$;
revoke execute on function admin_ai_stats() from public, anon;
grant execute on function admin_ai_stats() to authenticated;

create or replace function admin_ai_credit(p_amount numeric, p_note text default '') returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000 then raise exception 'Montant entre 0,01 et 1 000 $'; end if;
  insert into ai_credit(amount_usd, note, admin_id) values (round(p_amount, 2), left(coalesce(p_note, ''), 200), auth.uid());
  perform admin_note('crédit IA ajouté', null, jsonb_build_object('montant_usd', round(p_amount, 2)));
end $$;
revoke execute on function admin_ai_credit(numeric, text) from public, anon;
grant execute on function admin_ai_credit(numeric, text) to authenticated;

create or replace function admin_ai_settings(p_enabled boolean, p_alert numeric, p_cap numeric, p_per_day int) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_app_admin() then raise exception 'Réservé à l''administrateur'; end if;
  update ai_settings set enabled = coalesce(p_enabled, enabled), alert_usd = coalesce(p_alert, alert_usd),
    club_cap_usd = coalesce(p_cap, club_cap_usd), per_day = coalesce(p_per_day, per_day) where id = 1;
  perform admin_note('réglages IA', null, jsonb_build_object('actif', p_enabled, 'alerte', p_alert, 'budget_club', p_cap, 'par_jour', p_per_day));
end $$;
revoke execute on function admin_ai_settings(boolean, numeric, numeric, int) from public, anon;
grant execute on function admin_ai_settings(boolean, numeric, numeric, int) to authenticated;

select close_visitor_functions();
