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
function fakeC({ data = true, reserve = 'ok', resendOk = true, resendThrows = false } = {}) {
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
console.log(`\n   ${ok} réussis sur ${ok + ko} tests d'e-mail`);
if (ko) process.exitCode = 1;
