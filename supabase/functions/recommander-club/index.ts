// mypocketclub · alpha 5.12.0 · n° 162 (façon 2, décisions de Gaël du 13 novembre 2026) : recommander mypocketclub au dirigeant
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

// Texte proposé par Claude le 13 novembre 2026, à confirmer par Gaël (claude/17-mails-types.md) ; tutoiement.
export function recommendMail(first: string, club: string, link: string) {
  const who = first || 'Un membre de ton club';
  const p1 = `${who}${first ? ', un membre de ton club,' : ''} te recommande mypocketclub${club ? ` pour ${club}` : ''}.`;
  const p2 = 'mypocketclub est une application pour les clubs sportifs : l’agenda avec les réponses « Je viens / Je ne viens pas », les convocations, les messages des équipes, les licences et les cotisations, au même endroit, dans la poche de chacun.';
  const p3 = 'C’est gratuit pour l’essayer : jusqu’à la fin de la saison pour tout ton club, ou pendant une saison complète pour une seule équipe.';
  const foot = 'Tu reçois ce message parce qu’une personne a saisi ton adresse sur mypocketclub pour te le recommander. Il n’y en aura pas d’autre : une adresse ne reçoit qu’une recommandation. Pour ne plus jamais rien recevoir de mypocketclub : ';
  const text = `Bonjour,\n\n${p1}\n\n${p2}\n\n${p3}\n\nPour en savoir plus ou inscrire ton club : https://mypocketclub.fr\nUne question ? Réponds simplement à ce message.\n\nSportivement,\nGaël Raveneau, mypocketclub\n\n—\n${foot}${link}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#11162E;max-width:560px">
<p style="margin:0 0 16px"><span style="display:inline-block;background:#FFC93C;border-radius:6px;padding:0 6px;font-weight:800">my</span><b>pocket</b><b style="color:#2F5BFF">club</b></p>
<p>Bonjour,</p><p>${escHtml(p1)}</p><p>${escHtml(p2)}</p><p><b>${escHtml(p3)}</b></p>
<p><a href="https://mypocketclub.fr" style="display:inline-block;background:#2F5BFF;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">Découvrir mypocketclub</a></p>
<p>Une question ? Réponds simplement à ce message.</p><p>Sportivement,<br><b>Gaël Raveneau</b>, mypocketclub</p>
<p style="color:#5A6178;font-size:13px;border-top:1px solid #D8DCEA;padding-top:10px;margin-top:20px">${escHtml(foot)}<a href="${escHtml(link)}" style="color:#5A6178">me désinscrire</a>.</p></div>`;
  const subject = (first ? `${first} te recommande mypocketclub` : 'Un membre de ton club te recommande mypocketclub').slice(0, 120);
  return { subject, text, html };
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
  if (!first || !club) return json({ erreur: 'Indique ton prénom et le nom du club.' }, 400);
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
