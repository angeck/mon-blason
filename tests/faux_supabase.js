// Faux client Supabase pour tester les écrans dans un navigateur sans réseau (données fictives, en mémoire).
// Ne vérifie aucun droit : les droits sont testés sur la vraie base par tests/vie_de_club.py.
const uid = () => crypto.randomUUID();
const now = Date.now(), at = (d, h = 18) => { const x = new Date(now + d * 864e5); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const ME = 'u-me', C = 'c-1', T9 = 't-u9', T11 = 't-u11', T13 = 't-u13';
const people = { 'u-me': ['Gaël', 'Test'], 'u-pres': ['Céline', 'Présidente'], 'u-c11': ['Karim', 'Coach'], 'u-p1': ['Nina', 'Parent'], 'u-p2': ['Hugo', 'Parent'], 'u-s1': ['Léa', 'Supportrice'] };
const D = {
  profiles: Object.entries(people).map(([id, [f, l]]) => ({ id, first_name: f, last_name: l, full_name: f + ' ' + l, nickname: null, phone: id === ME ? '06 00 00 00 00' : '06 11 22 33 44', cgu_version: 'alpha-3.0', optin_emails: false, show_all_club: false, deleted_at: null })),
  clubs: [{ id: C, name: 'BC Testville', city: 'Testville', sport: 'Basket-ball', color1: '#C2410C', color2: '#FFC93C', crest_bg: null, logo: null, custom_header: false, join_code: 'AB3CD4EF', created_at: at(-60) }],
  teams: [
    { id: T9, club_id: C, name: 'U9', category: 'U9', gender: 'Mixte', state: 'Visible', season: '2026-2027', slots: 'Mercredi 17 h 30, gymnase', deleted_at: null },
    { id: T11, club_id: C, name: 'U11', category: 'U11', gender: 'Mixte', state: 'Visible', season: '2026-2027', slots: '', deleted_at: null },
    { id: 't-u15', club_id: C, name: 'U15', category: 'U15', gender: 'Masculine', state: 'Visible', season: '2026-2027', slots: 'Jeudi 18 h', deleted_at: null },
    { id: T13, club_id: C, name: 'U13 F', category: 'U13', gender: 'Féminine', state: 'Fantôme', season: '2026-2027', slots: '', deleted_at: null },
  ],
  memberships: [
    { id: 'm1', club_id: C, user_id: ME, role: 'bureau', team_id: null, status: 'active', created_at: at(-50) },
    { id: 'm2', club_id: C, user_id: ME, role: 'coach', team_id: T9, status: 'active', created_at: at(-50), assistant: false },
    { id: 'm3', club_id: C, user_id: ME, role: 'parent', team_id: T11, player_id: 'p-lily', status: 'active', created_at: at(-50) },
    { id: 'm4', club_id: C, user_id: 'u-pres', role: 'president', team_id: null, status: 'active', created_at: at(-60) },
    { id: 'm5', club_id: C, user_id: 'u-c11', role: 'coach', team_id: T11, status: 'active', created_at: at(-40) },
    { id: 'm6', club_id: C, user_id: 'u-p1', role: 'parent', team_id: T9, player_id: 'p-tom', status: 'active', created_at: at(-30) },
    { id: 'm7', club_id: C, user_id: 'u-p2', role: 'parent', team_id: T9, child_first: 'Zoé', child_last: 'Martin', status: 'pending', created_at: at(-1) },
    { id: 'm8', club_id: C, user_id: 'u-s1', role: 'supporteur', team_id: null, status: 'active', created_at: at(-10) },
  ],
  players: [
    { id: 'p-lily', club_id: C, team_id: T11, first_name: 'Lily', last_name: 'Test', birth_date: '2016-03-12', consents: {}, deleted_at: null, created_at: at(-50) },
    { id: 'p-tom', club_id: C, team_id: T9, first_name: 'Tom', last_name: 'Dupont', birth_date: null, consents: { image: { ok: true, at: at(-5) } }, parent_email: 'parent@exemple.fr', parent_phone: '06 12 34 56 78', deleted_at: null, created_at: at(-30) },
    { id: 'p-ana', club_id: C, team_id: T9, first_name: 'Ana', last_name: 'Leroy', birth_date: '2018-07-01', consents: {}, deleted_at: null, created_at: at(-30) },
  ],
  player_parents: [{ player_id: 'p-lily', user_id: ME }, { player_id: 'p-tom', user_id: 'u-p1' }],
  player_admin: [{ player_id: 'p-lily', licence_state: 'Licencié', licence_number: 'VT123456', health_doc: true, fee_amount: 160, fee_paid: 160, fee_method: 'Chèque' }, { player_id: 'p-tom', licence_state: 'Préinscrit club', health_doc: false, fee_amount: 150, fee_paid: 50 }, { player_id: 'p-ana', licence_state: 'Préinscrit fédé', health_doc: true, fee_amount: null, fee_paid: 0 }],
  player_teams: [], player_discount: [], fee_grid: [{ id: 'f1', club_id: C, category: 'U9', amount: 150, fed_part: 45, team_id: null }], club_docs: [],
  event_series: [{ id: 's1', club_id: C }],
  events: [
    { id: 'e1', club_id: C, audience: 'team', team_ids: [T9], people: [], type: 'Entraînement', title: 'Entraînement U9', starts_at: at(1, 17), place: 'Gymnase de Testville', opponents: '', series_id: 's1', cancelled: false, created_by: ME, updated_at: at(-2) },
    { id: 'e1b', club_id: C, audience: 'team', team_ids: [T9], people: [], type: 'Entraînement', title: 'Entraînement U9', starts_at: at(8, 17), place: 'Gymnase de Testville', opponents: '', series_id: 's1', cancelled: false, created_by: ME, updated_at: at(-2) },
    { id: 'e2', club_id: C, audience: 'team', team_ids: [T11], people: [], type: 'Match', title: 'Match contre Val Vert', starts_at: at(3, 10), place: 'Gymnase de Testville', opponents: 'Val Vert', series_id: null, cancelled: false, created_by: 'u-c11', updated_at: at(-2) },
    { id: 'e3', club_id: C, audience: 'club', team_ids: [], people: [], type: 'AG', title: 'Assemblée générale', starts_at: at(10, 19), place: 'Salle des fêtes', opponents: '', series_id: null, cancelled: false, created_by: 'u-pres', updated_at: at(-2) },
    { id: 'e4', club_id: C, audience: 'team', team_ids: [T9, T11], people: [], type: 'Événement', title: 'Photo U9 et U11', starts_at: at(5, 14), place: '', opponents: '', series_id: null, cancelled: false, created_by: 'u-pres', updated_at: at(-2) },
    { id: 'e5', club_id: C, audience: 'board', team_ids: [], people: [], type: 'Réunion', title: 'Réunion de bureau', starts_at: at(-3, 20), place: '', opponents: '', series_id: null, cancelled: false, created_by: 'u-pres', updated_at: at(-5) },
  ],
  event_responses: [{ id: 'r1', event_id: 'e1', user_id: 'u-p1', player_id: 'p-tom', answer: 'oui' }],
  event_hidden: [], attendance: [],
  groups: [{ id: 'g1', club_id: C, name: 'U9 · Parents et coachs', created_by: ME, created_at: at(-20), last_message_at: at(-1, 9) }, { id: 'g2', club_id: C, name: 'Bureau · trésorerie', created_by: ME, created_at: at(-10), last_message_at: at(-5, 9) }],
  group_members: [{ group_id: 'g2', user_id: ME, muted: false, last_read_at: at(-1) }, { group_id: 'g1', user_id: ME, muted: false, last_read_at: at(-2) }, { group_id: 'g1', user_id: 'u-p1', muted: false, last_read_at: at(-2) }],
  team_follows: [], player_payments: [{ id: 'pay1', player_id: 'p-tom', amount: 50, method: 'Chèque', paid_at: at(-3) }], club_contacts: [],
  messages: [{ id: 1, group_id: 'g1', user_id: 'u-p1', body: 'Qui peut faire le covoiturage samedi ?', created_at: at(-1, 9) }, { id: 2, group_id: 'g2', user_id: 'u-pres', body: 'Point sur les cotisations jeudi', created_at: at(-5, 9) }],
  polls: [{ id: 'q1', group_id: 'g1', question: 'Présent au plateau ?', created_by: ME, created_at: at(-1), deleted_at: null }],
  poll_votes: [{ poll_id: 'q1', user_id: 'u-p1', answer: 'Présent' }],
};
window.__FAKE = D; window.__CALLS = [];
const clone = (x) => JSON.parse(JSON.stringify(x));
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; this.one = false; }
  select() { if (this.op === 'insert' || this.op === 'update') this.ret = true; return this; }
  eq(k, v) { this.f.push((r) => r[k] === v); return this; }
  in(k, v) { this.f.push((r) => v.includes(r[k])); return this; }
  gte(k, v) { this.f.push((r) => r[k] >= v); return this; }
  gt(k, v) { this.f.push((r) => r[k] > v); return this; }
  neq(k, v) { this.f.push((r) => r[k] !== v); return this; }
  order() { return this; } limit() { return this; }
  single() { this.one = true; return this; } maybeSingle() { this.one = true; return this; }
  insert(v) { this.op = 'insert'; this.v = v; return this; }
  upsert(v) { this.op = 'upsert'; this.v = v; return this; }
  update(v) { this.op = 'update'; this.v = v; return this; }
  delete() { this.op = 'delete'; return this; }
  then(ok, ko) { return Promise.resolve(this.exec()).then(ok, ko); }
  exec() {
    const T = (D[this.t] = D[this.t] || []), m = (r) => this.f.every((f) => f(r));
    window.__CALLS.push([this.t, this.op, this.v]);
    if (this.op === 'select') { const r = T.filter(m).map(clone); return { data: this.one ? r[0] || null : r, error: null }; }
    if (this.op === 'insert' || this.op === 'upsert') {
      const rows = (Array.isArray(this.v) ? this.v : [this.v]).map((r) => ({ id: r.id || uid(), created_at: new Date().toISOString(), ...r }));
      rows.forEach((r) => { const i = this.op === 'upsert' ? T.findIndex((x) => (r.player_id && x.player_id === r.player_id && (!r.event_id || x.event_id === r.event_id) && (!r.poll_id || x.poll_id === r.poll_id)) || (r.poll_id && x.poll_id === r.poll_id && x.user_id === r.user_id)) : -1; if (i >= 0) T[i] = { ...T[i], ...r }; else T.push(r); });
      return { data: this.one ? clone(rows[0]) : clone(rows), error: null };
    }
    if (this.op === 'update') { T.filter(m).forEach((r) => Object.assign(r, this.v)); return { data: null, error: null }; }
    if (this.op === 'delete') { D[this.t] = T.filter((r) => !m(r)); return { data: null, error: null }; }
  }
}
const roster = () => D.memberships.filter((m) => m.status === 'active' && ['president', 'bureau', 'coach'].includes(m.role)).map((m) => { const p = D.profiles.find((x) => x.id === m.user_id); return { kind: 'membre', ref: m.id, user_id: m.user_id, first_name: p.first_name, last_name: p.last_name, role: m.role, team_id: m.team_id, assistant: !!m.assistant, since: m.created_at }; })
  .concat(D.players.filter((x) => !x.deleted_at).map((x) => ({ kind: 'joueur', ref: x.id, user_id: x.user_id || null, first_name: x.first_name, last_name: x.last_name, role: 'joueur', team_id: x.team_id, assistant: false, since: x.created_at })));
const RPC = {
  my_profile: () => D.profiles.find((p) => p.id === ME),
  club_roster: roster, phones_for: () => D.profiles.map((p) => ({ id: p.id, phone: p.phone })),
  purge_trash: () => 0, club_trash: () => D.players.filter((p) => p.deleted_at).map((p) => ({ kind: 'player', id: p.id, label: p.first_name + ' ' + p.last_name, deleted_at: p.deleted_at, deleted_by: 'Gaël Test', purge_at: new Date(Date.parse(p.deleted_at) + 30 * 864e5).toISOString() })),
  respond_event: ({ p_event, p_player, p_answer }) => { D.event_responses = D.event_responses.filter((r) => !(r.event_id === p_event && (p_player ? r.player_id === p_player : r.user_id === ME && !r.player_id))); if (p_answer) D.event_responses.push({ id: uid(), event_id: p_event, user_id: ME, player_id: p_player, answer: p_answer }); return null; },
  create_events: ({ p }) => { p.starts.forEach((s) => D.events.push({ id: uid(), club_id: p.club_id, audience: p.audience, team_ids: p.team_ids || [], people: p.people || [], type: p.type, title: p.title, starts_at: s, place: p.place, opponents: p.opponents, series_id: p.series ? 's-new' : null, cancelled: false, created_by: ME, updated_at: new Date().toISOString() })); return p.starts.length; },
  delete_events: ({ p_event, p_mode, p_dry }) => { const e = D.events.find((x) => x.id === p_event); const del = p_mode === 'one' || !e.series_id ? [e] : D.events.filter((x) => x.series_id === e.series_id && new Date(x.starts_at) >= Date.now()); if (!p_dry) D.events = D.events.filter((x) => !del.includes(x)); return del.length; },
  delete_event_list: ({ p_ids }) => { const n = D.events.filter((e) => p_ids.includes(e.id)).length; D.events = D.events.filter((e) => !p_ids.includes(e.id)); return n; },
  trash_item: ({ p_kind, p_id }) => { if (p_kind === 'player') D.players.find((p) => p.id === p_id).deleted_at = new Date().toISOString(); if (p_kind === 'poll') { const q = D.polls.find((p) => p.id === p_id); q.deleted_at = new Date().toISOString(); q.deleted_by = ME; } return null; },
  restore_item: ({ p_kind, p_id }) => { if (p_kind === 'player') D.players.find((p) => p.id === p_id).deleted_at = null; if (p_kind === 'poll') D.polls.find((p) => p.id === p_id).deleted_at = null; return null; },
  club_teams: () => D.teams.filter((t) => !t.deleted_at).map((t) => ({ ...t, coach: t.id === 't-u9' ? 'Gaël T.' : null, coaches: 1, players: D.players.filter((p) => p.team_id === t.id && !p.deleted_at).length, followed: D.team_follows.some((f) => f.team_id === t.id) })),
  club_contacts_list: () => [{ kind: 'president', user_id: 'u-pres', name: 'Céline P.', fonction: 'Président' }].concat(D.club_contacts.filter((c) => c.for_licence || c.for_matches).map((c) => ({ kind: 'contact', user_id: c.user_id, name: 'Gaël Test', fonction: 'Membre du bureau', for_licence: c.for_licence, for_matches: c.for_matches, phone: c.show_phone ? '06 00 00 00 00' : null, email: null }))),
  mark_paid: ({ p_player, p_paid }) => { const a = D.player_admin.find((x) => x.player_id === p_player); if (p_paid) { D.player_payments.push({ id: uid(), player_id: p_player, amount: a.fee_amount - a.fee_paid, method: 'Solde validé à la main', paid_at: new Date().toISOString() }); a.fee_paid = a.fee_amount; } else { D.player_payments = D.player_payments.filter((x) => x.player_id !== p_player); a.fee_paid = 0; } return null; },
  import_fee_grid: ({ p_rows }) => { let up = 0, ad = 0; p_rows.forEach((r) => { const g = D.fee_grid.find((x) => (r.team_id ? x.team_id === r.team_id : (x.category || '').toLowerCase() === (r.category || '').toLowerCase())); if (g) { if (+g.amount !== +r.amount) up++; g.amount = r.amount; } else { ad++; D.fee_grid.push({ id: uid(), club_id: C, category: r.category, team_id: r.team_id, amount: r.amount, fed_part: r.fed }); } }); return { updated: up, added: ad, deleted: 0 }; },
  update_member_profile: ({ p_user, p_first, p_last }) => { const p = D.profiles.find((x) => x.id === p_user); p.first_name = p_first; p.last_name = p_last; p.full_name = p_first + ' ' + p_last; return null; },
  message_president: () => { D.groups.push({ id: 'g-pres', club_id: C, name: 'Message au président · Gaël Test', created_by: ME }); D.group_members.push({ group_id: 'g-pres', user_id: ME, last_read_at: new Date().toISOString() }); return 'g-pres'; },
  group_previews: () => { const r = {}; D.messages.forEach((m) => { if (!r[m.group_id] || r[m.group_id].created_at < m.created_at) r[m.group_id] = { group_id: m.group_id, user_id: m.user_id, body: m.body, created_at: m.created_at, kind: 'message' }; }); return Object.values(r); },
  public_search_clubs: ({ p_query, p_sport }) => D.clubs.filter((c) => c.public_listed !== false && (!p_sport || c.sport === p_sport) && (c.name + ' ' + c.city).toLowerCase().includes(String(p_query).toLowerCase())).map((c) => ({ id: c.id, name: c.name, city: c.city, postal_code: c.postal_code || '', sport: c.sport, logo: c.logo, crest_bg: c.crest_bg, color1: c.color1, crest_outline: 'auto' })),
  public_club: ({ p_club }) => { const c = D.clubs.find((x) => x.id === p_club); return c && { id: c.id, name: c.name, city: c.city, postal_code: c.postal_code || '', sport: c.sport, logo: c.logo, color1: c.color1, teams: D.teams.filter((t) => t.state === 'Visible').map((t) => ({ id: t.id, name: t.name, category: t.category, gender: t.gender, slots: t.slots })) }; },
  join_club_by_id: ({ p_club, p_role }) => { D.memberships.push({ id: uid(), club_id: p_club, user_id: ME, role: p_role, status: 'active', created_at: new Date().toISOString() }); return p_club; },
  match_players: () => [], import_players: ({ p_rows }) => { p_rows.filter((r) => r.action !== 'skip').forEach((r) => D.players.push({ id: uid(), club_id: C, team_id: T9, first_name: r.first_name, last_name: r.last_name, birth_date: r.birth_date, consents: {}, created_at: new Date().toISOString() })); return p_rows.filter((r) => r.action !== 'skip').length; },
  export_my_data: () => ({ profil: D.profiles[0] }), validate_membership: ({ mid }) => { D.memberships.find((m) => m.id === mid).status = 'active'; return null; },
};
export function createClient() {
  let cb = null; const session = { user: { id: ME, email: 'gael@exemple.fr' } };
  return {
    auth: { onAuthStateChange: (f) => { cb = f; setTimeout(() => f('SIGNED_IN', window.__LOGGED_OUT ? null : session), 0); return { data: { subscription: { unsubscribe() {} } } }; }, signInWithPassword: async () => { cb('SIGNED_IN', session); return { data: {}, error: null }; }, signUp: async (a) => { window.__SIGNUP = a; return { data: { session: null }, error: null }; }, signOut: async () => { cb('SIGNED_OUT', null); return { error: null }; }, resetPasswordForEmail: async () => ({ error: null }), updateUser: async () => ({ error: null }) },
    from: (t) => new Q(t),
    rpc: async (n, a) => { window.__CALLS.push(['rpc', n, a]); return RPC[n] ? { data: clone(RPC[n](a || {}) ?? null), error: null } : { data: true, error: null }; },
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: () => {},
  };
}
