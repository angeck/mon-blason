#!/usr/bin/env python3
"""Mon Blason · tests automatiques « vie de club ».

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
w("grant usage on schema tests to authenticated; grant execute on all functions in schema tests to authenticated;")
w("grant usage on schema public, auth to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;")
w("revoke select on profiles from authenticated; grant select (id, full_name, first_name, last_name, nickname, palette, created_at, show_all_club) on profiles to authenticated;")
w("revoke execute on function activate_membership(uuid, uuid, uuid) from authenticated;")

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
w("reset role; insert into tests.kv select 'code1', join_code from clubs where name = 'AS Test Basket'; insert into tests.kv select 't_' || name, id::text from teams where club_id = (select id from clubs where name = 'AS Test Basket'); set role authenticated;")
T = lambda t: f"(select v::uuid from tests.kv where k = 't_{t}')"
CODE = "(select v from tests.kv where k = 'code1')"
AS("pres2")
w("select create_club('Volley Test', 'Ailleurs', 'Volley-ball', '#0F1A3A', '#FF5B14') as c2 \\gset")
w("select join_code as code2 from clubs where id = :'c2' \\gset")
w("insert into teams(club_id, name) values (:'c2', '4x4 mixte');")

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
        AS(f"pa{fi}"); w(f"select join_club(:'code', 'parent', {T(kt)}, null, {q(kf)}, {q(kl)});")
        first_parent_of[kk] = f"pa{fi}"
        if fi < 15:
            AS(f"pb{fi}"); w(f"select join_club(:'code', 'parent', {T(kt)}, null, {q(kf)}, {q(kl)});")
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
AS("cU9"); w(f"select join_club(:'code', 'parent', {T('U9')}, null, {q(u9kid[1])}, {q(u9kid[2])});")
AS("cU11"); w(f"select join_club(:'code', 'parent', {T('U13F')}, null, {q(u13kid[1])}, {q(u13kid[2])});")
AS("cU13F"); w(f"select validate_membership(m.id, null, (select id from players where first_name = {q(u13kid[1])} and last_name = {q(u13kid[2])})) from memberships m where m.role = 'parent' and m.status = 'pending' and m.team_id = {T('U13F')};")
AS("cU9b"); w(f"select validate_membership(m.id, null, (select id from players where first_name = {q(u9kid[1])} and last_name = {q(u9kid[2])})) from memberships m where m.role = 'parent' and m.status = 'pending' and m.team_id = {T('U9')};")
# Supporteurs (accès immédiat) ; un supporteur devient parent ensuite (multi-profils)
for s in range(1, 101):
    AS(f"s{s}"); w("select join_club(:'code', 'supporteur', null, null);")
AS("s1"); w(f"select join_club(:'code', 'parent', {T('U11')}, null, {q(kids[20][1])}, {q(kids[20][2])});")
AS("cU11"); w(f"select validate_membership(m.id, null, (select id from players where first_name = {q(kids[20][1])} and last_name = {q(kids[20][2])})) from memberships m where m.role = 'parent' and m.status = 'pending' and m.team_id = {T('U11')};")
# Compte sur deux clubs
x_kid = kids[3]
AS("x"); w(f"select join_club(:'code', 'parent', {T(x_kid[3])}, null, {q(x_kid[1])}, {q(x_kid[2])});")
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
    w(f"insert into events(club_id, team_id, audience, type, title, starts_at, place, created_by) values (:'c1', {T(t)}, 'team', 'Entraînement', 'Entraînement {t}', now() + interval '2 days', 'Gymnase', auth.uid());")
AS("cU9"); fails("coach U9 ne crée pas pour les U11", f"insert into events(club_id, team_id, audience, type, title, starts_at, created_by) values ((select id from clubs where name = 'AS Test Basket'), (select v::uuid from tests.kv where k = 't_U11'), 'team', 'Match', 'X', now(), auth.uid())")
fails("coach ne crée pas de rendez-vous interne au bureau", "insert into events(club_id, team_id, audience, type, title, starts_at, created_by) values ((select id from clubs where name = 'AS Test Basket'), null, 'board', 'Réunion', 'X', now(), auth.uid())")
fails("coach ne crée pas de rendez-vous « tout le club »", "insert into events(club_id, team_id, audience, type, title, starts_at, created_by) values ((select id from clubs where name = 'AS Test Basket'), null, 'club', 'Événement', 'X', now(), auth.uid())")
w(f"insert into events(club_id, team_id, audience, type, title, starts_at, opponents, created_by) values (:'c1', {T('U9')}, 'team', 'Plateau', 'Plateau U9', now() + interval '4 days', 'Étampes, Arpajon', auth.uid());")
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
ok("supporteur : aucun nom d'enfant dans les adhésions", "not exists(select 1 from memberships where child_first is not null or child_name is not null)")
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
AS("s20"); ok("supporteur voit la fiche des tarifs", "(select count(*) from club_docs) = 1")
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
