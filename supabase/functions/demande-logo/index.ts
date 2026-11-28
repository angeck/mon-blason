// mypocketclub · bêta 1.9.1 (Gaël, 28 novembre 2026) : « Création de votre logo », dans Blason, couleurs et réglages du club.
// Le président envoie à mypocketclub un texte et des pièces jointes (anciens logos, photos de maillots sans personne, captures
// de ses réseaux…) ; Gaël crée le logo et les couleurs de base, puis les renvoie au club.
// Nom de la fonction : demande-logo. **« Verify JWT » ACTIVÉ** (seul un compte connecté peut appeler).
// Dans l'ordre :
//   1. le compte est lu avec son propre jeton (/auth/v1/user) ;
//   2. la base (logo_request_take, clé du serveur) vérifie qu'il est président du club, limite à 3 demandes par jour,
//      garde la demande (texte et noms des fichiers seulement) et notifie l'administrateur ;
//   3. un e-mail part aux administrateurs avec les pièces jointes ; « Répondre » répond au président. Compté (type « logo »).
// Les fichiers ne sont gardés nulle part dans mypocketclub : ils ne vivent que dans l'e-mail.
// Secrets (Supabase → Edge Functions → Secrets) : RESEND_API_KEY (déjà là). Facultatifs : MAIL_FROM, APP_URL.

export type Env = { url: string; resendKey: string; service: string; from: string };
export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const svcHeaders = (service: string) => ({ apikey: service, 'Content-Type': 'application/json', ...(service.startsWith('eyJ') ? { Authorization: 'Bearer ' + service } : {}) });

// Pièces jointes acceptées : images et PDF ; 6 au plus, 4 Mo chacune, 10 Mo en tout
export const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf'];
export const MAX_FILES = 6, MAX_ONE = 4 * 1024 * 1024, MAX_ALL = 10 * 1024 * 1024;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const fileName = (s: unknown) => String(s ?? '').replace(/[\\/:*?"<>|\r\n]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'piece-jointe';
export function checkFiles(list: unknown): { files: { filename: string; content: string }[]; erreur?: string } {
  const a = Array.isArray(list) ? list : [];
  if (a.length > MAX_FILES) return { files: [], erreur: `${MAX_FILES} pièces jointes au plus.` };
  let all = 0; const files: { filename: string; content: string }[] = [];
  for (const f of a) {
    const type = String(f?.type || ''), data = String(f?.data || '');
    if (!TYPES.includes(type)) return { files: [], erreur: `« ${fileName(f?.name)} » : seulement des images (PNG, JPG, WebP, GIF, SVG) ou des PDF.` };
    if (!data || !B64.test(data)) return { files: [], erreur: `« ${fileName(f?.name)} » est illisible.` };
    const size = Math.floor(data.length * 3 / 4);
    if (size > MAX_ONE) return { files: [], erreur: `« ${fileName(f?.name)} » dépasse 4 Mo.` };
    all += size; if (all > MAX_ALL) return { files: [], erreur: 'Les pièces jointes dépassent 10 Mo en tout.' };
    files.push({ filename: fileName(f?.name), content: data });
  }
  return { files };
}

export const LOGO_URL = 'https://mypocketclub.fr/img/logo-mypocketclub-mail.png';
function mailLayout(body: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#E9ECF5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#E9ECF5"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border-radius:20px;font-family:Arial,Helvetica,sans-serif;color:#11162E">
<tr><td style="padding:24px 28px 18px;border-bottom:4px solid #FFC93C"><a href="https://mypocketclub.fr"><img src="${LOGO_URL}" width="200" height="42" alt="mypocketclub" style="display:block;border:0;width:200px;height:42px"></a></td></tr>
<tr><td style="padding:24px 28px 8px;font-size:16px;line-height:1.5;color:#11162E">${body}</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #D8DCEA;font-size:12px;line-height:1.5;color:#4A5068">Tout ton club dans ta poche · <a href="https://mypocketclub.fr" style="color:#4A5068">mypocketclub.fr</a></td></tr>
</table></td></tr></table></body></html>`;
}
export function logoMail(t: { club: string; city: string; sport: string; president: string; president_email: string }, message: string, names: string[]) {
  const subject = `Demande de logo · ${t.club}`.slice(0, 140);
  const lines: [string, string][] = [['Club', [t.club, t.city].filter(Boolean).join(' · ')], ['Sport', t.sport || '—'], ['Président', t.president || '—'], ['Pour répondre', t.president_email || '—'], ['Pièces jointes', names.length ? names.join(', ') : 'aucune']];
  const text = `Bonjour,\n\n${t.club} demande la création de son logo et de ses couleurs de base.\n\n${lines.map(([a, b]) => `${a} : ${b}`).join('\n')}${message ? `\n\nSon message :\n${message}` : ''}\n\n« Répondre » écrit au président.\n\nTout ton club dans ta poche · https://mypocketclub.fr`;
  const html = mailLayout(`<p>Bonjour,</p><p><b>${escHtml(t.club)}</b> demande la création de son logo et de ses couleurs de base.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:8px 0 12px">${lines.map(([a, b]) => `<tr><td style="padding:6px 0;color:#4A5068;width:38%">${escHtml(a)}</td><td style="padding:6px 0;font-weight:bold">${escHtml(b)}</td></tr>`).join('')}</table>
${message ? `<p style="background:#F4F6FF;border-radius:12px;padding:12px 14px;white-space:pre-line">${escHtml(message)}</p>` : ''}
<p style="color:#4A5068;font-size:13px">« Répondre » écrit au président. La demande est aussi dans l'espace admin (À traiter).</p>`);
  return { subject, text, html };
}

export async function handle(req: Request, env: Env, doFetch: typeof fetch = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erreur: 'méthode refusée' }, 405);
  if (!env.service) return json({ erreur: 'Demande pas encore ouverte (réglage manquant).' }, 503);
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ erreur: 'Connecte-toi pour envoyer la demande.' }, 401);
  let body: any = {}; try { body = await req.json(); } catch { /* corps vide */ }
  const club = String(body?.club || '');
  const message = String(body?.message ?? '').replace(/[<>]/g, ' ').replace(/\r/g, '').trim().slice(0, 3000);
  if (!UUID.test(club)) return json({ erreur: 'Demande illisible.' }, 400);
  const fc = checkFiles(body?.files); if (fc.erreur) return json({ erreur: fc.erreur }, 400);
  // 1. qui appelle ?
  const u = await doFetch(env.url + '/auth/v1/user', { headers: { apikey: env.service, Authorization: auth } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!u?.id || !UUID.test(String(u.id))) return json({ erreur: 'Connecte-toi pour envoyer la demande.' }, 401);
  // 2. la base vérifie et range la demande
  const r = await doFetch(env.url + '/rest/v1/rpc/logo_request_take', { method: 'POST', headers: svcHeaders(env.service),
    body: JSON.stringify({ p_user: u.id, p_club: club, p_message: message, p_files: fc.files.map((f) => f.filename) }) });
  const t = await r.json().catch(() => null);
  if (!r.ok || !t?.id) { const msg = String(t?.message || ''); return json({ erreur: msg || 'Demande impossible pour le moment : réessaie plus tard.' }, /Limite/i.test(msg) ? 429 : 400); }
  // 3. l'e-mail aux administrateurs, avec les pièces jointes (la demande est déjà rangée : un refus ne la perd pas)
  const to = (Array.isArray(t.admins) ? t.admins : []).map(String).filter((x: string) => EMAIL.test(x));
  let mailed = false;
  if (env.resendKey && t.mail_ok && to.length) {
    const m = logoMail(t, message, fc.files.map((f) => f.filename));
    try {
      const s = await doFetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.resendKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.from, to, reply_to: EMAIL.test(String(t.president_email || '')) ? t.president_email : undefined, subject: m.subject, text: m.text, html: m.html,
          attachments: fc.files.length ? fc.files : undefined }) });
      mailed = s.ok;
    } catch { mailed = false; }
    try { await doFetch(env.url + '/rest/v1/rpc/mail_log_add', { method: 'POST', headers: svcHeaders(env.service), body: JSON.stringify({ p_kind: 'logo', p_club: club, p_ok: mailed }) }); } catch { /* le compteur ne bloque rien */ }
  }
  return json({ envoye: true, mail: mailed });
}

declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, {
    url: Deno.env.get('SUPABASE_URL') || '', resendKey: Deno.env.get('RESEND_API_KEY') || '',
    from: Deno.env.get('MAIL_FROM') || 'mypocketclub <notifications@mypocketclub.fr>',
    service: (() => { try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || ''; } catch { return ''; } })() || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  }).catch((e) => json({ erreur: String((e as Error)?.message || e) }, 500)));
}
