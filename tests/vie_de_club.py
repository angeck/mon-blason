#!/usr/bin/env python3
"""Pocket Club · tests automatiques « vie de club ».

Crée un faux club complet (présidente, bureau, coachs, 100 licenciés dont des enfants avec leurs parents,
100 supporteurs, comptes à plusieurs profils, un second club) dans une base PostgreSQL de TEST qui reproduit
Supabase, déroule une saison (demandes, validations, rendez-vous, réponses, appel, groupes, sondages, licences,
tarifs) et vérifie les règles d'accès à chaque étape.

Usage : python3 tests/vie_de_club.py > /chemin/vie_de_club.sql  puis  psql -f vie_de_club.sql
Toutes les personnes sont fictives. Ne jamais lancer ce script sur la base Supabase réelle.
"""
import random

random.seed(7)
U = lambda n: f"00000000-0000-4000-8000-{n:012d}"
PRENOMS = "Lily Mïa Léo Hugo Emma Jade Louis Nina Tom Lina Noah Zoé Adam Rose Paul Inès Jules Alice Sacha Léna Gabin Chloé Nathan Manon Ethan Sarah Théo Eva Lucas Anna Maël Lou Enzo Clara Axel Iris Malo Lisa Yanis Elsa".split()
NOMS = "Martin Bernard Dubois Thomas Robert Richard Petit Durand Leroy Moreau Simon Laurent Lefebvre Michel Garcia David Bertrand Roux Vincent Fournier Morel Girard André Lefèvre Mercier Dupont Lambert Bonnet François Martinez Legrand Garnier Faure Rousseau Blanc Guerin Muller Henry Roussel Nicolas".split()
out = []
w = out.append
n_user = [0]
people = {}  # clé -> (uuid, prénom, nom)


def user(key, first, last):
    n_user[0] += 1
    uid = U(n_user[0])
    people[key] = (uid, first, last)
    w(f"insert into auth.users(id, raw_user_meta_data) values ('{uid}', '{{\"first_name\":\"{first}\",\"last_name\":\"{last}\",\"full_name\":\"{first} {last}\",\"cgu_version\":\"test\"}}');")
    return uid


def q(s):
    return "'" + s.replace("'", "''") + "'"


def AS(key):
    w(f"select set_config('request.uid', '{people[key][0]}', false);")


def ok(name, cond):
    w(f"select tests.ok({q(name)}, ({cond}));")


def fails(name, sql):
    w(f"select tests.fails({q(name)}, {q(sql)});")


def works(name, sql):
    w(f"select tests.works({q(name)}, {q(sql)});")


def section(t):
    w(f"\\echo '··· {t}'")
    w(f"select tests.section({q(t)});")


# ---------- préparation (administrateur de la base de test) ----------
w("\\set ON_ERROR_STOP 0")
w("\\pset tuples_only on")
w("\\pset pager off")
w("drop schema if exists tests cascade; create schema tests;")
w("create table tests.results(n serial primary key, section text, name text, ok boolean, detail text);")
w("create table tests.cur(section text); insert into tests.cur values ('');")
w("create table tests.kv(k text primary key, v text); grant select on tests.kv to authenticated;")
w("""create function tests.section(s text) returns void language sql security definer as $$ update tests.cur set section = s $$;
create function tests.ok(nm text, c boolean) returns void language sql security definer as $$ insert into tests.results(section, name, ok, detail) select section, nm, coalesce(c, false), case when c then '' else 'condition fausse' end from tests.cur $$;
create function tests.log(nm text, o boolean, d text) returns void language sql security definer as $$ insert into tests.results(section, name, ok, detail) select section, nm, o, d from tests.cur $$;
create function tests.fails(nm text, s text) returns void language plpgsql as $$ declare n int; begin execute s; get diagnostics n = row_count;
  if n = 0 and (s ilike 'update%' or s ilike 'delete%' or s ilike 'insert%') then perform tests.log(nm, true, 'aucune ligne touchée'); else perform tests.log(nm, false, 'aurait dû être refusé'); end if;
  exception when others then perform tests.log(nm, true, sqlerrm); end $$;
create function tests.works(nm text, s text) returns void language plpgsql as $$ begin execute s; perform tests.log(nm, true, '');
  exception when others then perform tests.log(nm, false, sqlerrm); end $$;""")
w("grant usage on schema tests to authenticated, anon; grant execute on all functions in schema tests to authenticated, anon; grant select on tests.kv to anon;")
w("grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;")
w("revoke select on profiles from authenticated; grant select (id, full_name, first_name, last_name, nickname, created_at, show_all_club) on profiles to authenticated;")
w("revoke execute on function activate_membership(uuid, uuid, uuid) from authenticated;")
w("grant usage on schema public to anon; grant execute on all functions in schema public to anon; grant select on all tables in schema public to anon; revoke select on profiles from anon;")  # comme Supabase

# ---------- comptes ----------
TEAMS = [("U9", "U9", "Mixte"), ("U11", "U11", "Mixte"), ("U13F", "U13", "Féminine"), ("U15", "U15", "Masculine"),
         ("U17", "U17", "Masculine"), ("Seniors", "Seniors", "Masculine"), ("Loisirs", "Loisirs", "Mixte"), ("Reines", "Seniors", "Féminine")]
user("pres", "Céline", "Présidente")
for i in range(1, 4): user(f"b{i}", ["Marc", "Sonia", "Paul"][i - 1], "Bureau")
for i, (t, _, _) in enumerate(TEAMS): user(f"c{t}", PRENOMS[i], "Coach" + t)
user("cU9b", "Karim", "Assistant")            # coach assistant U9
# Enfants (fiches) et parents
KIDS = {"U9": 15, "U11": 15, "U13F": 14, "U15": 14, "U17": 12}
kids = []  # (clé enfant, prénom, nom, équipe)
k = 0
for t, n in KIDS.items():
    for _ in range(n):
        k += 1
        kids.append((f"k{k}", PRENOMS[k % len(PRENOMS)], NOMS[k % len(NOMS)] + str(k), t))
# Familles : la plupart 1 enfant ; 10 fratries (même parent, deux équipes) ; 15 enfants avec deux parents
families = []
i = 0
while i < len(kids):
    if len(families) < 10 and i + 1 < len(kids) and kids[i][3] != kids[i + 1][3] and False:
        pass
    families.append([kids[i]]); i += 1
# fratries : on regroupe 10 paires d'enfants d'équipes différentes
for j in range(10):
    a, b = families[j], families[-1 - j]
    a.extend(b); families[-1 - j] = []
families = [f for f in families if f]
for fi, fam in enumerate(families):
    last = fam[0][2]
    user(f"pa{fi}", PRENOMS[(fi + 7) % len(PRENOMS)], last)
    if fi < 15: user(f"pb{fi}", PRENOMS[(fi + 13) % len(PRENOMS)], last)   # second parent
# Joueurs adultes (comptes)
ADULTS = {"Seniors": 12, "Loisirs": 10, "Reines": 8}
adults = []
a = 0
for t, n in ADULTS.items():
    for _ in range(n):
        a += 1
        adults.append((f"j{a}", PRENOMS[(a + 3) % len(PRENOMS)], NOMS[(a + 9) % len(NOMS)] + "J" + str(a), t))
        user(f"j{a}", adults[-1][1], adults[-1][2])
for s in range(1, 101): user(f"s{s}", PRENOMS[s % len(PRENOMS)], "Supporteur" + str(s))
user("pres2", "Yves", "PrésidentVolley")
user("x", "Gaëlle", "MultiClub")        # parent au club 1 et joueuse au club 2

w("set role authenticated;")
# ---------- club, équipes ----------
section("Création du club et des équipes")
AS("pres")
w("select create_club('AS Test Basket', 'Testville', 'Basket-ball', '#123A7A', '#E2001A') as c1 \\gset")
w("select join_code as code from clubs where id = :'c1' \\gset")
for t, cat, g in TEAMS:
    w(f"insert into teams(club_id, name, category, gender) values (:'c1', {q(t)}, {q(cat)}, {q(g)});")
ok("8 équipes créées", "(select count(*) from teams where club_id = :'c1') = 8")
ok("3.0.1 · une équipe créée part en mode fantôme", "(select count(*) from teams where club_id = :'c1' and state = 'Fantôme') = 8")
w("update teams set state = 'Visible' where club_id = :'c1';")
w("reset role; insert into tests.kv select 'code1', join_code from clubs where name = 'AS Test Basket'; insert into tests.kv select 't_' || name, id::text from teams where club_id = (select id from clubs where name = 'AS Test Basket'); set role authenticated;")
T = lambda t: f"(select v::uuid from tests.kv where k = 't_{t}')"
CODE = "(select v from tests.kv where k = 'code1')"
AS("pres2")
w("select create_club('Volley Test', 'Ailleurs', 'Volley-ball', '#0F1A3A', '#FF5B14') as c2 \\gset")
w("select join_code as code2 from clubs where id = :'c2' \\gset")
w("insert into teams(club_id, name, state) values (:'c2', '4x4 mixte', 'Visible');")

# ---------- demandes et validations ----------
section("Demandes de rôle et validations")
for i in range(1, 3):
    AS(f"b{i}"); w(f"select join_club(:'code', 'bureau', null, null);")
AS("pres"); w("select validate_membership(id, null, null) from memberships where club_id = :'c1' and role = 'bureau' and status = 'pending';")
AS("b3"); w("select join_club(:'code', 'bureau', null, null);")
AS("b1"); ok("le bureau voit la demande du 3e membre du bureau", "exists(select 1 from memberships where role = 'bureau' and status = 'pending')")
fails("un membre du bureau ne valide pas un autre membre du bureau", "select validate_membership(id) from memberships where role = 'bureau' and status = 'pending'")
AS("pres"); w("select validate_membership(id, null, null) from memberships where club_id = :'c1' and role = 'bureau' and status = 'pending';")
ok("3 membres du bureau validés par la présidente", "(select count(*) from memberships where club_id = :'c1' and role = 'bureau' and status = 'active') = 3")
AS("pres")
for i in range(1, 4):
    for a in ['tresorerie', 'secretariat', 'technique', 'communication', 'evenements']:
        w(f"select set_board_area(:'c1', '{people[f'b{i}'][0]}', '{a}', true);")
for t, _, _ in TEAMS:
    AS(f"c{t}"); w(f"select join_club(:'code', 'coach', {T(t)}, null);")
AS("b1"); w("select validate_membership(id, null, null) from memberships where club_id = :'c1' and role = 'coach' and status = 'pending';")
AS("cU9b"); w(f"select join_club(:'code', 'coach', {T('U9')}, null);")
AS("cU9"); ok("le coach U9 voit la demande de son futur assistant", "exists(select 1 from memberships where role = 'coach' and status = 'pending')")
fails("un coach ne valide pas un autre coach", "select validate_membership(id) from memberships where role = 'coach' and status = 'pending'")
AS("b1"); w("select validate_membership(id, null, null) from memberships where club_id = :'c1' and role = 'coach' and status = 'pending';")
ok("9 coachs validés par le bureau", "(select count(*) from memberships where club_id = :'c1' and role = 'coach' and status = 'active') = 9")
# Présidente aussi coach Seniors (accord immédiat)
AS("pres"); w(f"select join_club(:'code', 'coach', {T('Seniors')}, null);")
ok("la présidente obtient tout de suite un rôle de plus", f"exists(select 1 from memberships where user_id = auth.uid() and role = 'coach' and team_id = {T('Seniors')} and status = 'active')")
fails("même rôle demandé deux fois refusé", f"select join_club({CODE}, 'coach', {T('Seniors')}, null)")

# Parents et enfants
first_parent_of = {}
for fi, fam in enumerate(families):
    for (kk, kf, kl, kt) in fam:
        AS(f"pa{fi}"); w(f"select join_club(:'code', 'parent', {T(kt)}, {q(kf)}, {q(kl)});")
        first_parent_of[kk] = f"pa{fi}"
        if fi < 15:
            AS(f"pb{fi}"); w(f"select join_club(:'code', 'parent', {T(kt)}, {q(kf)}, {q(kl)});")
# Validation par le coach de chaque équipe : premier parent crée la fiche, second parent relié à la fiche existante
# une validation à la fois, comme dans l'application ; le second parent est relié à la fiche existante quand le coach la choisit
for fi, fam in enumerate(families):
    for (kk, kf, kl, kt) in fam:
        for par in ([f"pa{fi}"] + ([f"pb{fi}"] if fi < 15 else [])):
            AS(f"c{kt}")
            link = "null" if par.startswith("pa") or fi == 14 else f"(select id from players where first_name = {q(kf)} and last_name = {q(kl)} limit 1)"
            w(f"select validate_membership((select id from memberships where user_id = '{people[par][0]}' and role = 'parent' and status = 'pending' and child_first = {q(kf)} limit 1), null, {link});")
AS("pres")
ok("second parent validé sans choisir la fiche : pas de doublon", f"(select count(*) from players where first_name = {q(families[14][0][1])} and last_name = {q(families[14][0][2])}) = 1")
ok("70 fiches d'enfants créées (aucun doublon pour les seconds parents)", "(select count(*) from players where club_id = :'c1' and user_id is null) = 70")
ok("25 enfants ont deux parents reliés (ou plus, avec les comptes à plusieurs profils), aucun enfant sans parent", "(select count(*) from (select player_id from player_parents pp join players p on p.id = pp.player_id where p.club_id = :'c1' group by player_id having count(*) >= 2) x) = 25 and not exists(select 1 from players p where p.club_id = :'c1' and p.user_id is null and not exists(select 1 from player_parents pp where pp.player_id = p.id))")
# Joueurs adultes, validés par le bureau ; un membre du bureau joue aussi en Loisirs ; le coach Loisirs est joueur-entraîneur
for (kk, f, l, t) in adults:
    AS(kk); w(f"select join_club(:'code', 'joueur', {T(t)}, null);")
AS("b2"); w(f"select join_club(:'code', 'joueur', {T('Loisirs')}, null);")
AS("cLoisirs"); w(f"select join_club(:'code', 'joueur', {T('Loisirs')}, null);")
AS("b1"); w("select validate_membership(id, null, null) from memberships where club_id = :'c1' and role = 'joueur' and status = 'pending' and user_id <> auth.uid();")
AS("pres"); w("select validate_membership(id, null, null) from memberships where club_id = :'c1' and status = 'pending';")
ok("102 licenciés (70 enfants + 32 adultes) et aucun doublon de fiche", "(select count(*) from players where club_id = :'c1') = 102")
# Le coach U11 est aussi parent d'un enfant en U13F (coach-parent sur une autre équipe) ; le coach U9 parent d'un U9
u9kid = [kd for kd in kids if kd[3] == "U9"][0]
u13kid = [kd for kd in kids if kd[3] == "U13F"][1]
AS("cU9"); w(f"select join_club(:'code', 'parent', {T('U9')}, {q(u9kid[1])}, {q(u9kid[2])});")
AS("cU11"); w(f"select join_club(:'code', 'parent', {T('U13F')}, {q(u13kid[1])}, {q(u13kid[2])});")
AS("cU13F"); w(f"select validate_membership(m.id, null, (select id from players where first_name = {q(u13kid[1])} and last_name = {q(u13kid[2])})) from memberships m where m.role = 'parent' and m.status = 'pending' and m.team_id = {T('U13F')};")
AS("cU9b"); w(f"select validate_membership(m.id, null, (select id from players where first_name = {q(u9kid[1])} and last_name = {q(u9kid[2])})) from memberships m where m.role = 'parent' and m.status = 'pending' and m.team_id = {T('U9')};")
# Supporteurs (accès immédiat) ; un supporteur devient parent ensuite (multi-profils)
for s in range(1, 101):
    AS(f"s{s}"); w("select join_club(:'code', 'supporteur', null, null);")
AS("s1"); w(f"select join_club(:'code', 'parent', {T('U11')}, {q(kids[20][1])}, {q(kids[20][2])});")
AS("cU11"); w(f"select validate_membership(m.id, null, (select id from players where first_name = {q(kids[20][1])} and last_name = {q(kids[20][2])})) from memberships m where m.role = 'parent' and m.status = 'pending' and m.team_id = {T('U11')};")
# Compte sur deux clubs
x_kid = kids[3]
AS("x"); w(f"select join_club(:'code', 'parent', {T(x_kid[3])}, {q(x_kid[1])}, {q(x_kid[2])});")
w("select join_club(:'code2', 'joueur', (select id from teams where name = '4x4 mixte'), null);")
AS(f"c{x_kid[3]}"); w(f"select validate_membership(m.id, null, (select id from players where first_name = {q(x_kid[1])} and last_name = {q(x_kid[2])})) from memberships m where m.role = 'parent' and m.status = 'pending' and m.team_id = {T(x_kid[3])};")
AS("pres2"); w("select validate_membership(id, null, null) from memberships where status = 'pending' and club_id = (select id from clubs where name = 'Volley Test');")
AS("pres")
ok("100 supporteurs actifs", "(select count(*) from memberships where club_id = :'c1' and role = 'supporteur' and status = 'active') = 100")
ok("plus aucune demande en attente", "(select count(*) from memberships where club_id = :'c1' and status = 'pending') = 0")
ok("joueurs payants du club = 102 fiches, jamais les parents", "(select count(*) from players where club_id = :'c1') = 102")

# ---------- agenda ----------
section("Agenda : entraînements, matchs, AG, réunions")
for t, _, _ in TEAMS:
    AS(f"c{t}")
    w(f"insert into events(club_id, team_ids, audience, type, title, starts_at, place, created_by) values (:'c1', array[{T(t)}], 'team', 'Entraînement', 'Entraînement {t}', now() + interval '2 days', 'Gymnase', auth.uid());")
AS("cU9"); fails("coach U9 ne crée pas pour les U11", f"insert into events(club_id, team_ids, audience, type, title, starts_at, created_by) values ((select id from clubs where name = 'AS Test Basket'), array[(select v::uuid from tests.kv where k = 't_U11')], 'team', 'Match', 'X', now(), auth.uid())")
fails("coach ne crée pas de rendez-vous interne au bureau", "insert into events(club_id, team_ids, audience, type, title, starts_at, created_by) values ((select id from clubs where name = 'AS Test Basket'), '{}', 'board', 'Réunion', 'X', now(), auth.uid())")
fails("coach ne crée pas de rendez-vous « tout le club »", "insert into events(club_id, team_ids, audience, type, title, starts_at, created_by) values ((select id from clubs where name = 'AS Test Basket'), '{}', 'club', 'Événement', 'X', now(), auth.uid())")
w(f"insert into events(club_id, team_ids, audience, type, title, starts_at, opponents, created_by) values (:'c1', array[{T('U9')}], 'team', 'Plateau', 'Plateau U9', now() + interval '4 days', 'Étampes, Arpajon', auth.uid());")
AS("pres")
w("insert into events(club_id, audience, type, title, starts_at, created_by) values (:'c1', 'club', 'AG', 'Assemblée générale', now() + interval '10 days', auth.uid()), (:'c1', 'board', 'Réunion', 'Réunion de bureau', now() + interval '3 days', auth.uid()), (:'c1', 'board_coaches', 'Réunion', 'Réunion technique', now() + interval '5 days', auth.uid()), (:'c1', 'coaches', 'Réunion', 'Formation des coachs', now() + interval '6 days', auth.uid());")
ok("présidente voit les 13 rendez-vous", "(select count(*) from events where club_id = :'c1') = 13")

section("Qui voit quoi dans l'agenda")
fam_u13 = next(fi for fi, fam in enumerate(families) if len(fam) == 1 and fam[0][3] == "U13F" and fi >= 15)
AS(f"pa{fam_u13}")
ok("famille U13F seule : voit son entraînement, l'AG, rien d'autre", "(select string_agg(title, ',' order by title) from events) = 'Assemblée générale,Entraînement U13F'")
fam_sib = next(fi for fi, fam in enumerate(families) if len(fam) == 2)
t1, t2 = families[fam_sib][0][3], families[fam_sib][1][3]
AS(f"pa{fam_sib}")
ok(f"parent de deux enfants ({t1} et {t2}) voit les deux équipes", f"(select count(*) from events where title in ('Entraînement {t1}', 'Entraînement {t2}')) = 2")
AS("s50")
ok("supporteur : seulement l'AG", "(select string_agg(title, ',') from events) = 'Assemblée générale'")
AS("cU9")
ok("coach U9 : U9, plateau, AG, réunion technique, formation, pas la réunion de bureau", "(select count(*) from events where title in ('Entraînement U9', 'Plateau U9', 'Assemblée générale', 'Réunion technique', 'Formation des coachs')) = 5 and not exists(select 1 from events where title = 'Réunion de bureau')")
ok("coach U9 ne voit pas l'entraînement U15", "not exists(select 1 from events where title = 'Entraînement U15')")
AS("b3")
ok("bureau : voit la réunion de bureau et toutes les équipes", "(select count(*) from events) = 13")
AS("pres2")
ok("président d'un autre club : rien du club 1", "not exists(select 1 from events where title like 'Entraînement%' or title = 'Assemblée générale')")
AS("x")
ok("compte sur deux clubs : voit son équipe du club 1 et pas les autres", f"exists(select 1 from events where title = 'Entraînement {x_kid[3]}') and not exists(select 1 from events where title = 'Réunion de bureau')")

# ---------- réponses ----------
section("Réponses Je viens / Je ne viens pas")
KID = lambda kd: f"(select id from players where first_name = {q(kd[1])} and last_name = {q(kd[2])})"
EV = lambda t: f"(select id from events where title = {q(t)})"
AS("cU9"); fails("coach U9 ne répond pas pour lui-même à l'entraînement U9", f"select respond_event((select id from events where title = 'Entraînement U9'), null, 'oui')")
works("coach U9 répond pour son enfant de l'équipe", f"select respond_event((select id from events where title = 'Entraînement U9'), {KID(u9kid)}, 'oui')")
AS("cLoisirs"); works("joueur-entraîneur Loisirs répond pour lui-même", "select respond_event((select id from events where title = 'Entraînement Loisirs'), null, 'oui')")
AS("s50"); fails("supporteur ne répond pas à un entraînement d'équipe", "select respond_event((select id from events where title = 'Entraînement U9'), null, 'oui')")
two = next(fi for fi, fam in enumerate(families) if fi < 15 and len(fam) == 1)
kd2 = families[two][0]
AS(f"pa{two}"); w(f"select respond_event({EV('Entraînement ' + kd2[3])}, {KID(kd2)}, 'oui');")
AS(f"pb{two}"); w(f"select respond_event({EV('Entraînement ' + kd2[3])}, {KID(kd2)}, 'non');")
ok("deux parents : une seule réponse par enfant, la dernière compte", f"(select count(*) || answer from event_responses where player_id = {KID(kd2)} group by answer) = '1non'")
AS(f"pa{fam_u13}"); fails("un parent ne répond pas pour l'enfant d'une autre famille", f"select respond_event((select id from events where title = 'Entraînement {kd2[3]}'), (select id from players where first_name = {q(kd2[1])} and last_name = {q(kd2[2])}), 'oui')")
fails("insertion directe d'une réponse interdite", "insert into event_responses(event_id, user_id, answer) select id, auth.uid(), 'oui' from events limit 1")
# Beaucoup de familles répondent
for fi, fam in enumerate(families[:40]):
    AS(f"pa{fi}")
    for kd in fam:
        w(f"select respond_event({EV('Entraînement ' + kd[3])}, {KID(kd)}, {q(random.choice(['oui', 'oui', 'oui', 'non']))});")
AS("cU11")
ok("coach U11 voit les réponses de son équipe", f"(select count(*) from event_responses where event_id = {EV('Entraînement U11')}) > 0")
ok("coach U11 ne voit pas les réponses U15", f"(select count(*) from event_responses where event_id = {EV('Entraînement U15')}) = 0")

# ---------- appel ----------
section("Appel et présences")
AS("cU9")
works("coach U9 fait l'appel de son équipe", f"insert into attendance(event_id, player_id, status, marked_by) select {EV('Entraînement U9')}, p.id, 'present', auth.uid() from players p where p.team_id = {T('U9')}")
fails("coach U9 ne pointe pas un joueur U11", f"insert into attendance(event_id, player_id, status, marked_by) select (select id from events where title = 'Entraînement U9'), p.id, 'present', auth.uid() from players p where p.team_id = (select v::uuid from tests.kv where k = 't_U11') limit 1")
fam_u9 = next(fi for fi, fam in enumerate(families) if fi >= 10 and len(fam) == 1 and fam[0][3] == "U9")
AS(f"pa{fam_u9}")
ok("un parent voit la présence de son enfant seulement", "(select count(*) from attendance) = 1")

# ---------- confidentialité ----------
section("Confidentialité des enfants et des téléphones")
w("reset role; update profiles set phone = '0600000000'; set role authenticated;")
AS("s50")
ok("supporteur : aucune fiche joueur visible", "(select count(*) from players) = 0")
ok("supporteur : aucun nom d'enfant dans les adhésions", "not exists(select 1 from memberships where child_first is not null or child_last is not null)")
ok("supporteur : seulement son propre téléphone", "(select count(*) from phones_for(array(select id from profiles))) <= 1")
fails("lecture directe des téléphones interdite", "select phone from profiles limit 1")
AS(f"pa{fam_u13}")
ok("parent : voit la fiche de son enfant, pas les autres", "(select count(*) from players) = 1")
AS("cU15")
ok("coach U15 : voit les fiches U15 seulement", f"(select count(*) from players where team_id <> {T('U15')}) = 0 and (select count(*) from players) > 0")
AS("pres2")
ok("autre club : aucune fiche ni adhésion du club 1", "(select count(*) from players where club_id = (select c.id from clubs c where c.name = 'AS Test Basket')) = 0")

section("Fiche joueur, autorisations, licence et cotisation")
AS(f"pa{fam_u13}")
kd13 = families[fam_u13][0]
works("parent modifie les autorisations de son enfant", f"update players set consents = consents || '{{\"image\":{{\"ok\":true}}}}' where id = {KID(kd13)}")
fails("parent ne change pas l'équipe de son enfant", f"update players set team_id = (select v::uuid from tests.kv where k = 't_U9') where first_name = {q(kd13[1])} and last_name = {q(kd13[2])}")
fails("parent ne modifie pas la licence", f"update player_admin set licence_state = 'Licencié' where player_id = (select id from players where first_name = {q(kd13[1])} and last_name = {q(kd13[2])})")
fails("parent ne modifie pas la fiche d'un autre enfant", f"update players set first_name = 'Pirate' where first_name = {q(kd2[1])} and last_name = {q(kd2[2])}")
AS("b2")
works("bureau saisit licence et cotisation", f"update player_admin set licence_state = 'Licencié', fee_amount = 180, fee_paid = 180 where player_id = {KID(kd13)}")
works("bureau saisit la grille des tarifs", "insert into fee_grid(club_id, category, amount) select id, 'U13', 160 from clubs where name = 'AS Test Basket'")
AS(f"pa{fam_u13}")
fails("parent ne saisit pas la grille des tarifs", "insert into fee_grid(club_id, category, amount) select id, 'U9', 1 from clubs where name = 'AS Test Basket'")
ok("parent voit la licence de son enfant", f"(select licence_state from player_admin where player_id = {KID(kd13)}) = 'Licencié'")

# ---------- messages ----------
section("Groupes, messages et sondages")
AS("cU9")
w("insert into groups(club_id, name, created_by) values (:'c1', 'U9 · Parents et coachs', auth.uid()) returning id as g1 \\gset")
w(f"insert into group_members(group_id, user_id) select :'g1'::uuid, auth.uid() union select :'g1'::uuid, pp.user_id from player_parents pp join players p on p.id = pp.player_id where p.team_id = {T('U9')};")
w("insert into messages(group_id, user_id, body) values (:'g1', auth.uid(), 'Plateau samedi : covoiturage ?');")
w("insert into polls(group_id, question, created_by) values (:'g1', 'Présent au plateau ?', auth.uid()) returning id as poll1 \\gset")
AS(f"pa{fam_u9}")
ok("parent U9 lit le message du groupe", "(select count(*) from messages) = 1")
works("parent U9 vote au sondage", "insert into poll_votes(poll_id, user_id, answer) select id, auth.uid(), 'Présent' from polls limit 1")
fails("parent ne supprime pas le sondage du coach", "select delete_poll(id) from polls limit 1")
AS(f"pa{fam_u13}")
ok("famille U13F ne lit pas le groupe U9", "(select count(*) from messages) = 0")
fails("famille U13F n'écrit pas dans le groupe U9", "insert into messages(group_id, user_id, body) select id, auth.uid(), 'intrus' from groups limit 1")
AS("b1")
ok("un membre du bureau hors du groupe ne lit pas ses messages", "(select count(*) from messages) = 0")
AS("cU9")
works("l'auteur supprime son sondage", "select delete_poll(id) from polls")
ok("le sondage supprimé laisse une trace", "(select count(*) from polls where deleted_by is not null) = 1")

section("Club : code, logo, documents, équipes")
AS("cU9"); fails("coach ne supprime pas une équipe", "delete from teams where name = 'U11'")
fails("coach ne change pas les couleurs du club", "update clubs set color1 = '#000000' where name = 'AS Test Basket'")
AS("b1"); fails("logo sous forme d'adresse internet refusé", "update clubs set logo = 'https://pisteur.example/x.png' where name = 'AS Test Basket'")
works("bureau joint la fiche des tarifs", "insert into club_docs(club_id, kind, file_name, data, uploaded_by) select id, 'tarifs', 'tarifs.pdf', 'data:application/pdf;base64,JVBERi0=', auth.uid() from clubs where name = 'AS Test Basket'")
AS("s20"); ok("3.0.1 · supporteur ne voit pas la fiche des tarifs", "(select count(*) from club_docs) = 0")
fails("supporteur ne joint pas de document", "insert into club_docs(club_id, kind, file_name, data, uploaded_by) select id, 'tarifs', 'x.pdf', 'data:application/pdf;base64,AA==', auth.uid() from clubs limit 1")
AS("pres2"); ok("autre club ne voit pas le document", "(select count(*) from club_docs) = 0")
AS("s99")
for _ in range(11): w("select join_club('ZZZZZZZZ', 'supporteur', null, null);")
fails("après 10 codes faux en une heure, les essais sont bloqués", "select join_club((select 'ZZZZZZZY'), 'supporteur', null, null)")

section("Import d'une liste de joueurs")
AS("cU11")
works("coach U11 importe une liste avec e-mail et téléphone des parents", f"select import_players((select id from clubs where name = 'AS Test Basket'), {T('U11')}, '[{{\"first_name\":\"Anna\",\"last_name\":\"LE BRAS\",\"birth_date\":\"2018-08-16\",\"email\":\"parent.un@exemple.fr\",\"phone\":\"06 11 22 33 44\"}},{{\"first_name\":\"Bruno\",\"last_name\":\"DA SILVA COSTA\",\"birth_date\":\"2018-08-03\"}}]'::jsonb)")
ok("les fiches importées gardent le contact du parent", "exists(select 1 from players where last_name = 'LE BRAS' and parent_email = 'parent.un@exemple.fr' and parent_phone = '06 11 22 33 44')")
fails("coach U11 n'importe pas dans l'équipe U9", f"select import_players((select id from clubs where name = 'AS Test Basket'), {T('U9')}, '[{{\"first_name\":\"X\",\"last_name\":\"Y\"}}]'::jsonb)")
AS("s30"); ok("un supporteur ne voit pas les contacts importés", "not exists(select 1 from players where parent_email is not null)")

# ---------- alpha 3.0 ----------
section("3.0 · Rendez-vous pour plusieurs équipes et personnes choisies")
AS("b1")
works("bureau crée un rendez-vous pour U9 et U11", f"select create_events(jsonb_build_object('club_id', (select id from clubs where name = 'AS Test Basket'), 'audience', 'team', 'team_ids', jsonb_build_array({T('U9')}, {T('U11')}), 'type', 'Événement', 'title', 'Photo U9 et U11', 'starts', jsonb_build_array(now() + interval '8 days')))")
works("bureau convie trois personnes choisies", f"select create_events(jsonb_build_object('club_id', (select id from clubs where name = 'AS Test Basket'), 'audience', 'people', 'people', jsonb_build_array('{people['cU15'][0]}', '{people['j5'][0]}', '{people['s7'][0]}'), 'type', 'Réunion', 'title', 'Commission buvette', 'starts', jsonb_build_array(now() + interval '9 days')))")
AS(f"pa{fam_u9}"); ok("famille U9 voit le rendez-vous U9 et U11", "exists(select 1 from events where title = 'Photo U9 et U11')")
AS("cU11"); ok("coach U11 aussi", "exists(select 1 from events where title = 'Photo U9 et U11')")
AS(f"pa{fam_u13}"); ok("famille U13F ne le voit pas", "not exists(select 1 from events where title = 'Photo U9 et U11')")
AS("s7"); ok("supporteur choisi voit la commission", "exists(select 1 from events where title = 'Commission buvette')")
AS("s8"); ok("supporteur non choisi ne la voit pas", "not exists(select 1 from events where title = 'Commission buvette')")
AS("cU9")
fails("coach U9 ne crée pas pour U9 et U11 (il ne coache pas U11)", f"select create_events(jsonb_build_object('club_id', (select id from clubs where name = 'AS Test Basket'), 'audience', 'team', 'team_ids', jsonb_build_array({T('U9')}, {T('U11')}), 'title', 'X', 'starts', jsonb_build_array(now())))")
fails("coach ne convie pas des personnes choisies", f"select create_events(jsonb_build_object('club_id', (select id from clubs where name = 'AS Test Basket'), 'audience', 'people', 'people', jsonb_build_array('{people['s7'][0]}'), 'title', 'X', 'starts', jsonb_build_array(now())))")
AS("b1")
fails("bureau ne convie pas une personne d'un autre club", f"select create_events(jsonb_build_object('club_id', (select id from clubs where name = 'AS Test Basket'), 'audience', 'people', 'people', jsonb_build_array('{people['pres2'][0]}'), 'title', 'X', 'starts', jsonb_build_array(now())))")

section("3.0 · Suppression d'une série (n° 25) et sélection multiple")
AS("cU15")
works("coach U15 crée une série de 6 séances (3 passées, 3 à venir)", f"select create_events(jsonb_build_object('club_id', (select id from clubs where name = 'AS Test Basket'), 'audience', 'team', 'team_ids', jsonb_build_array({T('U15')}), 'type', 'Entraînement', 'title', 'Série U15', 'series', jsonb_build_object('weekday', 3, 'start_time', '18:00', 'until', (now() + interval '30 days')::date), 'starts', jsonb_build_array(now() - interval '21 days', now() - interval '14 days', now() - interval '7 days', now() + interval '7 days', now() + interval '14 days', now() + interval '21 days')))")
ok("6 séances créées, liées à une même série", "(select count(distinct series_id) || '/' || count(*) from events where title = 'Série U15') = '1/6'")
ok("aucun appel fait : « toutes les séances » annonce les 6", "(select delete_events((select id from events where title = 'Série U15' and starts_at > now() order by starts_at limit 1), 'series', true)) = 6")
w("insert into attendance(event_id, player_id, status, marked_by) select (select id from events where title = 'Série U15' order by starts_at limit 1), p.id, 'present', auth.uid() from players p where p.team_id = (select v::uuid from tests.kv where k = 't_U15') limit 3;")
ok("après un appel passé : seules les 3 séances à venir partent", "(select delete_events((select id from events where title = 'Série U15' and starts_at > now() order by starts_at limit 1), 'series', true)) = 3")
AS(f"pa{fam_u13}"); fails("un parent ne supprime pas la série", "select delete_events((select id from events where title = 'Entraînement U13F'), 'series')")
w("reset role; insert into tests.kv select 'serU15', id::text from events where title = 'Série U15' and starts_at > now() order by starts_at limit 1; insert into tests.kv select 'evU9', id::text from events where title = 'Entraînement U9'; set role authenticated;")
AS("cU9"); fails("coach U9 ne supprime pas la série U15", "select delete_events((select v::uuid from tests.kv where k = 'serU15'), 'series')")
AS("cU15")
works("coach U15 supprime « toutes les séances à venir »", "select delete_events((select id from events where title = 'Série U15' and starts_at > now() order by starts_at limit 1), 'series')")
ok("les 3 séances passées restent, appel compris", "(select count(*) from events where title = 'Série U15') = 3 and exists(select 1 from attendance a join events e on e.id = a.event_id where e.title = 'Série U15')")
works("coach U15 crée 3 rendez-vous identiques", f"select create_events(jsonb_build_object('club_id', (select id from clubs where name = 'AS Test Basket'), 'audience', 'team', 'team_ids', jsonb_build_array({T('U15')}), 'type', 'Match', 'title', 'Doublon U15', 'starts', jsonb_build_array(now() + interval '3 days', now() + interval '3 days', now() + interval '3 days')))")
fails("la sélection refuse tout si un rendez-vous n'est pas à lui", "select delete_event_list(array(select id from events where title = 'Doublon U15') || (select v::uuid from tests.kv where k = 'evU9'))")
ok("rien n'a été supprimé", "(select count(*) from events where title = 'Doublon U15') = 3")
works("la sélection multiple supprime les 3 doublons ensemble", "select delete_event_list(array(select id from events where title = 'Doublon U15'))")
ok("les doublons ont disparu", "not exists(select 1 from events where title = 'Doublon U15')")

section("3.0 · Corbeille de 30 jours")
kdT = kids[40]
AS("cU15"); fails("un coach ne met pas une fiche à la corbeille", f"select trash_item('player', {KID(kdT)})")
AS("b2")
w(f"reset role; insert into tests.kv values ('kidT', (select id::text from players where first_name = {q(kdT[1])} and last_name = {q(kdT[2])})); set role authenticated;")
KT = "(select v::uuid from tests.kv where k = 'kidT')"
AS("b2"); works("le bureau met une fiche à la corbeille", f"select trash_item('player', {KT})")
AS(f"c{kdT[3]}"); ok("le coach ne voit plus la fiche", f"not exists(select 1 from players where id = {KT})")
AS("b2"); ok("le bureau la retrouve dans la corbeille", f"exists(select 1 from club_trash((select id from clubs where name = 'AS Test Basket')) where id = {KT} and deleted_by like 'Sonia%')")
AS("s3"); ok("un supporteur ne voit pas la corbeille", "not exists(select 1 from club_trash((select c.id from clubs c where c.name = 'AS Test Basket')))")
fails("on ne met pas à la corbeille en contournant la fonction", f"update players set deleted_at = null where id = {KT}")
AS("b2"); works("le bureau restaure la fiche", f"select restore_item('player', {KT})")
AS(f"c{kdT[3]}"); ok("la fiche revient chez le coach", f"exists(select 1 from players where id = {KT})")
AS("b1"); fails("un membre du bureau ne supprime pas une équipe", f"select trash_item('team', {T('Reines')})")
AS("pres"); works("la présidente met l'équipe Reines à la corbeille", f"select trash_item('team', {T('Reines')})")
AS("cReines"); ok("le coach Reines n'a plus de droit sur l'équipe", f"not coaches_team({T('Reines')})")
AS("b1"); works("le bureau restaure l'équipe", f"select restore_item('team', {T('Reines')})")
AS("cReines"); ok("le coach Reines retrouve son équipe", f"coaches_team({T('Reines')})")
w(f"reset role; select set_config('request.uid', '', false); update players set deleted_at = now() - interval '31 days' where first_name = {q(kids[41][1])} and last_name = {q(kids[41][2])}; set role authenticated;")
AS("s3"); works("l'effacement des plus de 30 jours tourne", "select purge_trash()")
w("reset role;")
ok("une fiche de plus de 30 jours est effacée définitivement", f"not exists(select 1 from players where first_name = {q(kids[41][1])} and last_name = {q(kids[41][2])})")
w("set role authenticated;")

section("3.0 · Mes données et suppression du compte")
AS(f"pa{fam_u9}")
ok("« Télécharger mes données » contient profil, enfant, réponses", "(select export_my_data() ? 'profil' and jsonb_array_length(export_my_data()->'fiches_joueurs') = 1 and (export_my_data()->'profil'->>'phone') is not null)")
AS("pres"); fails("la seule présidente ne peut pas supprimer son compte", "select delete_my_account()")
AS("s9"); works("un supporteur demande la suppression de son compte", "select delete_my_account()")
AS("b1"); ok("il disparaît aussitôt des membres du club", f"not exists(select 1 from memberships where user_id = '{people['s9'][0]}')")
AS("s9"); fails("il ne peut plus rejoindre un club pendant la suppression", f"select join_club({CODE}, 'supporteur', null)")
works("il peut annuler pendant 30 jours", "select cancel_account_deletion()")
ok("son profil de supporteur revient", "exists(select 1 from memberships where user_id = auth.uid() and role = 'supporteur' and status = 'active')")
works("il redemande la suppression", "select delete_my_account()")
w(f"reset role; select set_config('request.uid', '', false); update profiles set deleted_at = now() - interval '31 days' where id = '{people['s9'][0]}'; select purge_trash(); set role authenticated;")
w("reset role;")
ok("après 30 jours, le compte est effacé", f"not exists(select 1 from auth.users where id = '{people['s9'][0]}') and not exists(select 1 from profiles where id = '{people['s9'][0]}')")
w("set role authenticated;")

section("3.0 · En-tête aux couleurs du club")
AS("b1"); fails("le bureau n'active pas l'en-tête aux couleurs du club", "update clubs set custom_header = true where name = 'AS Test Basket'")
AS("pres"); works("la présidente l'active", "update clubs set custom_header = true where name = 'AS Test Basket'")
AS("b1"); works("le bureau change toujours les couleurs", "update clubs set color1 = '#123A7A' where name = 'AS Test Basket'")
fails("le code du club ne se modifie pas", "update clubs set join_code = 'AAAAAAAA' where name = 'AS Test Basket'")

section("3.0.1 · Équipe fantôme jusqu'à validation (n° 29)")
AS("b1"); w("insert into teams(club_id, name, category) select id, 'U7', 'U7 (baby)' from clubs where name = 'AS Test Basket';")
w("reset role; insert into tests.kv select 't_U7', id::text from teams where name = 'U7'; set role authenticated;")
AS("b1"); w(f"select set_team_coach({T('U7')}, '{people['cU9b'][0]}', false);")
ok("la nouvelle équipe est fantôme", f"(select state from teams where id = {T('U7')}) = 'Fantôme'")
AS("s40"); ok("un supporteur ne voit pas l'équipe fantôme", f"not exists(select 1 from teams where id = {T('U7')})")
AS(f"pa{fam_u13}"); ok("une famille ne la voit pas", f"not exists(select 1 from teams where id = {T('U7')})")
AS("cU9b"); ok("son coach la voit", f"exists(select 1 from teams where id = {T('U7')})")
works("son coach la rend visible", f"update teams set state = 'Visible' where id = {T('U7')}")
AS("s40"); ok("elle devient visible des membres", f"exists(select 1 from teams where id = {T('U7')})")

section("3.0.1 · Tarifs réservés au bureau (n° 39)")
AS("cU9"); ok("un coach ne lit pas la grille des tarifs", "(select count(*) from fee_grid) = 0")
ok("un coach ne lit pas le document des tarifs", "(select count(*) from club_docs) = 0")
AS(f"pa{fam_u13}"); ok("un parent ne lit pas la grille", "(select count(*) from fee_grid) = 0")
AS("s40"); ok("un supporteur ne lit pas la grille", "(select count(*) from fee_grid) = 0")
AS("b3"); ok("le bureau lit la grille", "(select count(*) from fee_grid) >= 1")

section("3.0.1 · Membres visibles selon le rôle (n° 40)")
AS("s40")
ok("supporteur : liste des membres vide", f"(select count(*) from club_roster((select id from clubs where name = 'AS Test Basket'))) = 0")
ok("supporteur : aucun autre profil lisible", "(select count(*) from profiles where id <> auth.uid()) = 0")
AS(f"pa{fam_u13}")
ok("parent U13F : liste limitée à son équipe", f"not exists(select 1 from club_roster((select id from clubs where name = 'AS Test Basket')) where team_id is distinct from {T('U13F')})")
ok("parent U13F : les autres joueuses en « Prénom N. »", f"exists(select 1 from club_roster((select id from clubs where name = 'AS Test Basket')) where kind = 'joueur' and last_name like '_.')")
ok("parent U13F : voit le nom de sa coach", f"exists(select 1 from profiles where id = '{people['cU13F'][0]}')")
ok("parent U13F : ne voit pas le nom d'un parent U9", f"not exists(select 1 from profiles where id = '{people['pa' + str(fam_u9)][0]}')")
AS("cU9"); ok("coach U9 : aucun joueur U15 dans la liste", f"not exists(select 1 from club_roster((select id from clubs where name = 'AS Test Basket')) where team_id = {T('U15')})")
AS("b2"); ok("bureau : tout le club", f"(select count(*) from club_roster((select id from clubs where name = 'AS Test Basket')) where kind = 'joueur') >= 100")
AS("s40"); ok("supporteur : liste des équipes sans nombres", "(select count(*) from club_teams((select id from clubs where name = 'AS Test Basket')) where players is not null or coaches is not null) = 0 and (select count(*) from club_teams((select id from clubs where name = 'AS Test Basket'))) >= 8")
AS(f"pa{fam_u13}"); ok("parent : nombres de son équipe seulement", f"(select players from club_teams((select id from clubs where name = 'AS Test Basket')) where id = {T('U13F')}) > 0 and (select players from club_teams((select id from clubs where name = 'AS Test Basket')) where id = {T('U9')}) is null")

section("3.0.1 · Suivre une équipe (n° 41)")
AS("s40")
works("un supporteur suit l'équipe U9", f"insert into team_follows(user_id, team_id) values (auth.uid(), {T('U9')})")
ok("il voit le plateau U9", "exists(select 1 from events where title = 'Plateau U9')")
ok("il ne voit pas l'entraînement U9", "not exists(select 1 from events where title = 'Entraînement U9')")
fails("il ne répond pas au plateau", "select respond_event((select id from events where title = 'Plateau U9'), null, 'oui')")
w("reset role; update teams set state = 'Fantôme' where name = 'U7'; set role authenticated;")
AS("s40"); fails("on ne suit pas une équipe fantôme", f"insert into team_follows(user_id, team_id) values (auth.uid(), {T('U7')})")
works("il arrête de suivre", f"delete from team_follows where team_id = {T('U9')}")
ok("le plateau disparaît", "not exists(select 1 from events where title = 'Plateau U9')")

section("3.0.1 · Fiches en pyramide et journal (n° 32)")
w("reset role; insert into tests.kv select 'pl_b2', id::text from players where user_id = (select id from auth.users where id = '" + people['b2'][0] + "'); set role authenticated;")
PB2 = "(select v::uuid from tests.kv where k = 'pl_b2')"
AS("b1"); fails("un membre du bureau ne modifie pas la licence d'un autre membre du bureau", f"update player_admin set licence_state = 'Licencié' where player_id = {PB2}")
AS("pres"); works("la présidente le peut", f"update player_admin set licence_state = 'Licencié' where player_id = {PB2}")
AS("b1"); works("le bureau modifie la fiche d'un coach", f"select update_member_profile((select id from clubs where name = 'AS Test Basket'), '{people['cU15'][0]}', 'Lina', 'CoachU15', '0600000001')")
fails("le bureau ne modifie pas la fiche d'un autre membre du bureau", f"select update_member_profile((select id from clubs where name = 'AS Test Basket'), '{people['b2'][0]}', 'X', 'Y', null)")
fails("le bureau ne modifie pas la fiche de la présidente", f"select update_member_profile((select id from clubs where name = 'AS Test Basket'), '{people['pres'][0]}', 'X', 'Y', null)")
AS("cU9"); fails("un coach ne modifie pas la fiche d'un autre coach", f"select update_member_profile((select id from clubs where name = 'AS Test Basket'), '{people['cU11'][0]}', 'X', 'Y', null)")
AS("b1"); ok("le bureau ne lit pas le journal", "(select count(*) from action_log) = 0")
AS("pres"); ok("la présidente lit le journal des modifications", "(select count(*) from action_log where action = 'fiche du membre modifiée') = 1 and (select count(*) from action_log where action like 'player_admin%') >= 1")

section("3.0.1 · Montant dû calculé et versements (n° 33)")
AS("b2")
ok("montant dû calculé d'après la grille (U13 : 160 €)", f"(select fee_amount from player_admin where player_id = {KID(kd13)}) = 160")
works("le bureau ajoute une réduction de 20 €", f"insert into player_discount(player_id, amount, reason) values ({KID(kd13)}, 20, 'fratrie') on conflict (player_id) do update set amount = 20")
ok("montant dû recalculé : 140 €", f"(select fee_amount from player_admin where player_id = {KID(kd13)}) = 140")
works("le bureau ajoute un versement de 60 €", f"insert into player_payments(player_id, amount, method, created_by) values ({KID(kd13)}, 60, 'Chèque', auth.uid())")
ok("déjà réglé : 60 €", f"(select fee_paid from player_admin where player_id = {KID(kd13)}) = 60")
works("pastille « Payé » validée à la main", f"select mark_paid({KID(kd13)}, true)")
ok("déjà réglé mis au montant dû", f"(select fee_paid = fee_amount from player_admin where player_id = {KID(kd13)})")
AS(f"pa{fam_u13}"); fails("un parent n'ajoute pas de versement", f"insert into player_payments(player_id, amount, created_by) values ({KID(kd13)}, 10, auth.uid())")
ok("un parent voit les versements de son enfant", f"(select count(*) from player_payments where player_id = {KID(kd13)}) = 2")

section("3.0.1 · Import de la grille : remplacement des prix (n° 38)")
AS("b2")
works("import : U13 passe à 170 €, U9 ajouté", "select import_fee_grid((select id from clubs where name = 'AS Test Basket'), '2026-2027', '[{\"category\":\"U13\",\"amount\":170},{\"category\":\"U9\",\"amount\":120}]'::jsonb, false)")
ok("le prix U13 est remplacé", "(select amount from fee_grid where category = 'U13') = 170")
ok("un joueur U13 non payé passe à 170 €", f"exists(select 1 from player_admin a join players x on x.id = a.player_id where x.team_id = {T('U13F')} and x.id <> {KID(kd13)} and a.fee_amount = 170)")
ok("le joueur déjà payé garde son montant", f"(select fee_amount from player_admin where player_id = {KID(kd13)}) = 140")
AS("cU9"); fails("un coach n'importe pas de grille", "select import_fee_grid((select id from clubs where name = 'AS Test Basket'), '2026-2027', '[]'::jsonb, false)")

section("3.0.1 · Messages non lus et contacts du club (n° 36, 42)")
AS(f"pa{fam_u9}"); works("un membre marque son groupe comme lu", "update group_members set last_read_at = now() where user_id = auth.uid()")
AS("b1"); works("un membre du bureau se déclare contact licences avec son téléphone", "insert into club_contacts(club_id, user_id, for_licence, show_phone) select id, auth.uid(), true, true from clubs where name = 'AS Test Basket'")
AS("s40"); fails("un supporteur ne se déclare pas contact", "insert into club_contacts(club_id, user_id, for_licence) select id, auth.uid(), true from clubs where name = 'AS Test Basket'")
ok("un supporteur voit le contact, avec téléphone et sans e-mail", "exists(select 1 from club_contacts_list((select id from clubs where name = 'AS Test Basket')) where kind = 'contact' and for_licence and phone is not null and email is null)")
works("un supporteur écrit au président", "select message_president((select id from clubs where name = 'AS Test Basket'))")
AS("pres"); ok("le message arrive chez la présidente", "exists(select 1 from groups where name like 'Message au président%')")
AS("pres2"); ok("un autre club ne voit pas les contacts", "not exists(select 1 from club_contacts_list((select c.id from clubs c where c.name = 'AS Test Basket')))")

section("3.0.2 · Import dans une équipe fantôme (n° 47)")
AS("cU9b")
works("le coach d'une équipe fantôme importe une liste", f"select import_players((select id from clubs where name = 'AS Test Basket'), {T('U7')}, '[{{\"first_name\":\"Léo\",\"last_name\":\"DURAND\",\"birth_date\":\"2020-03-12\"}},{{\"first_name\":\"Zoé\",\"last_name\":\"MARTIN\",\"birth_date\":null,\"licence\":null,\"email\":null,\"phone\":null}}]'::jsonb)")
ok("les 2 fiches sont dans l'équipe fantôme", f"(select count(*) from players where team_id = {T('U7')}) = 2")

section("3.0.2 · Page publique et recherche de clubs (n° 49)")
ANON = "reset role; select set_config('request.uid', '', false); set role anon;"
w(ANON)
ok("visiteur : trouve le club par son nom", "exists(select 1 from public_search_clubs('test basket', null) where name = 'AS Test Basket')")
ok("visiteur : trouve le club par sa ville, sans accent ni majuscule", "exists(select 1 from public_search_clubs('TESTVILLE', null))")
ok("visiteur : filtre par sport", "not exists(select 1 from public_search_clubs('test', 'Volley-ball') where name = 'AS Test Basket') and exists(select 1 from public_search_clubs('test', 'Volley-ball') where name = 'Volley Test')")
ok("visiteur : la page du club montre les équipes visibles, pas l'équipe fantôme", "(select public_club(id) from public_search_clubs('test basket', null) limit 1)->'teams' @> '[{\"name\":\"U9\"}]' and not ((select public_club(id) from public_search_clubs('test basket', null) limit 1)->'teams' @> '[{\"name\":\"U7\"}]')")
ok("visiteur : aucun nombre, aucune personne, aucun code", "not exists(select 1 from jsonb_object_keys((select public_club(id) from public_search_clubs('test basket', null) limit 1)) k where k in ('join_code','players','members','coach','contacts','events'))")
ok("visiteur : aucun club lisible directement", "(select count(*) from clubs) = 0")
ok("visiteur : aucune équipe, aucun membre, aucun rendez-vous lisibles directement", "(select count(*) from teams) + (select count(*) from memberships) + (select count(*) from events) + (select count(*) from players) + (select count(*) from fee_grid) = 0")
w("set role authenticated;")
AS("b1"); fails("le bureau ne retire pas le club de la recherche", "update clubs set public_listed = false where name = 'AS Test Basket'")
AS("pres"); works("la présidente retire le club de la recherche", "update clubs set public_listed = false where name = 'AS Test Basket'")
w(ANON); ok("le club n'apparaît plus", "not exists(select 1 from public_search_clubs('test basket', null))")
ok("sa page publique est vide", "(select public_club(v::uuid) from tests.kv where k = 'club1id') is null")
w("reset role; insert into tests.kv select 'club1id', id::text from clubs where name = 'AS Test Basket' on conflict do nothing;")
user("nv", "Noé", "Nouveau")
w("set role authenticated;")
AS("nv"); fails("sans recherche, on ne rejoint pas sans le code", "select join_club_by_id((select v::uuid from tests.kv where k = 'club1id'), 'supporteur', null)")
AS("pres"); works("la présidente remet le club dans la recherche", "update clubs set public_listed = true where name = 'AS Test Basket'")
AS("nv"); works("un nouveau compte rejoint le club trouvé, sans le code", "select join_club_by_id((select v::uuid from tests.kv where k = 'club1id'), 'supporteur', null)")
ok("il est supporteur tout de suite", "exists(select 1 from memberships where user_id = auth.uid() and role = 'supporteur' and status = 'active')")
works("il demande à être parent par la même voie", f"select join_club_by_id((select v::uuid from tests.kv where k = 'club1id'), 'parent', {T('U9')}, 'Mia', 'Nouveau')")
ok("la demande de parent attend la validation", "exists(select 1 from memberships where user_id = auth.uid() and role = 'parent' and status = 'pending')")
w(ANON); fails("visiteur : ne rejoint pas sans compte", "select join_club_by_id((select v::uuid from tests.kv where k = 'club1id'), 'supporteur', null)")
for _ in range(30): w("select count(*) from public_search_clubs('zz', null);")
fails("visiteur : plus de 30 recherches par minute bloquées", "select * from public_search_clubs('test', null)")
w("set role authenticated;")

section("3.0.2 · Groupes triés par dernier message (n° 50)")
AS("cU9")
ok("le groupe garde la date de son dernier message", "(select last_message_at from groups where name = 'U9 · Parents et coachs') is not null")
w("insert into groups(club_id, name, created_by) values (:'c1', 'Groupe vide', auth.uid()) returning id as gvide \\gset")
w("insert into group_members(group_id, user_id) values (:'gvide', auth.uid());")
works("un sondage fait remonter le groupe vide", "insert into polls(group_id, question, created_by) select id, 'Covoiturage ?', auth.uid() from groups where name = 'Groupe vide'")
ok("le groupe au dernier message le plus récent est en tête", "(select name from groups order by coalesce(last_message_at, created_at) desc limit 1) = 'Groupe vide'")
ok("aperçu : le dernier message ou sondage de chaque groupe", "(select count(*) from group_previews((select id from clubs where name = 'AS Test Basket'))) = 2 and exists(select 1 from group_previews((select id from clubs where name = 'AS Test Basket')) where kind = 'sondage' and body = 'Covoiturage ?')")
AS(f"pa{fam_u13}"); ok("aperçu : rien des groupes dont on n'est pas membre", "(select count(*) from group_previews((select id from clubs where name = 'AS Test Basket'))) = 0")

section("3.0.2 · Ma fiche n'est pas « mon enfant » (n° 51)")
AS("j2"); w(f"select join_club(:'code', 'parent', {T('Seniors')}, {q(adults[1][1])}, {q(adults[1][2])});")
AS("b1"); w(f"select validate_membership(m.id, null, (select id from players where user_id = '{people['j2'][0]}')) from memberships m where m.user_id = '{people['j2'][0]}' and m.role = 'parent' and m.status = 'pending';")
w("reset role;")
ok("un adulte qui se déclare parent de lui-même n'est pas relié comme parent", f"not exists(select 1 from player_parents pp join players x on x.id = pp.player_id where x.user_id = pp.user_id)")
w("set role authenticated;")

section("3.1 · Banque d'exercices et droits d'auteur")
C1 = "(select id from clubs where name = 'AS Test Basket')"
EX = lambda t: f"(select id from exercises where title = {q(t)})"
AS("cU9")
works("un coach ajoute un exercice privé", f"insert into exercises(club_id, title, category, duration_min, description) values ({C1}, 'Passe et va', 'Technique', 10, 'Deux colonnes, passe puis course.')")
works("un coach partage un exercice au club (case cochée)", f"insert into exercises(club_id, title, sharing, certified, origin) values ({C1}, 'Tirs en ligne', 'club', true, 'perso')")
fails("partage sans certifier ses droits refusé", f"insert into exercises(club_id, title, sharing) values ({C1}, 'Sans case', 'club')")
fails("« adapté d'une source » sans source refusé", f"insert into exercises(club_id, title, origin) values ({C1}, 'Sans source', 'adapte')")
fails("texte avec « tous droits réservés » refusé", f"insert into exercises(club_id, title, description) values ({C1}, 'Copie', 'Extrait du livre X, tous droits réservés')")
fails("texte avec © refusé", f"insert into exercises(club_id, title, source, origin) values ({C1}, 'Copie 2', '© Éditions Y', 'adapte')")
works("un coach propose un exercice à tous les clubs", f"insert into exercises(club_id, title, sharing, certified, origin) values ({C1}, 'Défense 1 contre 1', 'public', true, 'ia')")
ok("un exercice public part en attente de validation", f"(select public_state from exercises where title = 'Défense 1 contre 1') = 'pending'")
fails("le coach ne se valide pas lui-même", f"update exercises set public_state = 'validated' where title = 'Défense 1 contre 1' and public_state <> 'pending'")
ok("l'état public reste « en attente » malgré une écriture directe", f"(select public_state from exercises where title = 'Défense 1 contre 1') = 'pending'")
fails("un coach ne valide pas un exercice public", f"select validate_exercise({EX('Défense 1 contre 1')}, true)")
AS(f"pa{fam_u9}"); fails("un parent n'ajoute pas d'exercice", f"insert into exercises(club_id, title) values ({C1}, 'Parent')")
ok("un parent ne voit pas l'exercice privé du coach", "not exists(select 1 from exercises where title = 'Passe et va')")
AS("cU11")
ok("un autre coach voit l'exercice partagé au club, pas le privé", "exists(select 1 from exercises where title = 'Tirs en ligne') and not exists(select 1 from exercises where title = 'Passe et va')")
fails("un autre coach ne modifie pas l'exercice d'un collègue", "update exercises set title = 'Volé' where title = 'Tirs en ligne'")
AS("pres2")
ok("autre club : l'exercice public en attente n'est pas visible", "not exists(select 1 from exercises where title = 'Défense 1 contre 1')")
fails("autre club : pas de validation d'un exercice d'un autre club", f"select validate_exercise((select id from exercises limit 1), true)")
AS("b1"); works("le bureau du club valide l'exercice public", f"select validate_exercise({EX('Défense 1 contre 1')}, true)")
AS("pres2")
ok("autre club : l'exercice validé apparaît dans la banque libre", "exists(select 1 from exercises where title = 'Défense 1 contre 1' and public_state = 'validated')")
ok("autre club : nom de l'auteur abrégé et club", "(select club_name from exercise_authors(array(select id from exercises where title = 'Défense 1 contre 1'))) = 'AS Test Basket'")
works("un coach d'un autre club donne son avis", f"insert into exercise_votes(exercise_id, user_id, up) values ((select id from exercises where title = 'Défense 1 contre 1'), auth.uid(), false)")
fails("un seul avis par compte", f"insert into exercise_votes(exercise_id, user_id, up) values ((select id from exercises where title = 'Défense 1 contre 1'), auth.uid(), true)")
ok("compteur d'avis tenu par la base", "(select down_count from exercises where title = 'Défense 1 contre 1') = 1")
AS("cU9"); w("update exercises set title = 'Défense 1 contre 1', down_count = 0, up_count = 99 where title = 'Défense 1 contre 1';")
ok("les compteurs ne se modifient pas à la main", "(select up_count = 0 and down_count = 1 from exercises where title = 'Défense 1 contre 1')")
ok("modifier le titre seul garde la validation", "(select public_state from exercises where title = 'Défense 1 contre 1') = 'validated'")
w("update exercises set description = 'Nouvelle version' where title = 'Défense 1 contre 1';")
ok("modifier le contenu repasse en attente de validation", "(select public_state from exercises where title = 'Défense 1 contre 1') = 'pending'")
AS("b1"); w(f"select validate_exercise({EX('Défense 1 contre 1')}, true);")
AS("pres2"); works("un signalement depuis un autre club", f"insert into exercise_reports(exercise_id, reason) values ((select id from exercises where title = 'Défense 1 contre 1'), 'Copié d''un livre')")
ok("signalé : retiré des autres clubs jusqu'à une nouvelle validation", "not exists(select 1 from exercises where title = 'Défense 1 contre 1')")
AS("b1"); ok("le bureau du club voit le signalement", "exists(select 1 from exercise_reports where reason = 'Copié d''un livre')")
AS("cU11"); fails("un autre coach ne supprime pas l'exercice partagé d'un collègue", f"select trash_exercise({EX('Tirs en ligne')})")
AS("b1"); works("le bureau met un exercice partagé à la corbeille", f"select trash_exercise({EX('Tirs en ligne')})")
ok("il apparaît dans la corbeille du club", f"exists(select 1 from club_trash({C1}) where kind = 'exercise')")
works("et se restaure", "select restore_item('exercise', (select id from exercises where title = 'Tirs en ligne'))")
fails("le bureau ne supprime pas l'exercice privé d'un coach", f"select trash_exercise((select id from exercises where title = 'Passe et va'))")

section("3.1 · Séances")
AS("cU9")
works("un coach compose une séance pour son équipe", f"insert into training_plans(club_id, team_id, title, items) values ({C1}, {T('U9')}, 'Séance passe', '[{{\"title\":\"Passe et va\",\"minutes\":10}}]')")
works("et la relie à un entraînement de son équipe", f"update training_plans set event_id = {EV('Entraînement U9')} where title = 'Séance passe'")
w("reset role; insert into tests.kv select 'ev_u15', id::text from events where title = 'Entraînement U15' on conflict do nothing; set role authenticated;"); AS("cU9")
fails("pas à un rendez-vous d'une autre équipe", "update training_plans set event_id = (select v::uuid from tests.kv where k = 'ev_u15') where title = 'Séance passe'")
fails("pas de séance pour une équipe qu'il n'encadre pas", f"insert into training_plans(club_id, team_id, title) values ({C1}, {T('U15')}, 'X')")
AS("cU11"); ok("un coach d'une autre équipe ne voit pas la séance", "not exists(select 1 from training_plans where title = 'Séance passe')")
AS("b2"); ok("le bureau voit la séance", "exists(select 1 from training_plans where title = 'Séance passe')")
AS(f"pa{fam_u9}"); ok("un parent ne voit pas la séance", "not exists(select 1 from training_plans)")

section("3.1 · Statistiques de présence et fiabilité")
w("reset role;")
w(f"insert into events(club_id, team_ids, audience, type, title, starts_at) values ({C1}, array[{T('U9')}], 'team', 'Entraînement', 'Stat U9 passé', now() - interval '3 days');")
w(f"insert into attendance(event_id, player_id, status) select (select id from events where title = 'Stat U9 passé'), p.id, case when row_number() over (order by p.id) = 1 then 'absent' when row_number() over (order by p.id) = 2 then 'retard' else 'present' end from players p where p.team_id = {T('U9')} and p.deleted_at is null;")
w(f"insert into event_responses(event_id, user_id, player_id, answer) select (select id from events where title = 'Stat U9 passé'), '{people['pres'][0]}', p.id, 'oui' from players p where p.team_id = {T('U9')} and p.deleted_at is null order by p.id limit 1;")
w(f"insert into events(club_id, team_ids, audience, type, title, starts_at) values ({C1}, array[{T('U9')}], 'team', 'Entraînement', 'Stat U9 sans appel', now() - interval '2 days');")
w("set role authenticated;")
AS("cU9")
ok("statistiques : une séance pointée par joueur, la séance sans appel ne compte pas", f"(select bool_and(sessions = 1) from team_stats({T('U9')}, current_date - 30, current_date))")
ok("statistiques : un absent, un retard, les autres présents", f"(select sum(absent) = 1 and sum(late) = 1 from team_stats({T('U9')}, current_date - 30, current_date))")
ok("fiabilité : « a dit oui mais absent » compté", f"(select sum(yes_absent) from team_stats({T('U9')}, current_date - 30, current_date)) = 1")
ok("détail par séance pour l'export", f"(select count(distinct event_id) from team_attendance({T('U9')}, current_date - 30, current_date)) = 1")
AS("cU11"); fails("un coach d'une autre équipe n'a pas les statistiques", f"select * from team_stats({T('U9')}, current_date - 30, current_date)")
AS(f"pa{fam_u9}"); fails("un parent n'a pas les statistiques de l'équipe", f"select * from team_stats({T('U9')}, current_date - 30, current_date)")
AS("b3"); works("le bureau a les statistiques", f"select * from team_stats({T('U9')}, current_date - 30, current_date)")

section("3.1 · Heures des coachs")
AS("cU9")
ok("pré-remplissage avec les séances passées de mes équipes", f"(select fill_coach_hours({C1}, current_date - 3)) >= 1")
ok("pas de doublon si on relance", f"(select fill_coach_hours({C1}, current_date - 3)) = 0")
works("le coach ajoute une ligne à la main", f"insert into coach_hours(club_id, team_id, day, minutes, kind, note) values ({C1}, {T('U9')}, current_date - 3, 60, 'Réunion', 'Réunion parents')")
fails("pas d'heures pour une équipe qu'il n'encadre pas", f"insert into coach_hours(club_id, team_id, day, minutes) values ({C1}, {T('U15')}, current_date - 3, 60)")
fails("pas d'heures notées à l'avance", f"insert into coach_hours(club_id, team_id, day, minutes) values ({C1}, {T('U9')}, current_date + 10, 60)")
fails("pas d'heures au nom d'un autre coach", f"insert into coach_hours(club_id, user_id, day, minutes) values ({C1}, '{people['cU11'][0]}', current_date - 3, 60)")
AS("cU11"); ok("un autre coach ne voit pas mes heures", "not exists(select 1 from coach_hours)")
AS(f"pa{fam_u9}"); ok("un parent ne voit aucune heure", "not exists(select 1 from coach_hours)")
AS("cU9"); works("le coach envoie son mois au bureau", f"select submit_coach_month({C1}, current_date - 3)")
fails("mois envoyé : plus de modification", "update coach_hours set minutes = 600 where note = 'Réunion parents'")
fails("mois envoyé : pas de nouvelle ligne", f"insert into coach_hours(club_id, day, minutes) values ({C1}, current_date - 3, 30)")
fails("mois envoyé : pas d'envoi en double", f"select submit_coach_month({C1}, current_date - 3)")
fails("le coach ne valide pas son relevé", "select decide_coach_month((select id from coach_statements limit 1), true)")
fails("écriture directe d'un relevé interdite", f"update coach_statements set status = 'validated'")
AS("b2"); ok("le bureau voit le relevé et les lignes", "exists(select 1 from coach_statements where status = 'submitted') and exists(select 1 from coach_hours where note = 'Réunion parents')")
works("le bureau refuse avec un commentaire", "select decide_coach_month((select id from coach_statements limit 1), false, 'Il manque le match')")
AS("cU9"); works("mois refusé : le coach corrige", "update coach_hours set minutes = 75 where note = 'Réunion parents'")
works("et renvoie", f"select submit_coach_month({C1}, current_date - 3)")
AS("b2"); works("le bureau valide", "select decide_coach_month((select id from coach_statements limit 1), true)")
AS("pres"); ok("validation inscrite au journal des actions", "exists(select 1 from action_log where action = 'relevé d''heures validé')")
AS("pres2"); ok("autre club : aucun relevé visible", "not exists(select 1 from coach_statements)")

section("3.2 · Fonctions du bureau et rubriques (n° 54, 55)")
w("reset role;")
user("b4", "Tess", "Trésorière"); user("b5", "Noé", "Communication"); user("b6", "Ugo", "MembreBureau")
w("set role authenticated;")
AS("b4"); works("candidature au bureau avec une fonction", f"select request_bureau(null, {CODE}, 'Trésorier')")
AS("b5"); works("une demande par fonction (1)", f"select request_bureau(null, {CODE}, 'Chargé de communication')")
works("une demande par fonction (2)", f"select request_bureau(null, {CODE}, 'Responsable événements et buvette')")
fails("même fonction demandée deux fois refusée", f"select request_bureau(null, {CODE}, 'Chargé de communication')")
fails("fonction inconnue refusée", f"select request_bureau(null, {CODE}, 'Président')")
AS("b6"); w(f"select request_bureau(null, {CODE}, 'Membre du bureau');")
AS("b1"); fails("un membre du bureau ne valide pas une candidature au bureau", "select validate_membership(id) from memberships where role = 'bureau' and status = 'pending'")
AS("pres"); w("select validate_membership(id, null, null) from memberships where club_id = :'c1' and role = 'bureau' and status = 'pending';")
ok("4 demandes validées une à une par la présidente", "(select count(*) from memberships where club_id = :'c1' and role = 'bureau' and status = 'active' and fonction <> 'Membre du bureau') = 3")
AS("b5"); w(f"select request_bureau(null, {CODE}, 'Trésorier');")
AS("pres"); fails("un seul trésorier : la seconde candidature ne passe pas", "select validate_membership(id, null, null) from memberships where club_id = (select id from clubs where name = 'AS Test Basket') and role = 'bureau' and status = 'pending'")
w("delete from memberships where club_id = :'c1' and role = 'bureau' and status = 'pending';")
AS("b4"); ok("trésorière : rubrique Trésorerie seulement", "my_areas((select id from clubs where name = 'AS Test Basket')) = array['tresorerie']")
AS("b5"); ok("communication + événements : deux rubriques", "my_areas((select id from clubs where name = 'AS Test Basket')) = array['communication','evenements']")
AS("b6"); ok("« Membre du bureau » : rubrique Commun seulement", "cardinality(my_areas((select id from clubs where name = 'AS Test Basket'))) = 0")
AS("b4"); works("trésorerie : ajoute un tarif", f"insert into fee_grid(club_id, season, category, amount) values ({C1}, '2026-2027', 'Test32', 99)")
ok("trésorerie : voit les tarifs et les cotisations", "exists(select 1 from fee_grid) and exists(select 1 from player_admin)")
fails("trésorerie : ne change pas le blason", f"update clubs set color1 = '#000000' where id = {C1}")
fails("trésorerie : ne crée pas d'équipe", f"insert into teams(club_id, name) values ({C1}, 'Équipe trésor')")
w("reset role;"); user("j9", "Jade", "Candidate"); w("set role authenticated;")
AS("j9"); w(f"select join_club({CODE}, 'joueur', {T('Seniors')}, null);")
AS("b4"); fails("trésorerie : ne valide pas un joueur (secrétariat)", "select validate_membership(id, null, null) from memberships where role = 'joueur' and status = 'pending' limit 1")
AS("b5"); ok("communication : ne voit ni tarifs ni cotisations", "not exists(select 1 from fee_grid) and not exists(select 1 from player_admin) and not exists(select 1 from player_payments)")
works("communication : change les couleurs du club", f"update clubs set color2 = '#FFC93C' where id = {C1}")
fails("communication : n'ajoute pas de tarif", f"insert into fee_grid(club_id, season, category, amount) values ({C1}, '2026-2027', 'X', 1)")
fails("communication : pas de versement", "select mark_paid((select id from players where club_id = (select id from clubs where name = 'AS Test Basket') limit 1), true)")
AS("b6"); ok("membre sans fonction : voit l'agenda du bureau (Commun)", "exists(select 1 from events where title = 'Réunion de bureau')")
ok("membre sans fonction : ni tarifs ni cotisations", "not exists(select 1 from fee_grid) and not exists(select 1 from player_admin)")
fails("membre sans fonction : ne crée pas d'équipe", f"insert into teams(club_id, name) values ({C1}, 'Équipe X')")
AS("b1"); fails("un membre du bureau n'ouvre pas de rubrique", f"select set_board_area({C1}, '{people['b6'][0]}', 'technique', true)")
fails("un membre du bureau n'attribue pas de fonction", f"select set_bureau_fonction({C1}, '{people['b6'][0]}', 'Directeur sportif')")
AS("pres"); works("la présidente ouvre la rubrique Technique au membre sans fonction", f"select set_board_area({C1}, '{people['b6'][0]}', 'technique', true)")
AS("b6"); works("il crée alors une équipe", f"insert into teams(club_id, name) values ({C1}, 'Équipe B6')")
AS("pres"); w(f"select set_board_area({C1}, '{people['b6'][0]}', 'technique', false);")
works("la présidente change la fonction", f"select set_bureau_fonction({C1}, '{people['b6'][0]}', 'Directeur sportif', (select id from memberships where user_id = '{people['b6'][0]}' and role = 'bureau'))")
AS("b6"); ok("directeur sportif : rubrique Technique", "my_areas((select id from clubs where name = 'AS Test Basket')) = array['technique']")
AS("pres"); ok("fonctions et rubriques inscrites au journal", "(select count(*) from club_log((select id from clubs where name = 'AS Test Basket'))) > 0 and exists(select 1 from club_log((select id from clubs where name = 'AS Test Basket')) where action = 'fonction du bureau')")
AS("b1"); ok("journal : rien pour un membre du bureau", "not exists(select 1 from club_log((select id from clubs where name = 'AS Test Basket')))")
AS("cU9"); ok("coach : voit les cotisations de ses joueurs (réglage par défaut)", f"exists(select 1 from player_admin a join players x on x.id = a.player_id where x.team_id = {T('U9')})")
AS("b1"); fails("réglage « le coach voit les cotisations » : président seulement", f"update clubs set coach_sees_fees = false where id = {C1}")
AS("pres"); works("la présidente le désactive", f"update clubs set coach_sees_fees = false where id = {C1}")
AS("cU9"); ok("coach : ne voit plus les cotisations", "not exists(select 1 from player_admin a join players x on x.id = a.player_id where x.user_id is null and not is_parent_of(x.id))")
AS("pres"); w(f"update clubs set coach_sees_fees = true where id = {C1};")

section("3.2 · Convocations et relance")
u13 = [kd for kd in kids if kd[3] == "U13F"]
par = lambda kd: next(f"pa{fi}" for fi, fam in enumerate(families) if kd in fam)
conv = [u13[2], u13[3]]; notconv = u13[4]
AS("cU13F")
works("le coach convoque des joueuses choisies", f"insert into events(club_id, team_ids, audience, type, title, starts_at, convoked, created_by) values ({C1}, array[{T('U13F')}], 'team', 'Match', 'Match U13F convocation', now() + interval '3 days', array[{KID(conv[0])}, {KID(conv[1])}], auth.uid())")
fails("convocation d'une joueuse d'une autre équipe refusée", f"insert into events(club_id, team_ids, audience, type, title, starts_at, convoked, created_by) values ({C1}, array[{T('U13F')}], 'team', 'Match', 'X', now() + interval '3 days', array[(select id from players where team_id = {T('U9')} limit 1)], auth.uid())")
AS(par(notconv)); fails("parent d'une joueuse non convoquée : pas de réponse", f"select respond_event({EV('Match U13F convocation')}, {KID(notconv)}, 'oui')")
AS(par(conv[0])); works("parent d'une joueuse convoquée répond", f"select respond_event({EV('Match U13F convocation')}, {KID(conv[0])}, 'oui')")
AS(par(conv[1])); fails("une famille ne relance pas", f"select remind_event({EV('Match U13F convocation')})")
AS("cU13F"); ok("relance : seulement les familles convoquées sans réponse", f"(select remind_event({EV('Match U13F convocation')})) >= 1")
fails("relance : une fois toutes les 12 heures", f"select remind_event({EV('Match U13F convocation')})")
AS(par(conv[1])); ok("la famille sans réponse reçoit le rappel", "exists(select 1 from announcements where kind = 'relance')")
AS(par(conv[0])); ok("la famille qui a répondu ne le reçoit pas", "not exists(select 1 from announcements where kind = 'relance')")
AS(par(notconv)); ok("la famille non convoquée ne le reçoit pas", "not exists(select 1 from announcements where kind = 'relance')")

section("3.2 · Annonces officielles")
AS("b5"); works("communication : annonce à tout le club", f"insert into announcements(club_id, audience, title, body) values ({C1}, 'club', 'Fête du club', 'Samedi 13 juin au gymnase')")
AS("s50"); ok("un supporteur la voit", "exists(select 1 from announcements where title = 'Fête du club')")
works("et la marque comme lue", "insert into announcement_reads(announcement_id, user_id) select id, auth.uid() from announcements where title = 'Fête du club'")
fails("un supporteur ne publie pas", f"insert into announcements(club_id, audience, title) values ({C1}, 'club', 'Pirate')")
AS("b5"); ok("l'auteur voit qui l'a lue", "(select count(*) from announcement_reads) >= 1")
AS("b4"); fails("trésorerie : pas d'annonce à tout le club", f"insert into announcements(club_id, audience, title) values ({C1}, 'club', 'Non')")
works("tout le bureau : annonce au bureau", f"insert into announcements(club_id, audience, title) values ({C1}, 'board', 'Réunion trésorerie')")
AS("s50"); ok("un supporteur ne voit pas l'annonce du bureau", "not exists(select 1 from announcements where title = 'Réunion trésorerie')")
AS("cU9"); works("coach : annonce à son équipe", f"insert into announcements(club_id, audience, team_ids, title) values ({C1}, 'team', array[{T('U9')}], 'Gourdes U9')")
fails("coach : pas pour une autre équipe", f"insert into announcements(club_id, audience, team_ids, title) values ({C1}, 'team', array[{T('U11')}], 'X')")
fails("coach : pas pour tout le club", f"insert into announcements(club_id, audience, title) values ({C1}, 'club', 'X')")
fails("annonce à des personnes choisies hors relance refusée", f"insert into announcements(club_id, audience, people, title) values ({C1}, 'people', array['{people['s50'][0]}'::uuid], 'X')")
AS(f"pa{fam_u9}"); ok("famille U9 voit l'annonce U9", "exists(select 1 from announcements where title = 'Gourdes U9')")
AS(f"pa{fam_u13}"); ok("famille U13F ne voit pas l'annonce U9", "not exists(select 1 from announcements where title = 'Gourdes U9')")
AS("pres2"); ok("autre club : aucune annonce", "not exists(select 1 from announcements)")
AS("cU9"); works("l'auteur supprime son annonce", "select delete_announcement((select id from announcements where title = 'Gourdes U9'))")
AS(f"pa{fam_u9}"); ok("annonce supprimée : plus visible", "not exists(select 1 from announcements where title = 'Gourdes U9')")

section("3.2 · Bénévoles (n° 53)")
AS("cU13F")
ok("missions par défaut ajoutées au match (4)", f"(select add_default_missions({EV('Match U13F convocation')})) = 4")
ok("pas de doublon si on relance", f"(select add_default_missions({EV('Match U13F convocation')})) = 0")
fails("pas de mission sur un entraînement", f"insert into event_missions(event_id, label, slots) values ({EV('Entraînement U13F')}, 'Buvette', 1)")
MI = lambda l: f"(select id from event_missions where event_id = {EV('Match U13F convocation')} and label = {q(l)})"
AS(par(u13[0])); works("un parent de l'équipe s'inscrit", f"select volunteer({MI('Arbitre')}, true)")
fails("une seule mission par personne et par rendez-vous", f"select volunteer({MI('Buvette')}, true)")
AS(par(u13[1])); works("un second parent prend la 2e place", f"select volunteer({MI('Arbitre')}, true)")
AS(par(u13[2])); fails("mission complète", f"select volunteer({MI('Arbitre')}, true)")
fails("inscription directe interdite", f"insert into mission_signups(mission_id, user_id) values ({MI('Buvette')}, auth.uid())")
AS(f"pa{fam_u9}"); fails("un parent d'une autre équipe ne s'inscrit pas", f"select volunteer((select id from event_missions limit 1), true)")
AS("cU13F"); works("l'organisateur ajoute quelqu'un à une 2e mission", f"select assign_volunteer({MI('Buvette')}, '{people[par(u13[0])][0]}', true)")
ok("relance des missions vides : il manque table de marque, aide, buvette", f"(select remind_missions({EV('Match U13F convocation')})) like '%table de marque%'")
AS(par(u13[3])); ok("la famille reçoit l'annonce « Bénévoles »", "exists(select 1 from announcements where kind = 'missions')")
works("se désinscrire", f"select volunteer({MI('Arbitre')}, false)")
AS("b5"); works("rubrique Événements : gère les missions de tout rendez-vous", f"insert into event_missions(event_id, label, slots) values ({EV('Match U13F convocation')}, 'Photos', 1)")
AS("b4"); fails("trésorerie : ne gère pas les missions", f"insert into event_missions(event_id, label, slots) values ({EV('Match U13F convocation')}, 'Accueil', 1)")
fails("trésorerie : ne change pas les missions par défaut du club", f"update clubs set default_missions = '[]' where id = {C1}")

section("3.2 · Rappel de cotisation (trésorerie)")
fee_kid = u13[5]
w("reset role;"); w(f"update player_admin set fee_amount = 150 where player_id = {KID(fee_kid)}; insert into fee_grid(club_id, season, category, amount) select {C1}, '2026-2027', 'U13', 150 where not exists(select 1 from fee_grid where club_id = {C1} and category = 'U13');"); w("set role authenticated;")
AS("b5"); fails("communication : pas de rappel de cotisation", f"select remind_fee({KID(fee_kid)})")
AS("b4"); ok("trésorerie : rappel envoyé à la famille", f"(select remind_fee({KID(fee_kid)})) >= 1")
fails("un rappel par semaine au plus", f"select remind_fee({KID(fee_kid)})")
AS(par(fee_kid)); ok("la famille voit le rappel", "exists(select 1 from announcements where kind = 'cotisation')")
AS(par(u13[3])); ok("une autre famille ne le voit pas", "not exists(select 1 from announcements where kind = 'cotisation')")

section("3.2 · Accueil multi-clubs")
AS("x"); ok("compte sur deux clubs : un aperçu par club", "(select count(*) from my_clubs_overview()) = 2")
ok("aperçu : prochains rendez-vous et annonces non lues", "(select bool_and(jsonb_typeof(next_events) = 'array') from my_clubs_overview()) and (select max(unread) from my_clubs_overview()) >= 1")

section("Départs et redemandes")
AS("j1"); works("un joueur quitte son profil", "delete from memberships where user_id = auth.uid() and role = 'joueur'")
AS("j1"); works("et peut redemander le même rôle", f"select join_club({CODE}, 'joueur', {T('Seniors')}, null)")
ok("la nouvelle demande est en attente", "exists(select 1 from memberships where user_id = auth.uid() and status = 'pending')")
w("reset role;")

# ---------- rapport ----------
w("\\echo ''")
w("\\echo '========== RAPPORT =========='")
w("select (case when ok then '  ok   ' else '  ÉCHEC' end) || ' · ' || section || ' · ' || name || case when not ok then ' → ' || detail else '' end from tests.results order by n;")
w("select '  ' || count(*) filter (where ok) || ' réussis sur ' || count(*) || ' tests' from tests.results;")
print("\n".join(out))
