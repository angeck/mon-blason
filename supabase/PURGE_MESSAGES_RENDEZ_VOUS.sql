-- PURGE_MESSAGES_RENDEZ_VOUS.sql · mypocketclub · alpha 3.9.0 · n° 110 (décisions de Gaël, 3 novembre 2026)
-- À lancer UNE fois dans Supabase > SQL Editor > Run, après MAJ_ALPHA_3_9_0.sql, avant l'arrivée des vrais clubs.
-- ATTENTION : efface pour de bon. Rien ne se rattrape après. Relançable sans risque (la seconde fois, tout est à zéro).
--
-- PART :
--   · tous les rendez-vous (matchs, plateaux, tournois, entraînements, événements, réunions, AG) et toutes les séries d'entraînements,
--     avec les réponses, les appels, les rendez-vous masqués, les missions de bénévoles et les inscriptions,
--     les séances préparées par les coachs pour un rendez-vous ;
--   · les heures des coachs (heures notées, relevés du mois, demandes de vérification et confirmations) ;
--   · tous les messages : groupes d'échange, messages, sondages et votes, annonces et lectures, pièces jointes ;
--   · toutes les notifications en attente d'envoi.
-- RESTE :
--   · clubs, comptes, équipes (avec leurs créneaux : lieu, jour, horaire), joueurs, fiches, parents, coachs, bureau, rôles et fonctions ;
--   · exercices du coach et du club (et leurs vidéos), séances préparées qui ne sont liées à aucun rendez-vous ;
--   · réglages du club, taux horaires des coachs, contacts, documents du club, demandes d'ajout de clubs, journal des actions.
-- Aucune notification « Annulé » n'est envoyée : celles que la suppression crée sont effacées dans la même opération.

create temp table if not exists purge_bilan(ordre int, quoi text, lignes bigint);
truncate purge_bilan;

begin;

-- Ce qui part avec les rendez-vous et les messages (compté avant, car effacé par lien)
insert into purge_bilan values
  (2, 'Réponses aux rendez-vous', (select count(*) from event_responses)),
  (3, 'Appels (présences notées)', (select count(*) from attendance)),
  (4, 'Rendez-vous masqués', (select count(*) from event_hidden)),
  (5, 'Missions de bénévoles', (select count(*) from event_missions)),
  (6, 'Inscriptions aux missions', (select count(*) from mission_signups)),
  (13, 'Messages', (select count(*) from messages)),
  (14, 'Sondages', (select count(*) from polls)),
  (15, 'Votes aux sondages', (select count(*) from poll_votes)),
  (17, 'Lectures des annonces', (select count(*) from announcement_reads));

-- Séances préparées pour un rendez-vous (avant les rendez-vous : le lien serait sinon effacé et la séance resterait orpheline)
with d as (delete from training_plans where event_id is not null returning 1)
insert into purge_bilan select 7, 'Séances préparées liées à un rendez-vous', count(*) from d;

-- Heures des coachs : relevés du mois d'abord (un mois envoyé au bureau bloque la suppression des heures), puis le reste
with d as (delete from coach_statements returning 1) insert into purge_bilan select 8, 'Relevés d''heures des coachs', count(*) from d;
with d as (delete from hours_confirms returning 1) insert into purge_bilan select 9, 'Confirmations d''heures', count(*) from d;
with d as (delete from hours_checks returning 1) insert into purge_bilan select 10, 'Demandes de vérification des heures', count(*) from d;
with d as (delete from coach_hours returning 1) insert into purge_bilan select 11, 'Heures notées par les coachs', count(*) from d;

-- Annonces (y compris celles liées à un rendez-vous) puis rendez-vous et séries
with d as (delete from announcements returning 1) insert into purge_bilan select 16, 'Annonces', count(*) from d;
with d as (delete from events returning 1) insert into purge_bilan select 1, 'Rendez-vous (entraînements compris)', count(*) from d;
with d as (delete from event_series returning 1) insert into purge_bilan select 1, 'Séries d''entraînements', count(*) from d;

-- Messages : les groupes d'échange emportent leurs membres, messages, sondages et votes
with d as (delete from groups returning 1) insert into purge_bilan select 12, 'Groupes d''échange', count(*) from d;

-- Pièces jointes des messages (stockage Supabase « message-files »)
do $$
declare n bigint;
begin
  delete from storage.objects where bucket_id = 'message-files';
  get diagnostics n = row_count;
  insert into purge_bilan values (18, 'Pièces jointes des messages', n);
exception when others then
  insert into purge_bilan values (18, 'Pièces jointes : à vider à la main (Storage > message-files)', 0);
end $$;

-- Notifications en attente (y compris celles que les suppressions viennent de créer)
with d as (delete from push_queue returning 1) insert into purge_bilan select 19, 'Notifications en attente', count(*) from d;

commit;

-- Bilan : ce qui est parti, puis ce qui reste (doit être inchangé)
select quoi as "Effacé ou restant", lignes from (
  select ordre, quoi, sum(lignes) as lignes from purge_bilan group by ordre, quoi
  union all select 101, '— reste : équipes (avec leurs créneaux)', count(*) from teams
  union all select 102, '— reste : joueurs', count(*) from players
  union all select 103, '— reste : membres (rôles)', count(*) from memberships
  union all select 104, '— reste : exercices', count(*) from exercises
  union all select 105, '— reste : séances non liées à un rendez-vous', count(*) from training_plans
) b order by ordre, quoi;
