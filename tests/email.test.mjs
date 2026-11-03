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
console.log(`\n   ${ok} réussis sur ${ok + ko} tests d'e-mail`);
if (ko) process.exitCode = 1;
