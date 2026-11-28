// mypocketclub · bêta 1.9.0 · n° 311 : test de la fonction « vitrine-demande », sans réseau (Cloudflare, Supabase et Resend imités).
// Usage : node --experimental-strip-types --no-warnings tests/vitrine.test.mjs
const F = await import('../supabase/functions/vitrine-demande/index.ts');
let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log((c ? '  ok    · ' : '  ÉCHEC · ') + n); };
const CID = '11111111-2222-4333-8444-555555555555', TID = '66666666-7777-4888-8999-000000000000';
const env = { url: 'https://exemple.supabase.co', resendKey: 're_faux', service: 'sb_secret_faux', turnstile: 'ts_secret', from: 'mypocketclub <notifications@mypocketclub.fr>', appUrl: 'https://mypocketclub.fr/' };
function fake({ human = true, take = { id: 'r1', club: 'ES Montvert Basket', club_id: CID, team: 'U9 mixte', to_email: 'licences@club.fr', mail_ok: true }, resendOk = true } = {}) {
  const calls = [];
  const f = async (url, o = {}) => {
    calls.push([url, o]);
    const res = (s, b) => ({ ok: s < 300, status: s, json: async () => b });
    if (url.includes('turnstile/v0/siteverify')) return res(200, { success: human });
    if (url.endsWith('/rpc/vitrine_request_take')) return take ? res(200, take) : res(400, { message: 'Limite du jour atteinte : réessaie demain.' });
    if (url.endsWith('/rpc/mail_log_add')) return res(200, null);
    if (url === 'https://api.resend.com/emails') return resendOk ? res(200, { id: 'em_1' }) : res(422, { message: 'refus' });
    return res(404, {});
  };
  return { f, calls };
}
const req = (body, ip = '192.0.2.9') => new Request('https://x/functions/v1/vitrine-demande', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) });
const B = (o = {}) => ({ kind: 'essai', slug: 'esmontvertbasket91', team: TID, birth: 2017, name: 'Camille Dupont', contact: 'camille@exemple.fr', message: 'Il a déjà joué', consent: true, captcha: 'jeton', ...o });
const bodyOf = (k, end) => { const c = k.calls.find((x) => x[0].endsWith(end)); return c ? (typeof c[1].body === 'string' ? JSON.parse(c[1].body) : c[1].body) : null; };
const hit = (k, s) => k.calls.some((c) => c[0].includes(s));

let k = fake(), r = await F.handle(req(B()), env, k.f), b = await r.json(), m = bodyOf(k, 'api.resend.com/emails');
check('demande d’essai : envoyée', r.status === 200 && b.envoye === true);
check('ordre : anti-robots, base, e-mail, compteur', JSON.stringify(k.calls.map((c) => c[0].replace(/.*\/(rpc\/)?/, ''))) === '["siteverify","vitrine_request_take","emails","mail_log_add"]');
check('la base reçoit la demande et l’IP (elle n’en garde que l’empreinte)', (() => { const t = bodyOf(k, '/rpc/vitrine_request_take'); return t.p_slug === 'esmontvertbasket91' && t.p_kind === 'essai' && t.p_team === TID && t.p_birth === 2017 && t.p_ip === '192.0.2.9'; })());
check('un seul destinataire (celui donné par la base), depuis notifications@', JSON.stringify(m.to) === '["licences@club.fr"]' && /notifications@/.test(m.from) && !m.cc && !m.bcc);
check('« Répondre » répond au visiteur', m.reply_to === 'camille@exemple.fr');
check('objet et texte : équipe, année, nom, message, lien vers mpc', m.subject === 'Demande d’essai · U9 mixte · ES Montvert Basket' && m.text.includes('Année de naissance : 2017') && m.text.includes('Il a déjà joué') && m.text.includes('https://mypocketclub.fr/#ouvrir=' + CID + '.vitrine') && m.html.includes('logo-mypocketclub-mail.png'));
check('compté comme « vitrine »', bodyOf(k, '/rpc/mail_log_add')?.p_kind === 'vitrine');
check('clé du serveur jamais envoyée à Resend ni à Cloudflare', !k.calls.filter((c) => !c[0].startsWith(env.url)).some((c) => JSON.stringify(c[1]).includes('sb_secret_faux')));

k = fake(); r = await F.handle(req(B({ kind: 'ecrire', team: null, birth: null, subject: 'Devenir partenaire', message: 'Bonjour', contact: '06 00 00 00 00' })), env, k.f); m = bodyOf(k, 'api.resend.com/emails');
check('« Écrire au club » : objet, sans « Répondre » quand le contact est un téléphone', r.status === 200 && m.subject.startsWith('Message reçu par la vitrine · Devenir partenaire') && m.reply_to === undefined && m.text.includes('Pour répondre : 06 00 00 00 00'));
k = fake(); r = await F.handle(req(B({ kind: 'ecrire', message: '' })), env, k.f);
check('« Écrire au club » sans message : refusé avant tout appel', r.status === 400 && !k.calls.length);
k = fake({ human: false }); r = await F.handle(req(B()), env, k.f);
check('robot : refusé (403), ni la base ni Resend', r.status === 403 && !hit(k, 'vitrine_request_take') && !hit(k, 'resend'));
k = fake(); r = await F.handle(req(B({ consent: false })), env, k.f);
check('sans accord pour être recontacté : refusé', r.status === 400 && !k.calls.length);
k = fake(); r = await F.handle(req(B({ name: 'x' })), env, k.f);
check('nom trop court : refusé', r.status === 400 && !k.calls.length);
k = fake(); r = await F.handle(req(B({ slug: '../admin' })), env, k.f);
check('adresse de vitrine illisible : refusée', r.status === 400 && !k.calls.length);
k = fake({ take: null }); r = await F.handle(req(B()), env, k.f); b = await r.json();
check('limite de la base : 429 avec le message, pas d’e-mail', r.status === 429 && /Limite/.test(b.erreur) && !hit(k, 'resend'));
k = fake({ resendOk: false }); r = await F.handle(req(B()), env, k.f);
check('e-mail refusé par Resend : la demande reste dans mpc (200), compteur « raté »', r.status === 200 && bodyOf(k, '/rpc/mail_log_add')?.p_ok === false);
k = fake({ take: { id: 'r2', club: 'X', club_id: CID, to_email: 'a@b.fr', mail_ok: false } }); r = await F.handle(req(B()), env, k.f);
check('quota d’e-mails proche : pas d’e-mail, la demande reste dans mpc', r.status === 200 && !hit(k, 'resend'));
k = fake(); r = await F.handle(req(B({ message: '<script>alert(1)</script>' })), env, k.f); m = bodyOf(k, 'api.resend.com/emails');
check('le message ne peut pas injecter de HTML', !m.html.includes('<script>'));
r = await F.handle(new Request('https://x', { method: 'GET' }), env, fake().f);
check('GET refusé', r.status === 405);
r = await F.handle(req(B()), { ...env, turnstile: '' }, fake().f);
check('sans secret Turnstile : fermé (503)', r.status === 503);
console.log(`\n  ${ok} réussis sur ${ok + ko} tests (vitrine-demande)`);
if (ko) process.exit(1);
