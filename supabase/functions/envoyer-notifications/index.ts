// Pocket Club · étape B 3 sur 5 · fonction d'envoi des notifications (Supabase → Edge Functions)
// Nom de la fonction : envoyer-notifications
// Elle prend les notifications en attente dans la base (push_claim), les chiffre pour chaque téléphone
// (norme Web Push, chiffrement aes128gcm et signature VAPID) et les envoie au service du téléphone
// (Google, Apple, Mozilla…). Elle note ensuite le résultat (push_result) et retire les téléphones disparus.
// Aucune bibliothèque extérieure : seulement le chiffrement intégré (WebCrypto).
//
// Secrets à créer dans Supabase → Edge Functions → Secrets :
//   VAPID_PUBLIC_KEY   clé publique (la même que dans config.js de l'application)
//   VAPID_PRIVATE_KEY  clé privée (jamais publiée)
//   VAPID_SUBJECT      adresse de contact, ex. mailto:gael.monblason@gmail.com
//   PUSH_SECRET        mot de passe que le programme automatique (étape 4) joint à chaque appel
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis d'office par Supabase.

const enc = new TextEncoder();
const b64u = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)),
};
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

// Chiffrement d'un message pour un téléphone (RFC 8291 + RFC 8188, un seul bloc)
export async function encryptPayload(p256dh: string, authSecret: string, payload: string) {
  const uaPublic = b64u.dec(p256dh), auth = b64u.dec(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // taille de bloc 4096
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Signature VAPID : prouve au service du téléphone que le message vient bien de Pocket Club
let signKey: CryptoKey | null = null;
export async function vapidHeader(endpoint: string, pub: string, priv: string, subject: string) {
  if (!signKey) {
    const p = b64u.dec(pub);
    signKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: priv, x: b64u.enc(p.slice(1, 33)), y: b64u.enc(p.slice(33, 65)), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  const head = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, enc.encode(head + '.' + body)));
  return `vapid t=${head}.${body}.${b64u.enc(sig)}, k=${pub}`;
}

type Row = { queue_id: number; endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string };
type Env = { url: string; key: string; pub: string; priv: string; subject: string };

async function rpc(env: Env, fn: string, args: unknown) {
  const headers: Record<string, string> = { apikey: env.key, 'Content-Type': 'application/json' };
  if (env.key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + env.key;
  const r = await fetch(`${env.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn} : ${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}

// Envoie à un téléphone ; renvoie « ok », « parti » (téléphone désinscrit) ou un message d'erreur
export async function sendOne(env: Env, r: Row, doFetch: typeof fetch = fetch): Promise<string> {
  try {
    const body = await encryptPayload(r.p256dh, r.auth, JSON.stringify({ title: r.title, body: r.body, url: r.url, tag: r.tag }));
    const res = await doFetch(r.endpoint, { method: 'POST', body, headers: {
      Authorization: await vapidHeader(r.endpoint, env.pub, env.priv, env.subject),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal',
    } });
    if (res.ok) return 'ok';
    if (res.status === 404 || res.status === 410) return 'parti';
    return `${res.status} ${(await res.text()).slice(0, 120)}`;
  } catch (e) { return String((e as Error)?.message || e).slice(0, 160); }
}

// Un passage : jusqu'à 5 lots de 200 notifications
export async function runOnce(env: Env, doFetch: typeof fetch = fetch) {
  let sent = 0, failed = 0, gone = 0;
  for (let round = 0; round < 5; round++) {
    const rows: Row[] = (await rpc(env, 'push_claim', { p_limit: 200 })) || [];
    if (!rows.length) break;
    const res = await Promise.all(rows.map((r) => sendOne(env, r, doFetch).then((x) => [r, x] as const)));
    const okIds = new Set<number>(), errIds = new Set<number>(), goneEp: string[] = []; let lastErr = '';
    for (const [r, x] of res) {
      if (x === 'ok') okIds.add(r.queue_id);
      else if (x === 'parti') { goneEp.push(r.endpoint); okIds.add(r.queue_id); gone++; }   // rien à réessayer pour ce téléphone
      else { errIds.add(r.queue_id); lastErr = x; }
    }
    for (const id of okIds) errIds.delete(id);   // une notification est envoyée dès qu'un téléphone de la personne l'a reçue
    sent += okIds.size; failed += errIds.size;
    await rpc(env, 'push_result', { p_sent: [...okIds], p_failed: [...errIds], p_gone: goneEp, p_error: lastErr || null });
    if (rows.length < 200) break;
  }
  if (new Date().getUTCMinutes() === 0) await rpc(env, 'push_cleanup', {}).catch(() => {});   // ménage une fois par heure
  return { sent, failed, gone };
}

// Point d'entrée dans Supabase
declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve(async (req: Request) => {
    const secret = Deno.env.get('PUSH_SECRET') || '';
    if (!secret || req.headers.get('x-pocket-secret') !== secret) return new Response(JSON.stringify({ erreur: 'accès refusé' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    const env: Env = {
      url: Deno.env.get('SUPABASE_URL'), key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '',
      pub: Deno.env.get('VAPID_PUBLIC_KEY') || '', priv: Deno.env.get('VAPID_PRIVATE_KEY') || '', subject: Deno.env.get('VAPID_SUBJECT') || 'mailto:gael.monblason@gmail.com',
    };
    if (!env.key) return new Response(JSON.stringify({ erreur: 'clé de service introuvable' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    if (!env.pub || !env.priv) return new Response(JSON.stringify({ erreur: 'clés VAPID manquantes dans les Secrets' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    try { return new Response(JSON.stringify(await runOnce(env)), { headers: { 'Content-Type': 'application/json' } }); }
    catch (e) { return new Response(JSON.stringify({ erreur: String((e as Error)?.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
  });
}
