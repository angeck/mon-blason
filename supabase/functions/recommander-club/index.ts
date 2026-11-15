// mypocketclub · alpha 5.12.0 (5.17.0 : n° 256, logo et mise en page commune) · n° 162 (façon 2, décisions de Gaël du 13 novembre 2026) : recommander mypocketclub au dirigeant
// de son club, depuis l'écran d'ouverture, sans compte.
// Nom de la fonction : recommander-club. **« Verify JWT » DÉSACTIVÉ** (un visiteur n'a pas de jeton de connexion) :
// la protection est faite ici, dans cet ordre :
//   1. anti-robots Cloudflare Turnstile (secret TURNSTILE_SECRET, obligatoire : sans lui, rien ne part) ;
//   2. la base (recommend_take, clé du serveur) : une recommandation par adresse pour toujours, 3 par visiteur et par jour,
//      20 en tout par jour, jamais une adresse de la liste noire, d'un compte ou déjà démarchée ; elle ne garde que des empreintes ;
//   3. un seul destinataire, depuis info.mypocketclub.fr (sous-domaine des e-mails d'information), avec lien de désinscription
//      (List-Unsubscribe) ; réponses sur contact@. Compté dans le journal des e-mails (type « recommandation »).
// Secrets (Supabase → Edge Functions → Secrets) : RESEND_API_KEY (déjà là), TURNSTILE_SECRET (la « Secret Key » du widget
// Turnstile, la même que dans Authentication → Bot and Abuse Protection). Facultatifs : MAIL_INFO_FROM, MAIL_REPLY_TO, APP_URL.
// SUPABASE_URL et la clé du serveur sont fournis d'office par Supabase. Aucune bibliothèque extérieure.

export type Env = { url: string; resendKey: string; service: string; turnstile: string; infoFrom: string; replyTo: string; appUrl: string };
export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const svcHeaders = (service: string) => ({ apikey: service, 'Content-Type': 'application/json', ...(service.startsWith('eyJ') ? { Authorization: 'Bearer ' + service } : {}) });

// ---------- 5.17.0 · n° 256 · une seule mise en page pour tous les e-mails ----------
// Carte blanche de 520 px centrée sur fond gris clair : logo complet (PNG, Gmail et Outlook n'affichent pas les SVG) avec un filet
// jaune, le texte, puis un pied « Tout ton club dans ta poche ». Des tableaux plutôt que des blocs : c'est ce que lisent tous les
// logiciels de messagerie. Même mise en page recopiée dans recommander-club (une fonction Edge ne peut pas importer l'autre).
// Le logo est servi par le vrai site : https://mypocketclub.fr/img/logo-mypocketclub-mail.png (publié avec la 5.17.0).
export const LOGO_URL = 'https://mypocketclub.fr/img/logo-mypocketclub-mail.png';
export const SLOGAN = 'Tout ton club dans ta poche';
export const TEXT_FOOT = SLOGAN + ' · https://mypocketclub.fr';
export const BRAND_LINE = 'mypocketclub, tout ton club dans ta poche';
export const BRAND_PITCH = 'L\u2019application qui fait vivre ton club : agenda, appel, convocations, messages, cotisations, exercices, tactiques. Pour le bureau, les coachs, les joueurs et les familles.';
export const TRY_FREE = 'Teste gratuitement : tout ton club jusqu\u2019à la fin de la saison, ou une équipe pendant une saison complète.';
export function mailLayout(body: string, o: { small?: boolean; foot?: string } = {}) {
  const w = o.small ? 150 : 200, h = o.small ? 32 : 42;
  const foot = o.foot ?? `${SLOGAN} · <a href="https://mypocketclub.fr" style="color:#4A5068">mypocketclub.fr</a>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#E9ECF5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E9ECF5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border-radius:20px;font-family:Arial,Helvetica,sans-serif;color:#11162E">
<tr><td style="padding:24px 28px 18px;border-bottom:4px solid #FFC93C"><a href="https://mypocketclub.fr"><img src="${LOGO_URL}" width="${w}" height="${h}" alt="mypocketclub" style="display:block;border:0;width:${w}px;height:${h}px"></a></td></tr>
<tr><td style="padding:24px 28px 8px;font-size:16px;line-height:1.5;color:#11162E">${body}</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #D8DCEA;font-size:12px;line-height:1.5;color:#4A5068">${foot}</td></tr>
</table></td></tr></table></body></html>`;
}

// 5.17.0 · n° 256 : corps commun de la recommandation et du démarchage ; seules la ou les phrases d'ouverture et le pied (motif,
// désinscription) changent. Recopié à l'identique dans recommander-club (vérifié par les tests).
export function pitchMail(open: string[], foot: string, link: string) {
  const text = `Bonjour,\n\n${open.join('\n\n')}\n\n${BRAND_LINE}. ${BRAND_PITCH}\n\n${TRY_FREE}\n\nPour en savoir plus ou inscrire ton club : https://mypocketclub.fr\nUne question ? Réponds simplement à ce message.\n\nSportivement,\nGaël Raveneau, mypocketclub\n\n—\n${foot}${link}\n\n${TEXT_FOOT}`;
  const html = mailLayout(`<p>Bonjour,</p>${open.map((x) => `<p>${escHtml(x)}</p>`).join('')}<p><b>${escHtml(BRAND_LINE)}.</b> ${escHtml(BRAND_PITCH)}</p><p><b>${escHtml(TRY_FREE)}</b></p>
<p><a href="https://mypocketclub.fr" style="display:inline-block;background:#2F5BFF;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">Découvrir mypocketclub</a></p>
<p>Une question ? Réponds simplement à ce message.</p><p>Sportivement,<br><b>Gaël Raveneau</b>, mypocketclub</p>
<p style="color:#4A5068;font-size:13px;border-top:1px solid #D8DCEA;padding-top:10px;margin-top:20px">${escHtml(foot)}<a href="${escHtml(link)}" style="color:#4A5068">me désinscrire</a>.</p>`);
  return { text, html };
}

// Texte proposé par Claude le 13 novembre 2026, revu par Gaël le 15 novembre (n° 256) ; tutoiement.
export function recommendMail(first: string, club: string, link: string) {
  const who = first || 'Un membre de ton club';
  const p1 = `${who}${first ? ', un membre de ton club,' : ''} te recommande mypocketclub${club ? ` pour ${club}` : ''}.`;
  const foot = 'Tu reçois ce message parce qu\u2019une personne a saisi ton adresse sur mypocketclub pour te le recommander. Il n\u2019y en aura pas d\u2019autre : une adresse ne reçoit qu\u2019une recommandation. Pour ne plus jamais rien recevoir de mypocketclub : ';
  const subject = (first ? `${first} te recommande mypocketclub` : 'Un membre de ton club te recommande mypocketclub').slice(0, 120);
  return { subject, ...pitchMail([p1], foot, link) };
}

async function rpc(env: Env, doFetch: typeof fetch, name: string, args: unknown) {
  const r = await doFetch(env.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: svcHeaders(env.service), body: JSON.stringify(args) });
  const b = await r.json().catch(() => null);
  return { ok: r.ok, data: b };
}

export async function handle(req: Request, env: Env, doFetch: typeof fetch = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erreur: 'méthode refusée' }, 405);
  if (!env.resendKey || !env.service || !env.turnstile) return json({ erreur: 'recommandation pas encore ouverte (réglage manquant)' }, 503);
  let body: any = {}; try { body = await req.json(); } catch { /* corps vide */ }
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 160), first = clean(body?.first, 40), club = clean(body?.club, 80), token = String(body?.captcha || '');
  if (!EMAIL.test(email)) return json({ erreur: 'Adresse e-mail à vérifier.' }, 400);
  if (!club) return json({ erreur: 'Indique le nom du club.' }, 400); // 5.13.0 · n° 236 : le prénom de la personne est facultatif
  if (!body?.knows) return json({ erreur: 'Coche « Je connais cette personne ».' }, 400);
  if (!token) return json({ erreur: 'Vérification anti-robot manquante : réessaie.' }, 400);
  const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '';
  // 1. Turnstile (Cloudflare)
  const form = new URLSearchParams({ secret: env.turnstile, response: token }); if (ip) form.set('remoteip', ip);
  const ts = await doFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json()).catch(() => null);
  if (!ts?.success) return json({ erreur: 'La vérification anti-robot a échoué : réessaie.' }, 403);
  // 2. la base décide (et garde seulement des empreintes)
  const t = await rpc(env, doFetch, 'recommend_take', { p_email: email, p_ip: ip });
  const tok = String(t.data?.token || '');
  if (!t.ok || !/^[a-f0-9]{32,80}$/.test(tok)) {
    const msg = String(t.data?.message || '');
    return json({ erreur: msg || 'Recommandation impossible pour le moment.' }, /Limite/i.test(msg) ? 429 : 403);
  }
  // 3. un seul e-mail, depuis info.
  const link = (env.appUrl || 'https://angeck.github.io/mon-blason/').replace(/#.*$/, '') + '#desinscription=' + tok;
  const m = recommendMail(first, club, link);
  let ok = false;
  try {
    const r = await doFetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.resendKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.infoFrom, to: [email], reply_to: env.replyTo, subject: m.subject, text: m.text, html: m.html, headers: { 'List-Unsubscribe': `<${link}>` } }) });
    ok = r.ok;
  } catch { ok = false; }
  await rpc(env, doFetch, 'recommend_done', { p_email: email, p_ok: ok });
  try { await doFetch(env.url + '/rest/v1/rpc/mail_log_add', { method: 'POST', headers: svcHeaders(env.service), body: JSON.stringify({ p_kind: 'recommandation', p_club: null, p_ok: ok }) }); } catch { /* le compteur ne bloque rien */ }
  if (!ok) return json({ erreur: 'L’e-mail n’est pas parti : réessaie plus tard.' }, 502);
  return json({ envoye: true });
}

declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, {
    url: Deno.env.get('SUPABASE_URL') || '', resendKey: Deno.env.get('RESEND_API_KEY') || '', turnstile: Deno.env.get('TURNSTILE_SECRET') || '',
    infoFrom: Deno.env.get('MAIL_INFO_FROM') || 'mypocketclub <bonjour@info.mypocketclub.fr>', replyTo: Deno.env.get('MAIL_REPLY_TO') || 'contact@mypocketclub.fr',
    appUrl: Deno.env.get('APP_URL') || 'https://angeck.github.io/mon-blason/',
    service: (() => { try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || ''; } catch { return ''; } })() || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  }).catch((e) => json({ erreur: String((e as Error)?.message || e) }, 500)));
}
