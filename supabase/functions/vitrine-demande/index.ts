// mypocketclub · bêta 1.9.0 · n° 311 (Gaël, 28 novembre 2026) : les deux formulaires de la vitrine publique du club
// (« Venir faire un essai » et « Écrire au club »), envoyés par un visiteur sans compte.
// Nom de la fonction : vitrine-demande. **« Verify JWT » DÉSACTIVÉ** (un visiteur n'a pas de jeton de connexion) :
// la protection est faite ici, dans cet ordre :
//   1. anti-robots Cloudflare Turnstile (secret TURNSTILE_SECRET, obligatoire : sans lui, rien ne part) ;
//   2. la base (vitrine_request_take, clé du serveur) : 20 demandes par club et par jour, 5 par visiteur et par jour (empreinte
//      de l'adresse IP seulement) ; la demande est rangée dans mpc (gardée 3 mois) et le destinataire reçoit une notification ;
//   3. un e-mail au destinataire (contact licences ou président par défaut, ou la personne choisie par le président), depuis
//      notifications@ ; « Répondre » répond au visiteur quand il a laissé une adresse e-mail. Compté dans le journal (type « vitrine »).
// Aucune coordonnée du club n'est jamais rendue au visiteur.
// Secrets (Supabase → Edge Functions → Secrets) : RESEND_API_KEY, TURNSTILE_SECRET (déjà là). Facultatifs : MAIL_FROM, APP_URL.

export type Env = { url: string; resendKey: string; service: string; turnstile: string; from: string; appUrl: string };
export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanText = (s: unknown, n: number) => String(s ?? '').replace(/[<>]/g, ' ').replace(/\r/g, '').trim().slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;
const svcHeaders = (service: string) => ({ apikey: service, 'Content-Type': 'application/json', ...(service.startsWith('eyJ') ? { Authorization: 'Bearer ' + service } : {}) });

// Même mise en page que les autres e-mails (n° 256) : carte blanche, logo, filet jaune, pied « Tout ton club dans ta poche »
export const LOGO_URL = 'https://mypocketclub.fr/img/logo-mypocketclub-mail.png';
export function mailLayout(body: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#E9ECF5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E9ECF5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border-radius:20px;font-family:Arial,Helvetica,sans-serif;color:#11162E">
<tr><td style="padding:24px 28px 18px;border-bottom:4px solid #FFC93C"><a href="https://mypocketclub.fr"><img src="${LOGO_URL}" width="200" height="42" alt="mypocketclub" style="display:block;border:0;width:200px;height:42px"></a></td></tr>
<tr><td style="padding:24px 28px 8px;font-size:16px;line-height:1.5;color:#11162E">${body}</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #D8DCEA;font-size:12px;line-height:1.5;color:#4A5068">Tout ton club dans ta poche · <a href="https://mypocketclub.fr" style="color:#4A5068">mypocketclub.fr</a></td></tr>
</table></td></tr></table></body></html>`;
}

export type Req = { kind: 'essai' | 'ecrire'; club: string; team: string; birth: number | null; name: string; contact: string; subject: string; message: string };
export function requestMail(r: Req, link: string) {
  const essai = r.kind === 'essai';
  const subject = (essai ? `Demande d’essai${r.team ? ' · ' + r.team : ''} · ${r.club}` : `Message reçu par la vitrine · ${r.subject || r.club}`).slice(0, 140);
  const lines: [string, string][] = essai
    ? [['Équipe', r.team || 'Pas précisée'], ['Année de naissance', r.birth ? String(r.birth) : 'Pas précisée'], ['Nom', r.name], ['Pour répondre', r.contact]]
    : [['C’est à propos de', r.subject || '—'], ['Nom', r.name], ['Pour répondre', r.contact]];
  const intro = essai ? `Une personne a demandé à venir faire un essai, depuis la vitrine de ${r.club}.` : `Une personne a écrit au club depuis la vitrine de ${r.club}.`;
  const text = `Bonjour,\n\n${intro}\n\n${lines.map(([a, b]) => `${a} : ${b}`).join('\n')}${r.message ? `\n\nSon message :\n${r.message}` : ''}\n\nLa demande est aussi dans mypocketclub (Vitrine du club), gardée 3 mois : ${link}\n\nTout ton club dans ta poche · https://mypocketclub.fr`;
  const html = mailLayout(`<p>Bonjour,</p><p>${escHtml(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:8px 0 12px">${lines.map(([a, b]) => `<tr><td style="padding:6px 0;color:#4A5068;width:42%">${escHtml(a)}</td><td style="padding:6px 0;font-weight:bold">${escHtml(b)}</td></tr>`).join('')}</table>
${r.message ? `<p style="background:#F4F6FF;border-radius:12px;padding:12px 14px;white-space:pre-line">${escHtml(r.message)}</p>` : ''}
<p><a href="${escHtml(link)}" style="display:inline-block;background:#2F5BFF;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">Ouvrir dans mypocketclub</a></p>
<p style="color:#4A5068;font-size:13px">La demande est gardée 3 mois dans mypocketclub, puis effacée. Le visiteur n’a vu aucune coordonnée du club.</p>`);
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
  if (!env.service || !env.turnstile) return json({ erreur: 'Formulaire pas encore ouvert (réglage manquant).' }, 503);
  let body: any = {}; try { body = await req.json(); } catch { /* corps vide */ }
  const kind = body?.kind === 'ecrire' ? 'ecrire' : body?.kind === 'essai' ? 'essai' : '';
  const slug = String(body?.slug || '').trim().toLowerCase(), token = String(body?.captcha || '');
  const name = clean(body?.name, 80), contact = clean(body?.contact, 120), subject = clean(body?.subject, 60), message = cleanText(body?.message, 1000);
  const team = UUID.test(String(body?.team || '')) ? String(body.team) : null;
  const birth = Number.isInteger(+body?.birth) && +body.birth > 1900 ? +body.birth : null;
  if (!kind || !SLUG.test(slug)) return json({ erreur: 'Demande illisible.' }, 400);
  if (name.length < 2) return json({ erreur: 'Indique ton prénom et ton nom.' }, 400);
  if (contact.length < 3) return json({ erreur: 'Indique un téléphone ou un e-mail pour la réponse.' }, 400);
  if (kind === 'ecrire' && message.length < 2) return json({ erreur: 'Écris ton message.' }, 400);
  if (!body?.consent) return json({ erreur: 'Coche « J’accepte que le club me recontacte ».' }, 400);
  if (!token) return json({ erreur: 'Vérification anti-robot manquante : réessaie.' }, 400);
  const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || '';
  // 1. Turnstile (Cloudflare)
  const form = new URLSearchParams({ secret: env.turnstile, response: token }); if (ip) form.set('remoteip', ip);
  const ts = await doFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json()).catch(() => null);
  if (!ts?.success) return json({ erreur: 'La vérification anti-robot a échoué : réessaie.' }, 403);
  // 2. la base range la demande et prévient le destinataire dans mpc
  const t = await rpc(env, doFetch, 'vitrine_request_take', { p_slug: slug, p_kind: kind, p_team: team, p_birth: birth, p_name: name, p_contact: contact, p_subject: subject, p_message: message, p_ip: ip });
  if (!t.ok || !t.data?.id) {
    const msg = String(t.data?.message || '');
    return json({ erreur: msg || 'Demande impossible pour le moment : réessaie plus tard.' }, /Limite/i.test(msg) ? 429 : 400);
  }
  // 3. l'e-mail au destinataire (la demande est déjà dans mpc : un e-mail refusé ne la perd pas)
  const to = String(t.data.to_email || '');
  if (env.resendKey && t.data.mail_ok && EMAIL.test(to)) {
    const cid = UUID.test(String(t.data.club_id || '')) ? String(t.data.club_id) : '';
    const link = (env.appUrl || 'https://angeck.github.io/mon-blason/').replace(/#.*$/, '') + (cid ? '#ouvrir=' + cid + '.vitrine' : '');
    const m = requestMail({ kind, club: String(t.data.club || ''), team: String(t.data.team || ''), birth, name, contact, subject, message }, link);
    let ok = false;
    try {
      const r = await doFetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.from, to: [to], reply_to: EMAIL.test(contact) ? contact : undefined, subject: m.subject, text: m.text, html: m.html }) });
      ok = r.ok;
    } catch { ok = false; }
    try { await doFetch(env.url + '/rest/v1/rpc/mail_log_add', { method: 'POST', headers: svcHeaders(env.service), body: JSON.stringify({ p_kind: 'vitrine', p_club: null, p_ok: ok }) }); } catch { /* le compteur ne bloque rien */ }
  }
  return json({ envoye: true });
}

declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, {
    url: Deno.env.get('SUPABASE_URL') || '', resendKey: Deno.env.get('RESEND_API_KEY') || '', turnstile: Deno.env.get('TURNSTILE_SECRET') || '',
    from: Deno.env.get('MAIL_FROM') || 'mypocketclub <notifications@mypocketclub.fr>',
    appUrl: Deno.env.get('APP_URL') || 'https://angeck.github.io/mon-blason/',
    service: (() => { try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || ''; } catch { return ''; } })() || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  }).catch((e) => json({ erreur: String((e as Error)?.message || e) }, 500)));
}
