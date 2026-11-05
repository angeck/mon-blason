-- VALIDER_CLUBS_DE_TEST.sql · mypocketclub · alpha 4.3.0 · n° 124
-- BASE DE TEST SEULEMENT (décision de Gaël, 5 novembre 2026) : valide d'office les présidents de Boissy et de Lardy,
-- pour que ces deux clubs de test continuent d'envoyer leurs convocations. Ne jamais le lancer sur une vraie base :
-- sur la vraie base, chaque président est validé par l'administrateur (Mon compte › Administration › Clubs à valider).
-- À lancer une fois, APRÈS MAJ_ALPHA_4_3_0.sql. Sans perte, relançable.
insert into sender_validations(club_id, user_id, reason, note)
select m.club_id, m.user_id, 'test', 'Base de test : validé d''office le 5 novembre 2026'
from memberships m join clubs c on c.id = m.club_id
where m.role = 'president' and m.status = 'active' and c.deleted_at is null
  and (c.name ilike '%boissy%' or c.name ilike '%lardy%')
on conflict (club_id, user_id) do nothing;
select c.name as club, coalesce(p.full_name, '?') as president, v.reason as motif
from sender_validations v join clubs c on c.id = v.club_id left join profiles p on p.id = v.user_id
order by c.name;
