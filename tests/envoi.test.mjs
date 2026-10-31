// Pocket Club · test de la fonction d'envoi des notifications (étape B 3 sur 5), sans réseau.
// Le chiffrement est vérifié par un déchiffrement indépendant (node:crypto), la signature VAPID par node:crypto.
// Usage : node --experimental-strip-types tests/envoi.test.mjs
import crypto from 'node:crypto';
const F = await import('../supabase/functions/envoyer-notifications/index.ts');
let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log((c ? '  ok    · ' : '  ÉCHEC · ') + n); };
const b64u = (b) => Buffer.from(b).toString('base64url');

// Clés d'envoi fictives (jamais les vraies)
const v = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = b64u(v.publicKey.export({ format: 'der', type: 'spki' }).subarray(-65)), priv = v.privateKey.export({ format: 'jwk' }).d;
// Téléphone fictif
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) };

function decrypt(body) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(as);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return { rs, text: pt.subarray(0, -1).toString(), pad: pt[pt.length - 1] };
}

const msg = JSON.stringify({ title: 'Nouveau : entraînement', body: 'Notif U9 · sam. 14/11 à 10h30 · Gymnase (AS Test Basket) ✓' });
const enc = Buffer.from(await F.encryptPayload(sub.p256dh, sub.auth, msg));
const dec = decrypt(enc);
check('chiffrement : le téléphone retrouve exactement le message (accents compris)', dec.text === msg && dec.pad === 2 && dec.rs === 4096);
check('chiffrement : deux envois du même message sont différents', !Buffer.from(await F.encryptPayload(sub.p256dh, sub.auth, msg)).equals(enc));

const h = await F.vapidHeader('https://fcm.googleapis.com/fcm/send/abc', pub, priv, 'mailto:test@exemple.invalid');
const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/) || [];
const [hd, pl, sg] = t.split('.');
const payload = JSON.parse(Buffer.from(pl, 'base64url'));
check('signature : vérifiée avec la clé publique', crypto.verify('sha256', Buffer.from(hd + '.' + pl), { key: v.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')));
check('signature : bon destinataire, contact et durée', payload.aud === 'https://fcm.googleapis.com' && payload.sub === 'mailto:test@exemple.invalid' && payload.exp - Date.now() / 1000 <= 12 * 3600 + 5 && k === pub);

// Passage complet avec une fausse base et de faux services de téléphone
const rows = [
  { queue_id: 1, endpoint: 'https://push.exemple.invalid/ok', ...sub, title: 'A', body: 'a', url: './', tag: 'x' },
  { queue_id: 2, endpoint: 'https://push.exemple.invalid/gone', ...sub, title: 'B', body: 'b', url: './', tag: 'x' },
  { queue_id: 3, endpoint: 'https://push.exemple.invalid/err', ...sub, title: 'C', body: 'c', url: './', tag: 'x' },
  { queue_id: 3, endpoint: 'https://push.exemple.invalid/err2', ...sub, title: 'C', body: 'c', url: './', tag: 'x' },
  { queue_id: 4, endpoint: 'https://push.exemple.invalid/err', ...sub, title: 'D', body: 'd', url: './', tag: 'x' },
  { queue_id: 4, endpoint: 'https://push.exemple.invalid/ok2', ...sub, title: 'D', body: 'd', url: './', tag: 'x' },
];
const calls = []; let claimed = false, received = [];
const fakeFetch = async (url, o) => {
  if (url.includes('/rest/v1/rpc/')) {
    const fn = url.split('/').pop(), args = JSON.parse(o.body); calls.push([fn, args, o.headers]);
    if (fn === 'push_claim') { const r = claimed ? [] : rows; claimed = true; return new Response(JSON.stringify(r)); }
    return new Response('');
  }
  received.push([url, o.headers]);
  if (url.endsWith('/gone')) return new Response('', { status: 410 });
  if (url.includes('/err')) return new Response('quota', { status: 429 });
  return new Response('', { status: 201 });
};
const real = globalThis.fetch; globalThis.fetch = fakeFetch;
const env = { url: 'https://base.exemple.invalid', key: 'eyJ.fictif', pub, priv, subject: 'mailto:test@exemple.invalid' };
const out = await F.runOnce(env, fakeFetch);
globalThis.fetch = real;
const res = calls.find((c) => c[0] === 'push_result')?.[1];
check('passage : un envoi par téléphone, en-têtes Web Push présents', received.length === 6 && received.every(([, hh]) => hh['Content-Encoding'] === 'aes128gcm' && hh.TTL === '86400' && hh.Authorization.startsWith('vapid t=')));
check('passage : reçue, ou reçue par un des téléphones → envoyée', res && res.p_sent.sort().join() === '1,2,4');
check('passage : aucun téléphone n’a reçu → gardée pour un nouvel essai', res.p_failed.join() === '3' && res.p_error.startsWith('429'));
check('passage : téléphone désinscrit → retiré de la base', res.p_gone.join() === 'https://push.exemple.invalid/gone');
check('passage : clé de service envoyée à la base', calls[0][2].apikey === 'eyJ.fictif' && calls[0][2].Authorization === 'Bearer eyJ.fictif');
check('passage : bilan renvoyé', out.sent === 3 && out.failed === 1 && out.gone === 1);
console.log(`\n   ${ok} réussis sur ${ok + ko} tests d'envoi`);
process.exit(ko ? 1 : 0);
