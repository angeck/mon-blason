// mypocketclub · alpha 3.8.0 (3.9.0 : n° 109, expéditeur des convocations ; 4.2.0 : n° 112, envoi des convocations) · n° 107 · fonction d’envoi des e-mails (Supabase → Edge Functions)
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

// N° 109 · point 4 (décision de Gaël, 3 novembre 2026) : pour les convocations, le nom affiché de l'expéditeur est le nom du club
// tel que le président l'a réglé, suivi de la catégorie et du genre (« Boissy Basket 91 U9 F »), jamais le nom interne de l'équipe ;
// l'adresse reste notifications@mypocketclub.fr (aucune boîte par club) et les réponses vont au correspondant du club, sinon à contact@.
// Prêt, pas encore branché : l'envoi des convocations par e-mail attend la vérification en vrai et l'avis « Légal » (n° 107).
const GENRE: Record<string, string> = { Féminine: 'F', Masculine: 'M', Mixte: 'mixte' };
export const catGender = (t: { category?: string; gender?: string } | null | undefined) => (t ? [String(t.category || '').trim(), GENRE[String(t.gender)] || ''].filter(Boolean).join(' ') : '');
export function senderName(clubName: string, teams: Array<{ category?: string; gender?: string } | null>) {
  const cats = [...new Set((teams || []).map(catGender).filter(Boolean))].join(', ');
  return [String(clubName || '').trim(), cats].filter(Boolean).join(' ').replace(/["<>\\\r\n]/g, '').slice(0, 70) || 'mypocketclub';
}
export function convocationEnvelope(env: Env, clubName: string, teams: Array<{ category?: string; gender?: string } | null>, correspondentEmail?: string | null) {
  const addr = (/<([^>]+)>/.exec(env.from) || [, env.from])[1];
  const reply = correspondentEmail && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(correspondentEmail) ? correspondentEmail : env.replyTo;
  return { from: `"${senderName(clubName, teams)}" <${addr}>`, reply_to: reply };
}

// ---------- n° 112 · convocation envoyée au contact d'un club reçu ----------
// La base vérifie que la personne a la rubrique Événements (convocation_data) et la limite du jour (convocation_prepare).
// Réponses vers la personne qui envoie, copie à cette personne ; le PDF arrive déjà fabriqué par l'application.
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function parisParts(iso: string) {
  const f = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => f.find((x) => x.type === t)?.value || '';
  return { day: `${g('weekday')} ${g('day')} ${g('month')}`, time: `${Number(g('hour'))}h${g('minute')}` };
}
function weekend(from: string, to: string) {
  const a = new Date(from + 'T12:00:00Z'), b = new Date(to + 'T12:00:00Z');
  if (from === to) return `${DAYS[a.getUTCDay()]} ${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()} et ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}` : `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} et ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
}
export function convocationMail(d: any, step: string, version: number, to: { civ?: string; last?: string }) {
  const pre = step === 'P', club = String(d?.club?.name || ''), live = (d?.events || []) as any[];
  const teams = live.filter((x) => !x.cancelled).map((x) => x.team);
  const kind = pre ? 'Pré-convocation' : 'Convocation', upd = version > 1;
  const subject = `${kind} ${senderName(club, teams)}${upd ? ' (mise à jour)' : ''}`;
  const civ = to?.civ === 'Monsieur' ? 'Monsieur' : 'Madame', hello = `Bonjour ${civ} ${String(to?.last || '').trim()}`.trim() + ',';
  const lines = live.map((x) => {
    const p = parisParts(x.starts_at), cat = catGender(x.team) || x.team?.name || x.title;
    return `${cat} · ${club} – ${x.opponents || 'club reçu'} · ${p.day}${pre ? '' : ' à ' + p.time}${!pre && x.place ? ' · ' + x.place : ''}${x.cancelled ? ' · ANNULÉE' : ''}`;
  });
  const who = String(d?.sender?.name || '').trim(), when = weekend(String(d?.from || ''), String(d?.to || d?.from || ''));
  const intro = pre ? `${club} vous confirme les rencontres suivantes à domicile, le week-end du ${when}. Le gymnase et les horaires suivront dans la convocation définitive.`
    : `${club} aura le plaisir de vous accueillir le week-end du ${when}, aux dates et lieux suivants.`;
  const text = `${hello}\n\n${upd ? 'Mise à jour : ce document remplace la version précédente.\n\n' : ''}${intro}\n\n${lines.map((l) => '- ' + l).join('\n')}\n\nLe document est joint en PDF.\n\nSportivement,\n${who}${who ? ', ' : ''}${club}\n\n--\nEnvoyé avec mypocketclub · https://mypocketclub.fr`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#11162E;max-width:600px">
<p>${escHtml(hello)}</p>${upd ? '<p style="background:#FFF4D6;padding:8px 12px;border-radius:6px"><b>Mise à jour :</b> ce document remplace la version précédente.</p>' : ''}<p>${escHtml(intro)}</p>
<ul>${lines.map((l) => `<li>${escHtml(l)}</li>`).join('')}</ul><p>Le document est joint en PDF.</p>
<p>Sportivement,<br><b>${escHtml(who)}</b>${who ? ', ' : ''}${escHtml(club)}</p>
<p style="color:#5A6178;font-size:13px;border-top:1px solid #D8DCEA;padding-top:10px;margin-top:20px">Envoyé avec <span style="display:inline-block;background:#FFC93C;border-radius:4px;padding:0 4px;font-weight:800">my</span><b>pocket</b><b style="color:#2F5BFF">club</b> · <a href="https://mypocketclub.fr" style="color:#2F5BFF">mypocketclub.fr</a></p></div>`;
  return { subject, text, html };
}
async function rpc(env: Env, auth: string, doFetch: typeof fetch, name: string, args: unknown) {
  const r = await doFetch(env.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.anon, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const b = await r.json().catch(() => null);
  return { ok: r.ok, data: b };
}
async function sendConvocation(env: Env, auth: string, doFetch: typeof fetch, who: { email: string }, c: any) {
  const step = c?.step === 'C' ? 'C' : c?.step === 'P' ? 'P' : '', to = c?.to || {}, version = Math.max(1, Number(c?.version) || 1);
  if (!step || typeof c?.event_id !== 'string') return json({ erreur: 'convocation incomplète' }, 400);
  if (!EMAIL.test(String(to.email || '')) || !String(to.last || '').trim()) return json({ erreur: 'contact du club reçu incomplet (nom et e-mail)' }, 400);
  const pdf = String(c?.pdf || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(pdf) || pdf.length < 200 || pdf.length > 3_000_000 || !atob(pdf.slice(0, 12)).startsWith('%PDF')) return json({ erreur: 'PDF manquant ou trop lourd' }, 400);
  const data = await rpc(env, auth, doFetch, 'convocation_data', { p_event: c.event_id });
  if (!data.ok || !data.data?.club) return json({ erreur: 'réservé au correspondant rencontres, au vice-président et au président' }, 403);
  const d = data.data;
  const ini = String(d.club.name || 'PC').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').slice(0, 3) || 'PC';
  const ref = `${ini}-${String(d.from).replace(/-/g, '')}-${step}`;
  const prep = await rpc(env, auth, doFetch, 'convocation_prepare', { p_event: c.event_id, p_step: step, p_ref: ref, p_hash: '' });
  if (!prep.ok) return json({ erreur: 'envoi refusé' }, 403);
  if (Number(prep.data?.email_left) <= 0) return json({ erreur: 'limite d’envois du jour atteinte' }, 429);
  const sender = String(d.sender?.email || who.email || '');
  const envl = convocationEnvelope(env, d.club.name, (d.events || []).filter((x: any) => !x.cancelled).map((x: any) => x.team), sender);
  const m = convocationMail(d, step, version, to);
  const filename = String(c?.filename || 'Convocation.pdf').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
  const r = await doFetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env.resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: envl.from, to: [String(to.email)], cc: EMAIL.test(sender) ? [sender] : undefined, reply_to: envl.reply_to, subject: m.subject, text: m.text, html: m.html,
      attachments: [{ filename: filename.endsWith('.pdf') ? filename : filename + '.pdf', content: pdf }] }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ erreur: 'Resend a refusé l’envoi', detail: String(out?.message || r.status).slice(0, 200) }, 502);
  return json({ envoye: true, id: out?.id || null });
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
  if (body?.convocation) return sendConvocation(env, auth, doFetch, who, body.convocation); // n° 112
  if (!body?.test) return json({ erreur: 'seul l’e-mail de test ou une convocation peuvent partir' }, 400);
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
