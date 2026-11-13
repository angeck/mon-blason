// mypocketclub · test de la fonction d'envoi des e-mails (n° 107), sans réseau : Supabase et Resend sont imités.
// Usage : node --experimental-strip-types --no-warnings tests/email.test.mjs
const F = await import('../supabase/functions/envoyer-email/index.ts');
let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log((c ? '  ok    · ' : '  ÉCHEC · ') + n); };
const env = { url: 'https://exemple.supabase.co', anon: 'cle-publique', resendKey: 're_faux', from: 'mypocketclub <notifications@mypocketclub.fr>', replyTo: 'contact@mypocketclub.fr' };
function fake({ admin = true, user = true, resendOk = true } = {}) {
  const calls = [];
  const f = async (url, o = {}) => {
    calls.push([url, o]);
    const res = (s, b) => ({ ok: s < 300, status: s, json: async () => b });
    if (url.endsWith('/auth/v1/user')) return user ? res(200, { email: 'admin@exemple.fr' }) : res(401, {});
    if (url.endsWith('/rpc/is_app_admin')) return res(200, admin);
    if (url.endsWith('/rpc/my_profile')) return res(200, { first_name: 'Gaël' });
    if (url === 'https://api.resend.com/emails') return resendOk ? res(200, { id: 'em_1' }) : res(422, { message: 'domaine non vérifié' });
    return res(404, {});
  };
  return { f, calls };
}
const req = (body, auth = 'Bearer jeton') => new Request('https://x/functions/v1/envoyer-email', { method: 'POST', headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : {}, body: JSON.stringify(body) });

let k = fake(), r = await F.handle(req({ test: true }), env, k.f, new Date('2026-11-03T15:00:00Z')), b = await r.json();
const sent = k.calls.find((c) => c[0] === 'https://api.resend.com/emails'), mail = sent && JSON.parse(sent[1].body);
check('administrateur : e-mail de test envoyé', r.status === 200 && b.envoye === true && b.to === 'admin@exemple.fr');
check('expéditeur notifications@, réponses vers contact@', mail?.from === 'mypocketclub <notifications@mypocketclub.fr>' && mail?.reply_to === 'contact@mypocketclub.fr');
check('destinataire : seulement l’adresse du compte', JSON.stringify(mail?.to) === '["admin@exemple.fr"]');
check('clé de Resend envoyée à Resend seulement', sent?.[1].headers.Authorization === 'Bearer re_faux' && k.calls.filter((c) => JSON.stringify(c[1].headers || {}).includes('re_faux')).length === 1);
check('contenu : prénom, date de Paris, adresse d’envoi', /Bonjour Gaël/.test(mail?.text) && /3 novembre 2026/.test(mail?.text) && /16:00/.test(mail?.text) && /notifications@mypocketclub\.fr/.test(mail?.html));
k = fake({ admin: false }); r = await F.handle(req({ test: true }), env, k.f);
check('autre membre : refusé (403), rien envoyé', r.status === 403 && !k.calls.some((c) => c[0].includes('resend')));
k = fake({ user: false }); r = await F.handle(req({ test: true }), env, k.f);
check('jeton invalide : refusé (401)', r.status === 401 && !k.calls.some((c) => c[0].includes('resend')));
k = fake(); r = await F.handle(req({ test: true }, ''), env, k.f);
check('sans connexion : refusé (401), Supabase pas appelé', r.status === 401 && k.calls.length === 0);
k = fake(); r = await F.handle(req({ to: 'quelquun@exemple.fr', test: false }), env, k.f);
check('envoi à une autre adresse : refusé (400)', r.status === 400 && !k.calls.some((c) => c[0].includes('resend')));
k = fake(); r = await F.handle(req({ test: true }), { ...env, resendKey: '' }, k.f);
check('secret RESEND_API_KEY absent : erreur claire (500)', r.status === 500 && /RESEND_API_KEY/.test((await r.json()).erreur));
k = fake({ resendOk: false }); r = await F.handle(req({ test: true }), env, k.f); b = await r.json();
check('refus de Resend : message renvoyé (502)', r.status === 502 && /domaine non vérifié/.test(b.detail));
r = await F.handle(new Request('https://x', { method: 'OPTIONS' }), env, fake().f);
check('appel depuis le navigateur autorisé (CORS)', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
check('HTML : texte de la personne échappé', !/<script>/.test(F.testMail('<script>', new Date()).html));
// N° 109 · point 4 : nom du club + catégorie et genre, jamais le nom de l'équipe ; réponses vers le correspondant
const reines = { name: 'Les Reines', category: 'U9', gender: 'Féminine' };
check('n° 109 : expéditeur = nom du club + catégorie et genre (« Boissy Basket 91 U9 F »)', F.senderName('Boissy Basket 91', [reines]) === 'Boissy Basket 91 U9 F');
check('n° 109 : jamais le nom interne de l’équipe (« Les Reines »)', !F.senderName('Boissy Basket 91', [reines]).includes('Reines'));
check('n° 109 : plusieurs catégories, sans doublon', F.senderName('Boissy Basket 91', [reines, { category: 'U11', gender: 'Masculine' }, reines]) === 'Boissy Basket 91 U9 F, U11 M');
const env9 = F.convocationEnvelope(env, 'Boissy "Basket" <91>', [reines], 'correspondant@exemple.fr');
check('n° 109 : adresse notifications@ gardée, nom nettoyé des guillemets et chevrons', env9.from === '"Boissy Basket 91 U9 F" <notifications@mypocketclub.fr>');
check('n° 109 : réponses vers le correspondant, sinon contact@', env9.reply_to === 'correspondant@exemple.fr' && F.convocationEnvelope(env, 'Club', [], null).reply_to === 'contact@mypocketclub.fr' && F.convocationEnvelope(env, 'Club', [], 'pas une adresse').reply_to === 'contact@mypocketclub.fr');
// N° 112 · convocation envoyée au contact du club reçu (PDF joint, réponses et copie à la personne qui envoie)
const CD = { club: { name: 'Boissy Basket 91' }, from: '2026-11-14', to: '2026-11-15', sender: { name: 'Rémi Rencontres', email: 'remi@exemple.fr' },
  events: [{ id: 'e1', type: 'Match', title: 'Match', starts_at: '2026-11-14T14:00:00Z', place: 'Gymnase Jean-Moulin, 1 rue X', opponents: 'Étampes BC', cancelled: false, team: reines }] };
function fakeC({ data = true, reserve = 'ok', resendOk = true, resendThrows = false, ps = null } = {}) {
  const calls = [];
  const f = async (url, o = {}) => {
    calls.push([url, o]);
    const res = (s, b) => ({ ok: s < 300, status: s, json: async () => b });
    if (url.endsWith('/auth/v1/user')) return res(200, { email: 'remi@exemple.fr' });
    if (url.endsWith('/rpc/is_app_admin')) return res(200, false);
    if (url.endsWith('/rpc/my_profile')) return res(200, { first_name: 'Rémi' });
    if (url.endsWith('/rpc/convocation_data')) return data ? res(200, CD) : res(400, { message: 'réservé' });
    if (url.endsWith('/rpc/convocation_reserve')) return reserve === 'ok' ? res(200, 'envoi-1') : reserve === 'limite' ? res(400, { message: 'Limite d\'envois du jour atteinte : réessaie demain' }) : res(400, { message: 'Envoi réservé aux comptes validés par mypocketclub' });
    if (url.endsWith('/rpc/convocation_finish')) return res(200, null);
    if (url.endsWith('/rpc/convocation_ps')) return ps === null ? res(404, {}) : res(200, ps); // 5.12.0 · n° 162
    if (url === 'https://api.resend.com/emails') { if (resendThrows) throw new Error('réseau coupé'); return resendOk ? res(200, { id: 'em_2' }) : res(422, { message: 'adresse refusée' }); }
    return res(404, {});
  };
  return { f, calls };
}
const bodyOf = (k, end) => JSON.parse((k.calls.find((c) => c[0].endsWith(end)) || [, { body: 'null' }])[1].body);
const order = (k) => k.calls.map((c) => c[0].replace(/.*\/(rpc\/)?/, '').replace('emails', 'resend'));
const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(400)).toString('base64');
const conv = (o = {}) => ({ convocation: { event_id: 'e1', step: 'C', version: 2, hash: 'abc123', to: { civ: 'Monsieur', first: 'Jean', last: 'Dupont', email: 'jean@club.fr' }, filename: 'Convocation-BB-20261114-C-v2.pdf', pdf: PDF, ...o } });
k = fakeC(); r = await F.handle(req(conv()), env, k.f, new Date('2026-11-10T09:00:00Z')); b = await r.json();
const cm = JSON.parse((k.calls.find((c) => c[0] === 'https://api.resend.com/emails') || [, { body: '{}' }])[1].body), kOk = k;
check('n° 112 : convocation envoyée par un membre qui a la rubrique Événements (pas besoin d’être administrateur)', r.status === 200 && b.envoye === true);
check('n° 112 : expéditeur = nom du club + catégorie, adresse notifications@', cm.from === '"Boissy Basket 91 U9 F" <notifications@mypocketclub.fr>');
check('n° 112 : réponses vers la personne qui envoie, et copie à cette personne', cm.reply_to === 'remi@exemple.fr' && JSON.stringify(cm.cc) === '["remi@exemple.fr"]');
check('n° 112 : un seul destinataire, le contact saisi', JSON.stringify(cm.to) === '["jean@club.fr"]');
check('n° 112 : objet « Convocation Boissy Basket 91 U9 F (mise à jour) » pour une -v2', cm.subject === 'Convocation Boissy Basket 91 U9 F (mise à jour)');
check('n° 112 : « Bonjour Monsieur Dupont », rencontre, gymnase, signature', /Bonjour Monsieur Dupont,/.test(cm.text) && /Étampes BC/.test(cm.text) && /15h00/.test(cm.text) && /Gymnase Jean-Moulin/.test(cm.text) && /Rémi Rencontres, Boissy Basket 91/.test(cm.text));
check('n° 112 : le PDF est joint avec son nom', cm.attachments?.[0]?.filename === 'Convocation-BB-20261114-C-v2.pdf' && cm.attachments[0].content === PDF);
k = fakeC({ data: false }); r = await F.handle(req(conv()), env, k.f);
check('n° 112 : sans la rubrique Événements : refusé (403), rien envoyé', r.status === 403 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeC({ reserve: 'limite' }); r = await F.handle(req(conv()), env, k.f);
check('n° 124 : limite du jour atteinte dans la base : refusé (429), rien envoyé', r.status === 429 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeC({ reserve: 'non_valide' }); r = await F.handle(req(conv()), env, k.f); b = await r.json();
check('n° 124 : compte non validé par mypocketclub : refusé (403), rien envoyé', r.status === 403 && b.code === 'non_valide' && !k.calls.some((c) => c[0].includes('resend')));
k = fakeC(); r = await F.handle(req(conv({ to: { civ: 'Madame', last: 'X', email: 'pas une adresse' } })), env, k.f);
check('n° 112 : adresse du contact invalide : refusé (400)', r.status === 400 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeC(); r = await F.handle(req(conv({ pdf: Buffer.from('<html>' + 'x'.repeat(400)).toString('base64') })), env, k.f);
check('n° 112 : pièce jointe qui n’est pas un PDF : refusée (400)', r.status === 400 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeC({ resendOk: false }); r = await F.handle(req(conv()), env, k.f); b = await r.json();
check('n° 107 : refus de Resend renvoyé (502)', r.status === 502 && /adresse refusée/.test(b.detail));
check('n° 124 : refus de Resend : la base note l’échec de la même réservation', bodyOf(k, '/rpc/convocation_finish')?.p_send === 'envoi-1' && bodyOf(k, '/rpc/convocation_finish')?.p_ok === false && /adresse refusée/.test(bodyOf(k, '/rpc/convocation_finish')?.p_error));
k = fakeC({ resendThrows: true }); r = await F.handle(req(conv()), env, k.f);
check('n° 124 : Resend injoignable : échec noté, pas de réservation laissée « en cours »', r.status === 502 && bodyOf(k, '/rpc/convocation_finish')?.p_ok === false);
check('n° 124 : ordre : vérification, réservation, Resend, puis « envoyé » noté', JSON.stringify(order(kOk).filter((x) => ['convocation_data', 'convocation_reserve', 'resend', 'convocation_finish'].includes(x))) === '["convocation_data","convocation_reserve","resend","convocation_finish"]' && bodyOf(kOk, '/rpc/convocation_finish')?.p_ok === true);
check('n° 129 : contact masqué gardé dans le suivi : « Jean D. · j***@club.fr »', bodyOf(kOk, '/rpc/convocation_reserve')?.p_hint === 'Jean D. · j***@club.fr' && F.contactHint({ civ: 'Madame', last: 'martin', email: 'a@b.fr' }) === 'Mme M. · a***@b.fr');
check('n° 124 : version et empreinte du document transmises à la réservation', bodyOf(kOk, '/rpc/convocation_reserve')?.p_version === 2 && bodyOf(kOk, '/rpc/convocation_reserve')?.p_hash === 'abc123');
k = fakeC(); r = await F.handle(req(conv({ copy: false })), env, k.f);
check('n° 129 : « M’envoyer une copie » décochée : aucune copie', r.status === 200 && bodyOf(k, 'api.resend.com/emails').cc === undefined);
// N° 127 : jour de semaine → « cette semaine » (semaine de l'envoi) ou la date seule ; samedi-dimanche → « le week-end du »
check('n° 127 : week-end : « le week-end du 14 et 15 novembre 2026 »', F.whenPhrase('2026-11-14', '2026-11-15', new Date('2026-11-10T09:00:00Z')) === 'le week-end du 14 et 15 novembre 2026');
check('n° 127 : jeudi de la semaine de l’envoi : « cette semaine, le jeudi 5 novembre 2026 »', F.whenPhrase('2026-11-05', '2026-11-05', new Date('2026-11-05T11:16:00Z')) === 'cette semaine, le jeudi 5 novembre 2026' && F.whenPhrase('2026-11-05', '2026-11-05', new Date('2026-11-02T06:00:00Z')) === 'cette semaine, le jeudi 5 novembre 2026');
check('n° 127 : jeudi d’une autre semaine : « le jeudi 12 novembre 2026 »', F.whenPhrase('2026-11-12', '2026-11-12', new Date('2026-11-05T11:00:00Z')) === 'le jeudi 12 novembre 2026' && F.whenPhrase('2026-11-12', '2026-11-12', new Date('2026-11-08T22:30:00Z')) === 'le jeudi 12 novembre 2026');
const wk = F.convocationMail({ ...CD, from: '2026-11-05', to: '2026-11-05' }, 'C', 1, { civ: 'Monsieur', last: 'Raveneau' }, new Date('2026-11-05T11:16:00Z')).text;
check('n° 127 : e-mail d’une rencontre en semaine : plus de « week-end du jeudi »', /aura le plaisir de vous accueillir cette semaine, le jeudi 5 novembre 2026, aux dates/.test(wk) && !/week-end/.test(wk));
check('n° 112 : HTML de la convocation : texte échappé', !/<script>/.test(F.convocationMail({ ...CD, club: { name: '<script>' } }, 'P', 1, { last: '<b>' }).html));
// ---------- n° 147 (4.7.0) : e-mail « Nouvel appareil » ----------
function fakeD({ take = { token: 'a'.repeat(48), label: 'Android · Chrome', at: '2026-11-09T19:10:00Z' }, admin = false } = {}) {
  const k = fake({ admin }), base = k.f;
  k.f = async (url, o = {}) => { if (url.endsWith('/rpc/device_alert_take')) { k.calls.push([url, o]); return { ok: true, status: 200, json: async () => take }; } return base(url, o); };
  return k;
}
k = fakeD(); r = await F.handle(req({ new_device: { alert: 'al-1' } }), { ...env, appUrl: 'https://app.exemple/#x' }, k.f); b = await r.json();
const nd = bodyOf(k, 'api.resend.com/emails');
check('n° 147 : e-mail « Nouvel appareil » envoyé à l’adresse du compte, jamais à une autre', r.status === 200 && JSON.stringify(nd.to) === JSON.stringify(['admin@exemple.fr']));
check('n° 147 : alerte lue une seule fois dans la base, au nom du compte (jeton de la personne)', bodyOf(k, '/rpc/device_alert_take')?.p_alert === 'al-1' && k.calls.find((c) => c[0].endsWith('/rpc/device_alert_take'))[1].headers.Authorization === 'Bearer jeton');
check('n° 147 : lien « Ce n’était pas moi » avec le jeton, sur l’adresse de l’application', nd.html.includes('https://app.exemple/#pasmoi=' + 'a'.repeat(48)) && nd.text.includes('#pasmoi='));
check('n° 147 : l’appareil est nommé dans l’e-mail', nd.text.includes('Android · Chrome'));
check('n° 147 : pas besoin d’être administrateur', r.status === 200);
k = fakeD({ take: null }); r = await F.handle(req({ new_device: { alert: 'al-1' } }), env, k.f);
check('n° 147 : alerte déjà envoyée ou d’un autre compte : rien ne part (409)', r.status === 409 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeD({ take: { token: 'pas-un-jeton"><script>' } }); r = await F.handle(req({ new_device: { alert: 'al-1' } }), env, k.f);
check('n° 147 : jeton mal formé : rien ne part', r.status === 409 && !k.calls.some((c) => c[0].includes('resend')));
check('n° 147 : HTML de l’e-mail : nom de l’appareil échappé', !/<script>/.test(F.newDeviceMail('', '<script>', new Date(), 'https://x/#pasmoi=ab').html));
// ---------- 5.3.0 : invitation du parent d'un joueur de 15 à 17 ans ----------
const TOK = 'b'.repeat(64);
function fakeP({ take = { email: 'parent@exemple.fr', token: TOK, expires_at: '2026-11-26T10:00:00Z', child_first: 'Léa', club: 'Club Test' } } = {}) {
  const k = fake({ admin: false }), base = k.f;
  k.f = async (url, o = {}) => { if (url.endsWith('/rpc/parent_invitation_take')) { k.calls.push([url, o]); return { ok: true, status: 200, json: async () => take }; } return base(url, o); };
  return k;
}
k = fakeP(); r = await F.handle(req({ parent_invite: { id: 'inv-1' } }), { ...env, appUrl: 'https://app.exemple/#x' }, k.f); b = await r.json();
const pi = bodyOf(k, 'api.resend.com/emails');
check('5.3.0 : invitation envoyée à l’adresse saisie par le joueur, pas à celle du compte', r.status === 200 && JSON.stringify(pi.to) === JSON.stringify(['parent@exemple.fr']));
check('5.3.0 : invitation lue une seule fois dans la base, au nom du joueur', bodyOf(k, '/rpc/parent_invitation_take')?.p_id === 'inv-1');
check('5.3.0 : lien #parent=… sur l’adresse de l’application', pi.html.includes('https://app.exemple/#parent=' + TOK) && pi.text.includes('#parent=' + TOK));
check('5.3.0 : le prénom et le club sont dans l’e-mail', pi.text.includes('Léa') && pi.text.includes('Club Test'));
k = fakeP({ take: null }); r = await F.handle(req({ parent_invite: { id: 'inv-1' } }), env, k.f);
check('5.3.0 : invitation déjà envoyée ou d’un autre joueur : rien ne part (409)', r.status === 409 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeP({ take: { email: 'parent@exemple.fr', token: 'pas-un-jeton"><script>', club: 'C' } }); r = await F.handle(req({ parent_invite: { id: 'inv-1' } }), env, k.f);
check('5.3.0 : jeton mal formé : rien ne part', r.status === 409 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeP({ take: { email: 'pas une adresse', token: TOK, club: 'C' } }); r = await F.handle(req({ parent_invite: { id: 'inv-1' } }), env, k.f);
check('5.3.0 : adresse invalide : rien ne part', r.status === 409 && !k.calls.some((c) => c[0].includes('resend')));
check('5.3.0 : HTML de l’invitation : prénom et club échappés', !/<script>/.test(F.parentInviteMail('<script>', '<script>', 'https://x/#parent=ab', new Date()).html));
// ---------- 5.4.0 · n° 201 : invitation du parent pour une conversation ----------
k = fakeP({ take: { email: 'parent@exemple.fr', token: TOK, expires_at: '2026-11-26T10:00:00Z', child_first: 'Lou', club: 'Club Test', purpose: 'conversation', requested_by: 'Coach' } });
r = await F.handle(req({ parent_invite: { id: 'inv-2' } }), env, k.f);
const pc = bodyOf(k, 'api.resend.com/emails');
check('n° 201 : l’invitation dit qui veut échanger avec l’enfant, et pourquoi l’accord est demandé', r.status === 200 && pc.text.includes('Coach, du club Club Test, souhaite échanger avec Lou') && pc.text.includes('onglet Messages') && pc.subject.includes('souhaite échanger avec Lou'));
check('n° 201 : HTML : nom du demandeur échappé', !/<script>/.test(F.parentInviteMail('Lou', 'C', 'https://x/#parent=ab', new Date(), 'conversation', '<script>').html));
// ---------- 5.4.0 · n° 182 : rappel de validation au président ----------
function fakeR({ rows = [{ club: 'Club 54', valid_by: '2026-11-20T10:00:00Z', email: 'pres@exemple.fr', first_name: 'Paul' }] } = {}) {
  const k = fake({ admin: false }), base = k.f;
  k.f = async (url, o = {}) => { if (url.endsWith('/rpc/validation_reminders_take')) { k.calls.push([url, o]); return { ok: true, status: 200, json: async () => rows }; } return base(url, o); };
  return k;
}
k = fakeR(); r = await F.handle(req({ validation_reminders: true }), { ...env, service: 'cle-serveur' }, k.f); b = await r.json();
const vr = bodyOf(k, 'api.resend.com/emails'), take = k.calls.find((c) => c[0].endsWith('/rpc/validation_reminders_take'));
check('n° 182 : le rappel part à l’adresse du président, réponses vers contact@', r.status === 200 && b.envoye === 1 && JSON.stringify(vr.to) === JSON.stringify(['pres@exemple.fr']) && vr.reply_to === 'contact@mypocketclub.fr');
check('n° 182 : les adresses sont lues avec la clé du serveur, pas celle de la personne', take && take[1].headers.apikey === 'cle-serveur' && !take[1].headers.Authorization);
k = fakeR(); r = await F.handle(req({ validation_reminders: true }), { ...env, service: 'eyJancienne' }, k.f);
check('n° 182 : ancienne clé service_role : aussi en Authorization', k.calls.find((c) => c[0].endsWith('/rpc/validation_reminders_take'))?.[1].headers.Authorization === 'Bearer eyJancienne');
check('n° 182 : le club et la date limite sont dans l’e-mail', vr.text.includes('Club 54') && vr.text.includes('20 novembre 2026'));
k = fakeR(); r = await F.handle(req({ validation_reminders: true }), env, k.f);
check('n° 182 : sans clé du serveur, rien ne part', r.status === 500 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeR({ rows: [{ club: 'C', valid_by: '2026-11-20T10:00:00Z', email: 'pas une adresse' }] }); r = await F.handle(req({ validation_reminders: true }), { ...env, service: 'x' }, k.f); b = await r.json();
check('n° 182 : adresse invalide : rien ne part', b.envoye === 0 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeR(); r = await F.handle(req({ validation_reminders: true }, ''), { ...env, service: 'x' }, k.f);
check('n° 182 : il faut être connecté pour déclencher l’envoi', r.status === 401);
// ---------- 5.11.0 · n° 228 : compteur ; n° 207 : attestation ; n° 187 : comptes inactifs ----------
const logs = (k) => k.calls.filter((c) => c[0].endsWith('/rpc/mail_log_add')).map((c) => JSON.parse(c[1].body));
k = fakeR(); r = await F.handle(req({ validation_reminders: true }), { ...env, service: 'cle-serveur' }, k.f);
check('n° 228 : le rappel est compté (type, réussite), sans adresse', logs(k).length === 1 && logs(k)[0].p_kind === 'rappel_validation' && logs(k)[0].p_ok === true && !JSON.stringify(logs(k)).includes('@'));
check('n° 228 : compté avec la clé du serveur', k.calls.find((c) => c[0].endsWith('/rpc/mail_log_add'))?.[1].headers.apikey === 'cle-serveur');
k = fake(); r = await F.handle(req({ test: true }), { ...env, service: 'cle-serveur' }, k.f);
check('n° 228 : l’e-mail de test est compté', logs(k).length === 1 && logs(k)[0].p_kind === 'test');
function fakeA({ take = { email: 'parent@exemple.fr', first_name: 'Ana', player: 'Léo', club: 'Club Test', club_id: 'c-1', season: '2026-2027', pdf: 'JVBERi0xLjQKJ' }, admin = false, rows = [] } = {}) {
  const k = fake({ admin }), base = k.f;
  k.f = async (url, o = {}) => {
    if (url.endsWith('/rpc/attestation_mail_take')) { k.calls.push([url, o]); return take ? { ok: true, status: 200, json: async () => take } : { ok: false, status: 400, json: async () => ({ message: 'Attestation déjà envoyée par e-mail' }) }; }
    if (url.endsWith('/rpc/inactive_warnings_take')) { k.calls.push([url, o]); return { ok: true, status: 200, json: async () => rows }; }
    if (url.endsWith('/rpc/mail_log_add') || url.endsWith('/rpc/admin_inactive_warn_note')) { k.calls.push([url, o]); return { ok: true, status: 200, json: async () => null }; }
    return base(url, o);
  };
  return k;
}
k = fakeA(); r = await F.handle(req({ attestation: { id: 'att-1' } }), { ...env, service: 's' }, k.f); b = await r.json();
const at = bodyOf(k, 'api.resend.com/emails');
check('n° 207 : l’attestation part à l’adresse donnée par la base, PDF joint', r.status === 200 && JSON.stringify(at.to) === '["parent@exemple.fr"]' && at.attachments?.[0]?.content === 'JVBERi0xLjQKJ' && /\.pdf$/.test(at.attachments[0].filename));
check('n° 207 : prénom, joueur, club et saison dans l’e-mail ; pas de désinscription (service)', at.text.includes('Ana') && at.text.includes('Léo') && at.text.includes('Club Test') && at.text.includes('2026-2027') && !/désinscri/i.test(at.text));
check('n° 207 : compté avec son club', logs(k)[0]?.p_kind === 'attestation' && logs(k)[0]?.p_club === 'c-1');
k = fakeA({ take: null }); r = await F.handle(req({ attestation: { id: 'att-1' } }), env, k.f);
check('n° 207 : déjà envoyée ou pas le droit : rien ne part', r.status === 403 && !k.calls.some((c) => c[0].includes('resend')));
k = fakeA({ take: { email: 'parent@exemple.fr', pdf: 'pas un pdf' } }); r = await F.handle(req({ attestation: { id: 'att-1' } }), env, k.f);
check('n° 207 : PDF illisible : rien ne part', r.status === 403 && !k.calls.some((c) => c[0].includes('resend')));
check('n° 207 : HTML : noms échappés', !/<script>/.test(F.attestationMail('<script>', '<script>', '<script>', '2026').html));
const rows187 = [{ email: 'vieux@exemple.fr', first_name: 'Marc', until: '2026-12-13' }, { email: 'pas une adresse', first_name: 'X', until: '2026-12-13' }];
k = fakeA({ admin: false, rows: rows187 }); r = await F.handle(req({ inactive_warnings: true }), { ...env, service: 's' }, k.f);
check('n° 187 : réservé à l’administrateur', r.status === 403 && !k.calls.some((c) => c[0].includes('resend') || c[0].endsWith('/rpc/inactive_warnings_take')));
k = fakeA({ admin: true, rows: rows187 }); r = await F.handle(req({ inactive_warnings: true }), { ...env, service: 's', appUrl: 'https://mypocketclub.fr/' }, k.f); b = await r.json();
const iw = bodyOf(k, 'api.resend.com/emails');
check('n° 187 : un e-mail par compte valide, date de la corbeille et lien pour garder le compte', b.envoye === 1 && JSON.stringify(iw.to) === '["vieux@exemple.fr"]' && iw.text.includes('13 décembre 2026') && iw.text.includes('https://mypocketclub.fr/') && iw.text.includes('Marc'));
check('n° 187 : adresses lues avec la clé du serveur, 40 au plus', (() => { const c = k.calls.find((x) => x[0].endsWith('/rpc/inactive_warnings_take')); return c && c[1].headers.apikey === 's' && JSON.parse(c[1].body).p_limit === 40; })());
check('n° 187 : noté au journal admin et compté', k.calls.some((c) => c[0].endsWith('/rpc/admin_inactive_warn_note')) && logs(k).some((x) => x.p_kind === 'prevenance_inactif'));
k = fakeA({ admin: true, rows: rows187 }); r = await F.handle(req({ inactive_warnings: true }), env, k.f);
check('n° 187 : sans clé du serveur, rien ne part', r.status === 500 && !k.calls.some((c) => c[0].includes('resend')));
// ---------- 5.11.0 · n° 96 : e-mail au dirigeant d'un club absent ----------
const TOK96 = 'a'.repeat(64);
function fakeO({ prep = { outreach: 'o-1', email: 'contact@club.fr', token: TOK96, club: 'Volley Club', city: 'Lardy', first_name: 'Léa', last_name: 'Martin', count: 3, relance: false, source: 'Site du club' }, admin = true, resendOk = true } = {}) {
  const k = fake({ admin, resendOk }), base = k.f;
  k.f = async (url, o = {}) => {
    if (url.endsWith('/rpc/admin_outreach_prepare')) { k.calls.push([url, o]); return prep ? { ok: true, status: 200, json: async () => prep } : { ok: false, status: 400, json: async () => ({ message: 'Cette adresse a refusé tout envoi : on ne lui écrit plus' }) }; }
    if (url.endsWith('/rpc/mail_log_add') || url.endsWith('/rpc/admin_outreach_failed')) { k.calls.push([url, o]); return { ok: true, status: 200, json: async () => null }; }
    return base(url, o);
  };
  return k;
}
k = fakeO(); r = await F.handle(req({ club_outreach: { request: 'cr-1', email: 'contact@club.fr', source: 'Site du club' } }), { ...env, service: 's', appUrl: 'https://mypocketclub.fr/' }, k.f); b = await r.json();
const om = bodyOf(k, 'api.resend.com/emails');
check('n° 96 : l’e-mail part du sous-domaine info., réponses sur contact@', r.status === 200 && /info\.mypocketclub\.fr/.test(om.from) && om.reply_to === 'contact@mypocketclub.fr' && JSON.stringify(om.to) === '["contact@club.fr"]');
check('n° 96 : texte validé (tutoiement, nom du demandeur, nombre, gratuité)', om.subject === 'Un membre de ton club voudrait utiliser mypocketclub' && om.text.includes('Un membre de ton club, Léa Martin, voudrait que Volley Club (Lardy) soit sur mypocketclub. 3 membres') && om.text.includes('jusqu’à la fin de la saison pour tout ton club') && om.text.includes('Réponds simplement'));
check('n° 96 : lien de désinscription dans le texte et dans l’en-tête List-Unsubscribe', om.text.includes('https://mypocketclub.fr/#desinscription=' + TOK96) && om.headers?.['List-Unsubscribe'] === '<https://mypocketclub.fr/#desinscription=' + TOK96 + '>');
check('n° 96 : l’e-mail dit d’où vient l’adresse', om.text.includes('nous avons trouvé cette adresse ici : site du club'));
check('n° 96 : compté comme e-mail d’information', logs(k).some((x) => x.p_kind === 'information' && x.p_ok === true));
k = fakeO({ admin: false }); r = await F.handle(req({ club_outreach: { request: 'cr-1', email: 'contact@club.fr', source: 'x' } }), env, k.f);
check('n° 96 : réservé à l’administrateur', r.status === 403 && !k.calls.some((c) => c[0].includes('resend') || c[0].endsWith('/rpc/admin_outreach_prepare')));
k = fakeO({ prep: null }); r = await F.handle(req({ club_outreach: { request: 'cr-1', email: 'refus@club.fr', source: 'x' } }), env, k.f); b = await r.json();
check('n° 96 : adresse de la liste noire : rien ne part, raison renvoyée', r.status === 403 && /refusé tout envoi/.test(b.erreur) && !k.calls.some((c) => c[0].includes('resend')));
k = fakeO({ prep: { outreach: 'o-1', email: 'contact@club.fr', token: TOK96, club: 'C', relance: true } }); r = await F.handle(req({ club_outreach: { request: 'cr-1', relance: true } }), env, k.f);
const rel = bodyOf(k, 'api.resend.com/emails');
check('n° 96 : relance : « Relance · » dans l’objet, une seule fois annoncée', rel.subject.startsWith('Relance · ') && rel.text.includes('une seule fois'));
k = fakeO({ resendOk: false }); r = await F.handle(req({ club_outreach: { request: 'cr-1', email: 'contact@club.fr', source: 'x' } }), env, k.f);
check('n° 96 : refus de Resend : l’envoi est annulé dans la base (on peut réessayer)', r.status === 502 && k.calls.some((c) => c[0].endsWith('/rpc/admin_outreach_failed')));
check('n° 96 : HTML : nom du demandeur et du club échappés', !/<script>/.test(F.clubOutreachMail({ first_name: '<script>', club: '<script>' }, 'https://x/#desinscription=ab').html));
// 5.12.0 · n° 162 (façon 1) : P.-S. seulement si la base le dit (club reçu absent de mypocketclub)
check('n° 162 : sans réponse de la base, pas de P.-S.', !cm.text.includes('P.-S.') && !cm.html.includes('P.-S.'));
k = fakeC({ ps: true }); r = await F.handle(req(conv()), env, k.f, new Date('2026-11-10T09:00:00Z'));
const pm = bodyOf(k, 'api.resend.com/emails');
check('n° 162 : club reçu absent : P.-S. en tutoiement, avec le lien du site', r.status === 200 && pm.text.includes('P.-S. Nous utilisons mypocketclub') && pm.text.includes('Si ça te dit de l’essayer, c’est gratuit : https://mypocketclub.fr') && /P\.-S\.[^<]*<a href="https:\/\/mypocketclub\.fr"/.test(pm.html));
check('n° 162 : le P.-S. vient avant la signature « Envoyé avec mypocketclub »', pm.text.indexOf('P.-S.') < pm.text.indexOf('Envoyé avec mypocketclub'));
check('n° 162 : la base reçoit l’envoi réservé et l’adresse saisie', bodyOf(k, '/rpc/convocation_ps')?.p_send === 'envoi-1' && bodyOf(k, '/rpc/convocation_ps')?.p_email === 'jean@club.fr');
k = fakeC({ ps: false }); await F.handle(req(conv()), env, k.f);
check('n° 162 : club déjà inscrit (réponse « non ») : pas de P.-S.', !bodyOf(k, 'api.resend.com/emails').text.includes('P.-S.'));
check('n° 162 : e-mail de service : pas de lien de désinscription', !pm.text.includes('desinscription') && !pm.headers);
console.log(`\n   ${ok} réussis sur ${ok + ko} tests d'e-mail`);
if (ko) process.exitCode = 1;
