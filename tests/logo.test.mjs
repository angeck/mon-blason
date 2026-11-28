// mypocketclub · bêta 1.9.1 : tests de la fonction Edge « demande-logo » (sans réseau : faux fetch, données fictives)
import { handle, checkFiles, fileName } from '../supabase/functions/demande-logo/index.ts';

const R = []; const check = (n, c) => R.push([n, !!c]);
const ENV = { url: 'https://x.supabase.co', resendKey: 're_test', service: 'sb_secret_test', from: 'mypocketclub <notifications@mypocketclub.fr>' };
const CLUB = '11111111-1111-1111-1111-111111111111', USER = '22222222-2222-2222-2222-222222222222';
const png = Buffer.from('faux png').toString('base64');
function fake(opts = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push([String(url), init]);
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify(opts.user === null ? {} : { id: USER }), { status: opts.user === null ? 401 : 200 });
    if (String(url).includes('/rpc/logo_request_take')) {
      if (opts.rpcErr) return new Response(JSON.stringify({ message: opts.rpcErr }), { status: 400 });
      return new Response(JSON.stringify({ id: 'r1', club: 'BC Test', city: 'Testville', sport: 'Basket-ball', president: 'Paul Pres', president_email: 'paul@exemple.invalid', admins: ['admin@exemple.invalid'], mail_ok: true }));
    }
    if (String(url).includes('api.resend.com')) return new Response('{}', { status: opts.resend || 200 });
    return new Response('null');
  };
  return { f, calls };
}
const req = (body, auth = 'Bearer jeton') => new Request('https://f/demande-logo', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) });

check('nom de fichier nettoyé', fileName('a/b:c*.png') === 'a_b_c_.png');
check('type refusé (.exe)', !!checkFiles([{ name: 'x.exe', type: 'application/x-msdownload', data: png }]).erreur);
check('7 fichiers : refusé', !!checkFiles(Array(7).fill({ name: 'a.png', type: 'image/png', data: png })).erreur);
check('fichier de plus de 4 Mo : refusé', !!checkFiles([{ name: 'a.png', type: 'image/png', data: 'A'.repeat(6 * 1024 * 1024) }]).erreur);
check('image et PDF acceptés', checkFiles([{ name: 'a.png', type: 'image/png', data: png }, { name: 'b.pdf', type: 'application/pdf', data: png }]).files.length === 2);

let t = fake(); let r = await handle(req({ club: CLUB, message: 'Un logo bleu', files: [{ name: 'a.png', type: 'image/png', data: png }] }), ENV, t.f); let b = await r.json();
const rpc = t.calls.find((c) => c[0].includes('logo_request_take')), mail = t.calls.find((c) => c[0].includes('resend'));
check('demande acceptée et envoyée par e-mail', r.status === 200 && b.envoye && b.mail);
check('la base reçoit le compte lu par son jeton, pas un compte envoyé par le navigateur', JSON.parse(rpc[1].body).p_user === USER && JSON.parse(rpc[1].body).p_files[0] === 'a.png');
const m = JSON.parse(mail[1].body);
check('e-mail aux administrateurs, « Répondre » au président, pièce jointe', m.to[0] === 'admin@exemple.invalid' && m.reply_to === 'paul@exemple.invalid' && m.attachments.length === 1 && m.attachments[0].filename === 'a.png' && m.subject.includes('BC Test'));
check('compté dans le journal des e-mails (type logo)', t.calls.some((c) => c[0].includes('mail_log_add') && JSON.parse(c[1].body).p_kind === 'logo'));

t = fake(); r = await handle(req({ club: CLUB, message: 'x' }, ''), ENV, t.f);
check('sans connexion : refusé (401)', r.status === 401 && !t.calls.length);
t = fake({ user: null }); r = await handle(req({ club: CLUB, message: 'x' }), ENV, t.f);
check('jeton invalide : refusé (401), rien en base', r.status === 401 && !t.calls.some((c) => c[0].includes('rpc')));
t = fake({ rpcErr: 'Réservé au président du club' }); r = await handle(req({ club: CLUB, message: 'x' }), ENV, t.f); b = await r.json();
check('pas président : message de la base, pas d’e-mail', r.status === 400 && b.erreur === 'Réservé au président du club' && !t.calls.some((c) => c[0].includes('resend')));
t = fake({ rpcErr: 'Limite atteinte : 3 demandes par jour. Réessaie demain.' }); r = await handle(req({ club: CLUB, message: 'x' }), ENV, t.f);
check('limite du jour : 429', r.status === 429);
t = fake(); r = await handle(req({ club: 'pas-un-id', message: 'x' }), ENV, t.f);
check('club illisible : 400', r.status === 400);
t = fake({ resend: 500 }); r = await handle(req({ club: CLUB, message: 'x' }), ENV, t.f); b = await r.json();
check('e-mail refusé : la demande reste gardée (envoyée, mail = false)', b.envoye && b.mail === false);

R.forEach(([n, ok]) => console.log(`  ${ok ? 'ok   ' : 'ÉCHEC'} · ${n}`));
console.log(`\n  ${R.filter((x) => x[1]).length} réussis sur ${R.length} tests (demande-logo)`);
if (R.some((x) => !x[1])) process.exit(1);
