-- MAJ_ALPHA_5_13_0.sql · mypocketclub · n° 236 (un seul chemin « recommander mon club », demande anonyme possible) · à lancer une fois dans Supabase › SQL Editor › Run.
-- Sans perte de données, relançable sans risque. À lancer JUSTE APRÈS la mise en ligne du code 5.13.0, puis redéployer la fonction « recommander-club » (le prénom devient facultatif).

-- mypocketclub · alpha 5.13.0 · mise à jour d'une base 5.12.0, sans perte de données, relançable.
--   N° 236 (décision de Gaël du 13 novembre 2026) : un seul chemin pour « recommander mon club ». Quand la personne n'a pas
--   l'e-mail d'un contact, elle décrit le club (nom, ville, sport) et peut ne rien donner d'elle : la demande reste alors
--   anonyme pour le club (l'administrateur la reçoit quand même en notification). Prénom, nom et e-mail deviennent facultatifs
--   dans club_requests ; « consent » vaut « la personne accepte que son nom soit transmis au club ».

alter table club_requests drop constraint if exists club_requests_first_name_check;
alter table club_requests drop constraint if exists club_requests_last_name_check;
alter table club_requests drop constraint if exists club_requests_email_check;
alter table club_requests alter column first_name set default '';
alter table club_requests alter column last_name set default '';
alter table club_requests alter column email set default '';
alter table club_requests add constraint club_requests_first_name_check check (length(first_name) between 0 and 60);
alter table club_requests add constraint club_requests_last_name_check check (length(last_name) between 0 and 60);
alter table club_requests add constraint club_requests_email_check check (length(email) between 0 and 160);

-- p_consent = vrai : la personne donne ses coordonnées (prénom, nom, e-mail obligatoires) ; faux : demande anonyme (aucune coordonnée gardée)
create or replace function request_club(p_first text, p_last text, p_email text, p_club text, p_city text, p_sport text, p_age_ok boolean, p_consent boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ip text := md5(request_ip()); v_share boolean := coalesce(p_consent, false);
  v_email text := case when v_share then lower(trim(coalesce(p_email, ''))) else '' end;
  v_first text := case when v_share then left(trim(coalesce(p_first, '')), 60) else '' end;
  v_last text := case when v_share then left(trim(coalesce(p_last, '')), 60) else '' end;
  v_club text := left(trim(coalesce(p_club, '')), 120); v_city text := left(trim(coalesce(p_city, '')), 80); v_sport text := left(trim(coalesce(p_sport, '')), 40);
  rid uuid; a uuid; who text;
begin
  if v_share and (v_first = '' or v_last = '') then raise exception 'Prénom et nom obligatoires pour donner tes coordonnées'; end if;
  if v_share and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 160) then raise exception 'Adresse e-mail à vérifier'; end if;
  if length(v_club) < 2 then raise exception 'Nom du club obligatoire'; end if;
  if v_city = '' or v_sport = '' then raise exception 'Ville et sport du club obligatoires'; end if;
  if not coalesce(p_age_ok, false) then raise exception 'Moins de 15 ans : un parent fait la demande'; end if;
  if (select count(*) from club_requests where ip_hash = v_ip and created_at > now() - interval '1 day') >= 10
     or (v_share and (select count(*) from club_requests where lower(email) = v_email and created_at > now() - interval '1 day') >= 3) then
    raise exception 'Trop de demandes aujourd''hui. Réessaie demain.';
  end if;
  select id into rid from club_requests
    where ((v_share and lower(email) = v_email) or (not v_share and ip_hash = v_ip and email = ''))
      and norm_name(club_name) = norm_name(v_club) and norm_name(city) = norm_name(v_city) and created_at > now() - interval '30 days'
    order by created_at desc limit 1;
  if rid is not null then return rid; end if;
  insert into club_requests(first_name, last_name, email, club_name, city, sport, age_ok, consent, user_id, ip_hash)
    values (v_first, v_last, v_email, v_club, v_city, v_sport, true, v_share, case when v_share then auth.uid() else null end, v_ip) returning id into rid;
  who := case when v_share then v_first || ' ' || v_last || case when auth.uid() is not null then ' (adhérent)' else ' (visiteur)' end else 'une personne qui reste anonyme' end;
  for a in select user_id from app_admins loop
    perform push_enqueue(a, 'Prise de contact demandée : ' || left(v_club, 50),
      v_club || ' (' || v_city || ', ' || v_sport || ') · demandée par ' || who || '. À toi de contacter le club.',
      'clubreq', 'clubreq:' || rid::text, './');
  end loop;
  return rid;
end $$;
revoke execute on function request_club(text, text, text, text, text, text, boolean, boolean) from public;
grant execute on function request_club(text, text, text, text, text, text, boolean, boolean) to anon, authenticated;

select close_visitor_functions();

select 'mypocketclub alpha 5.13.0 installée' as resultat;
