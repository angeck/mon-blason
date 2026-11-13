// mypocketclub · 5.10.0 · n° 161 · test de la fonction Edge « generer-exercice », sans réseau (fausses réponses de la base et de l'IA).
// Usage : node --experimental-strip-types --no-warnings tests/ia.test.mjs
const F = await import('../supabase/functions/generer-exercice/index.ts');
let ok = 0, ko = 0; const check = (n, c) => { c ? ok++ : ko++; console.log((c ? '  ok    · ' : '  ÉCHEC · ') + n); };
const CLUB = '11111111-2222-4333-8444-555555555555';
const env = { url: 'https://base.test', anon: 'anon', service: 'service', apiKey: 'cle-de-test', model: 'claude-sonnet-5-5' };
const good = { items: [{ id: 'a1', k: 'a', n: '1' }, { id: 'a2', k: 'a', n: '2' }, { id: 'b', k: 'b', n: '' }, { id: 'zz', k: 'x', n: 'ko' }],
  frames: [{ c: 'Départ', p: [{ id: 'a1', x: 180, y: 260 }, { id: 'a2', x: 300, y: 190 }, { id: 'b', x: 192, y: 252 }] }, { c: 'Passe au 2', p: [{ id: 'b', x: 900, y: -5 }] }] };
function fake({ state = { ok: true, uid: 'u1', left_today: 5 }, ia = { stop_reason: 'tool_use', usage: { input_tokens: 3000, output_tokens: 1500 }, content: [{ type: 'tool_use', name: 'schema', input: good }] }, iaStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, o) => {
    calls.push([url, o]);
    if (url.endsWith('/rpc/ai_state')) return new Response(JSON.stringify(state), { status: 200 });
    if (url.endsWith('/rpc/ai_log_usage')) return new Response('', { status: 204 });
    if (url.includes('anthropic')) return new Response(JSON.stringify(ia), { status: iaStatus });
    return new Response('?', { status: 404 });
  };
  return { f, calls };
}
const req = (body, auth = 'Bearer jeton-du-coach') => new Request('https://f.test', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const B = { club_id: CLUB, sport: 'Basket-ball', title: 'Passe et va', description: 'Deux colonnes, passe au partenaire puis coupe vers le panier.', tags: ['Passe', 'U11'], category: 'Technique', duration: 15 };

let x = fake(), r = await (await F.handle(req(B), env, x.f)).json();
check('schéma reçu, remis en forme (élément inconnu retiré)', r.ok && r.steps.items.length === 3 && r.steps.frames.length === 2);
check('positions gardées dans le terrain', r.steps.frames[1].p.b[0] === 352 && r.steps.frames[1].p.b[1] === 8);
check('un élément absent d’une étape garde sa position', r.steps.frames[1].p.a1[0] === 180 && r.steps.frames[1].p.a1[1] === 260);
const sent = JSON.parse(x.calls.find((c) => c[0].includes('anthropic'))[1].body);
check('modèle Sonnet 5.5, outil « schema » proposé (choix auto, « tool » refusé par ce modèle)', sent.model === 'claude-sonnet-5-5' && sent.tool_choice.type === 'auto' && sent.tools[0].name === 'schema');
check('l’IA reçoit le texte et les tags, pas l’identifiant du club ni du compte', sent.messages[0].content.includes('Passe, U11') && !JSON.stringify(sent).includes(CLUB) && !JSON.stringify(sent).includes('u1'));
check('la clé de l’IA ne part que vers Anthropic', x.calls.filter((c) => JSON.stringify(c[1].headers || {}).includes('cle-de-test')).every((c) => c[0].includes('anthropic.com')));
const log = JSON.parse(x.calls.find((c) => c[0].endsWith('/rpc/ai_log_usage'))[1].body);
check('appel noté : jetons et coût estimé (3000 × 2 $ + 1500 × 10 $ = 0,021 $)', log.p_in === 3000 && log.p_out === 1500 && Math.abs(log.p_cost - 0.021) < 1e-9 && log.p_ok === true && log.p_user === 'u1');
check('note de l’appel avec la clé de service, sans le texte de l’exercice', x.calls.find((c) => c[0].endsWith('/rpc/ai_log_usage'))[1].headers.apikey === 'service' && !JSON.stringify(log).includes('colonnes'));
check('droits et budget vérifiés avec la session du coach', x.calls[0][0].endsWith('/rpc/ai_state') && x.calls[0][1].headers.Authorization === 'Bearer jeton-du-coach');

x = fake({ state: { ok: false, reason: 'club' } }); r = await (await F.handle(req(B), env, x.f)).json();
check('budget du club atteint : message clair, pas d’appel à l’IA', !r.ok && r.reason === 'club' && /budget/.test(r.message) && !x.calls.some((c) => c[0].includes('anthropic')));
x = fake({ state: { ok: false, reason: 'solde' } }); r = await (await F.handle(req(B), env, x.f)).json();
check('solde épuisé : « en pause », sans parler d’argent au coach', !r.ok && /pause/.test(r.message) && !/solde|\$/.test(r.message));
x = fake(); r = await (await F.handle(req({ ...B, description: 'court', title: '' }), env, x.f)).json();
check('description trop courte : refus avant tout appel', !r.ok && r.reason === 'texte' && x.calls.length === 0);
x = fake(); const res = await F.handle(req(B, ''), env, x.f);
check('sans session : refusé, sans appel', !(await res.json()).ok && x.calls.length === 0);
x = fake({ ia: { stop_reason: 'max_tokens', usage: { input_tokens: 3000, output_tokens: 4096 }, content: [] } }); r = await (await F.handle(req(B), env, x.f)).json();
const log2 = JSON.parse(x.calls.find((c) => c[0].endsWith('/rpc/ai_log_usage'))[1].body);
check('réponse coupée : message d’erreur, coût quand même noté (ok = faux)', !r.ok && r.reason === 'ia' && log2.p_ok === false && log2.p_out === 4096);
x = fake({ iaStatus: 529 }); r = await (await F.handle(req(B), env, x.f)).json();
check('IA surchargée : message « réessaie dans une minute », rien de noté', !r.ok && /minute/.test(r.message) && !x.calls.some((c) => c[0].endsWith('/rpc/ai_log_usage')));
check('sans clé : en pause, aucun appel', !(await (await F.handle(req(B), { ...env, apiKey: '' }, fake().f)).json()).ok);
const v = F.buildRequest('claude-sonnet-5-5', { ...B, sport: 'Volley-ball' });
check('volley : le terrain et l’exemple de Gaël (le 2 reste au contre, le défenseur qui reçoit fait la passe)', v.system.includes('filet est horizontal') && v.system.includes('Le 2 reste au contre') && v.system.includes('va faire la passe'));
check('cleanSteps refuse une réponse vide', F.cleanSteps({ items: [], frames: [] }, 'Basket-ball') === null && F.cleanSteps(null, 'x') === null);
console.log(`\n  ${ok} réussis sur ${ok + ko} tests (fonction generer-exercice)`);
if (ko) process.exit(1);
