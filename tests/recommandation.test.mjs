// mypocketclub · 5.12.0 · n° 162 (façon 2) : test de la fonction « recommander-club », sans réseau (Cloudflare, Supabase et Resend imités).
// Usage : node --experimental-strip-types --no-warnings tests/recommandation.test.mjs
const F = await import('../supabase/functions/recommander-club/index.ts');
let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log((c ? '  ok    · ' : '  ÉCHEC · ') + n); };
const TOK = 'b'.repeat(64);
const env = { url: 'https://exemple.supabase.co', resendKey: 're_faux', service: 'sb_secret_faux', turnstile: 'ts_secret', infoFrom: 'mypocketclub <bonjour@info.mypocketclub.fr>', replyTo: 'contact@mypocketclub.fr', appUrl: 'https://mypocketclub.fr/' };
function fake({ human = true, take = { token: TOK }, resendOk = true } = {}) {
  const calls = [];
  const f = async (url, o = {}) => {
    calls.push([url, o]);
    const res = (s, b) => ({ ok: s < 300, status: s, json: async () => b });
    if (url.includes('turnstile/v0/siteverify')) return res(200, { success: human });
    if (url.endsWith('/rpc/recommend_take')) return take ? res(200, take) : res(400, { message: 'Recommandation impossible pour cette adresse' });
    if (url.endsWith('/rpc/recommend_done') || url.endsWith('/rpc/mail_log_add')) return res(200, null);
    if (url === 'https://api.resend.com/emails') return resendOk ? res(200, { id: 'em_9' }) : res(422, { message: 'refus' });
    return res(404, {});
  };
  return { f, calls };
}
const req = (body, ip = '192.0.2.9') => new Request('https://x/functions/v1/recommander-club', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
const B = (o = {}) => ({ first: 'Léa', club: 'Volley Club Lardy', email: 'Dirigeant@Club.fr', knows: true, captcha: 'jeton-ts', ...o });
const bodyOf = (k, end) => { const c = k.calls.find((x) => x[0].endsWith(end)); return c ? (typeof c[1].body === 'string' ? JSON.parse(c[1].body) : c[1].body) : null; };
const hit = (k, s) => k.calls.some((c) => c[0].includes(s));

let k = fake(), r = await F.handle(req(B()), env, k.f), b = await r.json();
const m = bodyOf(k, 'api.resend.com/emails');
check('recommandation envoyée', r.status === 200 && b.envoye === true);
check('un seul destinataire, l’adresse saisie (en minuscules)', JSON.stringify(m.to) === '["dirigeant@club.fr"]' && !m.cc && !m.bcc);
check('part du sous-domaine info., réponses sur contact@', /info\.mypocketclub\.fr/.test(m.from) && m.reply_to === 'contact@mypocketclub.fr');
check('prénom et club dans l’objet et le texte, tutoiement', m.subject === 'Léa te recommande mypocketclub' && m.text.includes('Léa, un membre de ton club, te recommande mypocketclub pour Volley Club Lardy.') && m.text.includes('gratuit'));
check('lien de désinscription dans le texte et l’en-tête List-Unsubscribe', m.text.includes('https://mypocketclub.fr/#desinscription=' + TOK) && m.headers?.['List-Unsubscribe'] === '<https://mypocketclub.fr/#desinscription=' + TOK + '>');
check('l’e-mail dit qu’il n’y en aura pas d’autre', m.text.includes('une adresse ne reçoit qu’une recommandation'));
check('ordre : anti-robots, base, Resend, puis « envoyé » noté et compté', JSON.stringify(k.calls.map((c) => c[0].replace(/.*\/(rpc\/)?/, ''))) === '["siteverify","recommend_take","emails","recommend_done","mail_log_add"]');
check('anti-robots : secret et adresse IP transmis à Cloudflare seulement', (() => { const c = k.calls.find((x) => x[0].includes('siteverify')); const p = new URLSearchParams(c[1].body); return p.get('secret') === 'ts_secret' && p.get('response') === 'jeton-ts' && p.get('remoteip') === '192.0.2.9'; })());
check('la base reçoit l’adresse et l’IP (elle n’en garde que l’empreinte)', bodyOf(k, '/rpc/recommend_take')?.p_email === 'dirigeant@club.fr' && bodyOf(k, '/rpc/recommend_take')?.p_ip === '192.0.2.9');
check('compté comme « recommandation »', bodyOf(k, '/rpc/mail_log_add')?.p_kind === 'recommandation' && bodyOf(k, '/rpc/recommend_done')?.p_ok === true);
check('clé du serveur jamais envoyée à Resend ni à Cloudflare', !k.calls.filter((c) => !c[0].startsWith(env.url)).some((c) => JSON.stringify(c[1]).includes('sb_secret_faux')));

k = fake({ human: false }); r = await F.handle(req(B()), env, k.f);
check('robot : refusé (403), ni la base ni Resend', r.status === 403 && !hit(k, 'recommend_take') && !hit(k, 'resend'));
k = fake(); r = await F.handle(req(B({ captcha: '' })), env, k.f);
check('sans jeton anti-robots : refusé, rien appelé', r.status === 400 && k.calls.length === 0);
k = fake(); r = await F.handle(req(B()), { ...env, turnstile: '' }, k.f);
check('secret TURNSTILE_SECRET absent : rien ne part (503)', r.status === 503 && k.calls.length === 0);
k = fake({ take: null }); r = await F.handle(req(B()), env, k.f); b = await r.json();
check('la base refuse (adresse déjà recommandée, désinscrite…) : rien ne part, raison renvoyée', r.status === 403 && /impossible/.test(b.erreur) && !hit(k, 'resend'));
k = fake(); r = await F.handle(req(B({ email: 'pas une adresse' })), env, k.f);
check('adresse invalide : refusée avant tout appel', r.status === 400 && k.calls.length === 0);
k = fake(); r = await F.handle(req(B({ knows: false })), env, k.f);
check('« Je connais cette personne » obligatoire', r.status === 400 && k.calls.length === 0);
k = fake(); r = await F.handle(req(B({ first: '' })), env, k.f);
check('prénom obligatoire', r.status === 400 && k.calls.length === 0);
k = fake({ resendOk: false }); r = await F.handle(req(B()), env, k.f);
check('refus de Resend : noté « échec » (on pourra réessayer), 502', r.status === 502 && bodyOf(k, '/rpc/recommend_done')?.p_ok === false);
k = fake(); r = await F.handle(req(B({ first: 'Léa\r\nBcc: x@y.z', club: '<script>' })), env, k.f);
const inj = bodyOf(k, 'api.resend.com/emails');
check('saisie nettoyée : pas de saut de ligne dans l’objet, HTML échappé', !/[\r\n]/.test(inj.subject) && !/<script>/.test(inj.html));
r = await F.handle(new Request('https://x', { method: 'OPTIONS' }), env, fake().f);
check('appel depuis le navigateur autorisé (CORS)', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
r = await F.handle(new Request('https://x', { method: 'GET' }), env, fake().f);
check('seul POST est accepté', r.status === 405);
console.log(`\n   ${ok} réussis sur ${ok + ko} tests de recommandation`);
if (ko) process.exitCode = 1;
