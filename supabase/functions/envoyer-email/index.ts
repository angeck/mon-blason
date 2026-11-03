// mypocketclub · alpha 3.8.0 · n° 107 · fonction d'envoi des e-mails (Supabase → Edge Functions)
// Nom de la fonction : envoyer-email
// Première étape : un e-mail de test, envoyé par l'administrateur de mypocketclub à sa propre adresse, depuis
// notifications@mypocketclub.fr, réponses vers contact@mypocketclub.fr, par Resend (domaine mypocketclub.fr vérifié le 3 novembre 2026).
// Rien d'autre n'est envoyé : les vrais e-mails (convocations…) viendront ensuite, un par un, après l'avis « Légal ».
// Aucune bibliothèque extérieure.
//
// Secret à créer dans Supabase → Edge Functions → Secrets (par Gaël, jamais dans le code, le projet ou une conversation) :
//   RESEND_API_KEY   clé d'accès de Resend (« Sending access », domaine mypocketclub.fr)
// Facultatifs : MAIL_FROM (par défaut « mypocketclub <notifications@mypocketclub.fr> »), MAIL_REPLY_TO (par défaut contact@mypocketclub.fr).
// SUPABASE_URL et SUPABASE_ANON_KEY sont fournis d'office par Supabase. « Verify JWT » reste activé : seule une personne connectée peut appeler.

export type Env = { url: string; anon: string; resendKey: string; from: string; replyTo: string };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const escHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// Contenu de l'e-mail de test (texte et HTML simples, lisibles partout)
export function testMail(name: string, when: Date) {
  const d = when.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' });
  const hello = name ? `Bonjour ${name},` : 'Bonjour,';
  const text = `${hello}\n\nCet e-mail de test a été envoyé par mypocketclub le ${d}, depuis l'adresse notifications@mypocketclub.fr.\nS'il est bien arrivé, la chaîne d'envoi fonctionne : Supabase, Resend et le domaine mypocketclub.fr.\n\nUne réponse à cet e-mail arrive sur contact@mypocketclub.fr.\n\nmypocketclub · https://mypocketclub.fr`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#11162E;max-width:560px">
<p style="margin:0 0 16px"><span style="display:inline-block;background:#FFC93C;border-radius:6px;padding:0 6px;font-weight:800">my</span><b>pocket</b><b style="color:#2F5BFF">club</b></p>
<p>${escHtml(hello)}</p><p>Cet e-mail de test a été envoyé par mypocketclub le ${escHtml(d)}, depuis l'adresse <b>notifications@mypocketclub.fr</b>.</p>
<p>S'il est bien arrivé, la chaîne d'envoi fonctionne : Supabase, Resend et le domaine mypocketclub.fr.</p>
<p style="color:#5A6178;font-size:14px">Une réponse à cet e-mail arrive sur contact@mypocketclub.fr.</p>
<p style="color:#5A6178;font-size:14px">mypocketclub · <a href="https://mypocketclub.fr" style="color:#2F5BFF">mypocketclub.fr</a></p></div>`;
  return { subject: 'mypocketclub · e-mail de test', text, html };
}

// Qui appelle ? (le jeton de la personne connectée, vérifié par Supabase)
async function caller(env: Env, auth: string, doFetch: typeof fetch) {
  const h = { apikey: env.anon, Authorization: auth };
  const u = await doFetch(env.url + '/auth/v1/user', { headers: h });
  if (!u.ok) return null;
  const user = await u.json();
  const a = await doFetch(env.url + '/rest/v1/rpc/is_app_admin', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
  const admin = a.ok ? (await a.json()) === true : false;
  const p = await doFetch(env.url + '/rest/v1/rpc/my_profile', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
  const prof = p.ok ? await p.json() : null;
  return { email: String(user?.email || ''), admin, name: String(prof?.first_name || '') };
}

export async function handle(req: Request, env: Env, doFetch: typeof fetch = fetch, now = new Date()) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erreur: 'méthode refusée' }, 405);
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ erreur: 'connexion demandée' }, 401);
  if (!env.resendKey) return json({ erreur: 'clé RESEND_API_KEY manquante dans les Secrets' }, 500);
  const who = await caller(env, auth, doFetch);
  if (!who || !who.email) return json({ erreur: 'connexion demandée' }, 401);
  let body: any = {}; try { body = await req.json(); } catch { /* corps vide */ }
  if (!body?.test) return json({ erreur: 'seul l’e-mail de test est disponible pour l’instant' }, 400);
  if (!who.admin) return json({ erreur: 'réservé à l’administrateur de mypocketclub' }, 403);
  const m = testMail(who.name, now);
  const r = await doFetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.from, to: [who.email], reply_to: env.replyTo, subject: m.subject, text: m.text, html: m.html }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ erreur: 'Resend a refusé l’envoi', detail: String(out?.message || r.status).slice(0, 200) }, 502);
  return json({ envoye: true, to: who.email, id: out?.id || null });
}

// Point d'entrée dans Supabase
declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, {
    url: Deno.env.get('SUPABASE_URL') || '', anon: Deno.env.get('SUPABASE_ANON_KEY') || '', resendKey: Deno.env.get('RESEND_API_KEY') || '',
    from: Deno.env.get('MAIL_FROM') || 'mypocketclub <notifications@mypocketclub.fr>', replyTo: Deno.env.get('MAIL_REPLY_TO') || 'contact@mypocketclub.fr',
  }).catch((e) => json({ erreur: String((e as Error)?.message || e) }, 500)));
}
