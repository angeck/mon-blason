-- MAJ_ALPHA_5_17_0.sql · mypocketclub · n° 256 (e-mails), n° 254 (gymnases du club), n° 257 (prévenir quand une demande est validée)
-- À lancer une fois dans Supabase › SQL Editor › Run, sur les DEUX bases (test et vrai site). Sans perte de données, relançable sans risque.
-- À lancer JUSTE APRÈS la mise en ligne du code 5.17.0, puis redéployer envoyer-email et recommander-club sur les deux projets.

-- ---------- n° 256 · « Elle remplace la pré-convocation envoyée précédemment » ----------
-- L'adresse du contact n'est jamais gardée (décision du 5 novembre 2026) : on compare le contact masqué (« Jean D. · j***@club.fr »)
-- d'une pré-convocation du même club et du même week-end, bien partie par e-mail. Seule la personne qui envoie peut demander.
create or replace function convocation_had_pre(p_send uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s convocation_sends;
begin
  select * into s from convocation_sends where id = p_send;
  if s.id is null or s.sent_by is distinct from auth.uid() or s.channel <> 'email' or s.step <> 'C' or coalesce(s.target_hint, '') = '' then return false; end if;
  return exists(select 1 from convocation_sends p where p.club_id = s.club_id and p.step = 'P' and p.channel = 'email'
    and p.status in ('envoye', 'lu') and p.ref = regexp_replace(s.ref, '-C$', '-P') and p.target_hint = s.target_hint);
end $$;
revoke execute on function convocation_had_pre(uuid) from public, anon;
grant execute on function convocation_had_pre(uuid) to authenticated;

-- ---------- n° 254 · gymnases du club ----------
-- Nom et adresse d'un ou plusieurs gymnases, saisis par le président (ou le bureau) ; lus par tout le club pour remplir le lieu
-- des rendez-vous à domicile. Donnée du club, pas une donnée personnelle.
create table if not exists club_gyms (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  address text not null default '' check (char_length(address) <= 200),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists club_gyms_club on club_gyms(club_id);
alter table club_gyms enable row level security;
revoke all on club_gyms from anon;
drop policy if exists "gymnases lus par le club" on club_gyms;
create policy "gymnases lus par le club" on club_gyms for select using (is_member(club_id));
drop policy if exists "gymnases ajoutés par le bureau" on club_gyms;
create policy "gymnases ajoutés par le bureau" on club_gyms for insert with check (is_board(club_id) and (select count(*) from club_gyms g where g.club_id = club_gyms.club_id) < 20);
drop policy if exists "gymnases modifiés par le bureau" on club_gyms;
create policy "gymnases modifiés par le bureau" on club_gyms for update using (is_board(club_id)) with check (is_board(club_id));
drop policy if exists "gymnases supprimés par le bureau" on club_gyms;
create policy "gymnases supprimés par le bureau" on club_gyms for delete using (is_board(club_id));
grant select, insert, update, delete on club_gyms to authenticated;

-- ---------- n° 257 · prévenir la personne quand sa demande est validée ----------
-- Décision de Gaël (15 novembre 2026) : une notification ; et un e-mail SEULEMENT si aucun de ses appareils n'a les notifications.
-- Deux cas : une adhésion validée par le président ou le bureau ; un président validé par mypocketclub (admin@).
-- Les e-mails attendent dans validation_mails ; l'application de la personne qui valide demande l'envoi juste après
-- (envoyer-email, branche « validated ») ; les adresses ne sont lues que par la fonction, avec la clé du serveur.
create table if not exists validation_mails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  club_id uuid references clubs(id) on delete cascade,
  kind text not null check (kind in ('adhesion', 'club')),
  label text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, club_id, kind, label)
);
alter table validation_mails enable row level security;
revoke all on validation_mails from anon, authenticated;

create or replace function notify_validated(u uuid, c uuid, p_kind text, p_label text) returns void
language plpgsql security definer set search_path = public as $$
declare cn text;
begin
  select name into cn from clubs where id = c;
  if p_kind = 'club' then
    perform push_enqueue(u, 'Ton club est validé', coalesce(cn, 'Ton club') || ' est validé par mypocketclub : tout est ouvert', 'validation', 'clubok:' || c || ':' || u);
  else
    perform push_enqueue(u, 'Demande validée', 'Bienvenue à ' || coalesce(cn, 'ton club') || ' · ' || p_label, 'validation', 'joinok:' || c || ':' || u || ':' || p_label);
  end if;
  if not exists(select 1 from push_subscriptions s where s.user_id = u) then
    insert into validation_mails(user_id, club_id, kind, label) values (u, c, p_kind, left(coalesce(p_label, ''), 80)) on conflict do nothing;
  end if;
end $$;
revoke execute on function notify_validated(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function memberships_validated_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare lab text;
begin
  if old.status = 'pending' and new.status = 'active' and new.user_id is distinct from auth.uid() then
    lab := case new.role when 'president' then 'Président' when 'bureau' then 'Bureau' when 'coach' then 'Coach' when 'joueur' then 'Joueur'
      when 'parent' then 'Parent de joueur' when 'supporteur' then 'Supporteur' else initcap(new.role) end
      || coalesce(' · ' || (select t.name from teams t where t.id = new.team_id), '');
    perform notify_validated(new.user_id, new.club_id, 'adhesion', lab);
  end if;
  return new;
end $$;
drop trigger if exists memberships_validated_notify on memberships;
create trigger memberships_validated_notify after update of status on memberships for each row execute function memberships_validated_notify();

create or replace function sender_validations_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_validated(new.user_id, new.club_id, 'club', 'Président');
  return new;
end $$;
drop trigger if exists sender_validations_notify on sender_validations;
create trigger sender_validations_notify after insert on sender_validations for each row execute function sender_validations_notify();

-- Remis une seule fois, 20 au plus par appel, dans la limite du jour (90 e-mails sur les 100 de Resend)
create or replace function validation_mails_take() returns table(id uuid, kind text, club text, label text, email text, first_name text)
language plpgsql security definer set search_path = public as $$
declare room int := greatest(0, 90 - mails_today());
begin
  delete from validation_mails v where v.sent_at is null and v.created_at < now() - interval '7 days';   -- trop vieux : la personne a rouvert l'application
  return query
    with due as (
      update validation_mails v set sent_at = now()
      where v.id in (select x.id from validation_mails x where x.sent_at is null
                     and not exists(select 1 from push_subscriptions s where s.user_id = x.user_id)
                     order by x.created_at limit least(20, room))
      returning v.id, v.kind, v.club_id, v.label, v.user_id)
    select due.id, due.kind, coalesce(c.name, '')::text, due.label, lower(u.email)::text, coalesce(pr.first_name, '')::text
    from due join auth.users u on u.id = due.user_id left join clubs c on c.id = due.club_id left join profiles pr on pr.id = due.user_id
    where u.email is not null and not mail_blocked(lower(u.email));
end $$;
revoke execute on function validation_mails_take() from public, anon, authenticated;
do $$ begin grant execute on function validation_mails_take() to service_role; exception when undefined_object then null; end $$;

-- ---------- compteur des e-mails : types « recommandation » (oubli de la 5.12.0 : ces e-mails n'étaient pas comptés) et « validation » (n° 257) ----------
alter table mail_log drop constraint if exists mail_log_kind_check;
alter table mail_log add constraint mail_log_kind_check check (kind in ('test', 'nouvel_appareil', 'invitation_parent', 'rappel_validation', 'attestation',
  'prevenance_inactif', 'information', 'recommandation', 'validation'));

select close_visitor_functions();
