// mypocketclub · alpha 5.10.0 · n° 161 · fonction Edge « generer-exercice » (Supabase → Edge Functions)
// Le coach décrit son exercice ; l'IA (Claude, d'Anthropic) propose un schéma animé, étape par étape, que le coach modifie ensuite.
// Ce que l'IA reçoit : le sport, la catégorie, la durée, le niveau, le titre, la description et les tags. Jamais un nom ni une donnée de joueur.
// Contrôles avant l'appel : ai_state(club) dans la base, avec la session du coach (droits, IA en pause, solde, budget du club, plafond du jour).
// Après l'appel : ai_log_usage(...) note les jetons et le coût estimé (avec la clé de service). Jamais le texte de l'exercice.
//
// Secret à créer dans Supabase → Edge Functions → Secrets :
//   ANTHROPIC_API_KEY  clé de la Console Claude (créée par Gaël le 13 novembre 2026). Jamais dans le projet ni sur GitHub.
//   AI_MODEL           facultatif : claude-sonnet-5-5 par défaut ; claude-haiku-5-5 pour l'essai prévu ensuite.
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis d'office par Supabase.

export const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
// Prix en dollars par million de jetons (entrée, sortie). Sonnet 5.5 : 2 $ et 10 $ (grille Anthropic, novembre 2026).
// Un modèle absent de la liste est compté au prix de Sonnet : l'estimation est alors plus haute que la réalité, jamais plus basse.
export const PRICES: Record<string, [number, number]> = { 'claude-sonnet-5-5': [2, 10] };
export const cost = (model: string, tin: number, tout: number) => { const p = PRICES[model] || PRICES['claude-sonnet-5-5']; return (tin * p[0] + tout * p[1]) / 1e6; };

export const W = 360, H = 500, MAXI = 14, MAXF = 8;
const KINDS = ['a', 'd', 'l', 'e', 'c', 'b'];
const clampN = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
const txt = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Remet en forme la réponse de l'IA : au plus 14 éléments et 8 étapes, positions dans le terrain, chaque élément présent à chaque étape.
export function cleanSteps(raw: any, sport: string) {
  if (!raw || !Array.isArray(raw.items) || !Array.isArray(raw.frames)) return null;
  const items: { id: string; k: string; n: string }[] = [], seen = new Set<string>();
  for (const it of raw.items) {
    const id = txt(it?.id, 12).replace(/[^\w-]/g, ''), k = String(it?.k || '');
    if (!id || seen.has(id) || !KINDS.includes(k)) continue;
    seen.add(id); items.push({ id, k, n: txt(it?.n, 3) });
    if (items.length >= MAXI) break;
  }
  if (!items.length) return null;
  const frames: { c: string; p: Record<string, [number, number]> }[] = [];
  let last: Record<string, [number, number]> = {};
  for (const f of raw.frames.slice(0, MAXF)) {
    const p: Record<string, [number, number]> = {};
    const list = Array.isArray(f?.p) ? f.p : Object.entries(f?.p || {}).map(([id, xy]: [string, any]) => ({ id, x: xy?.[0], y: xy?.[1] }));
    for (const q of list) if (seen.has(String(q?.id))) p[String(q.id)] = [clampN(q.x, 8, W - 8), clampN(q.y, 8, H - 8)];
    for (const it of items) if (!p[it.id] && last[it.id]) p[it.id] = last[it.id];
    frames.push({ c: txt(f?.c, 200), p }); last = p;
  }
  if (!frames.length) return null;
  // un élément placé seulement plus tard est mis à sa première position dans les étapes d'avant
  for (const it of items) {
    const first = frames.find((f) => f.p[it.id])?.p[it.id] || [W / 2, H / 2];
    for (const f of frames) { if (!f.p[it.id]) f.p[it.id] = first; else break; }
  }
  return { v: 1, sport: sport === 'Volley-ball' ? 'Volley-ball' : 'Basket-ball', items, frames };
}

const COURT: Record<string, string> = {
  'Basket-ball': `Demi-terrain de basket vu de dessus, cadre de 360 de large (x) sur 500 de haut (y), origine en haut à gauche.
Ligne de fond en haut (y = 10), cercle du panier en (180, 36), planche en y = 22. Raquette : x de 135 à 225, y de 10 à 150 ; ligne des lancers francs en y = 150.
Ligne à 3 points : droite le long des lignes de côté (x = 40 et x = 320) de y = 10 à 70, puis arc qui passe par (180, 210).
Lignes de côté x = 14 et x = 346 ; ligne médiane en bas (y = 480). Repères : coins (30, 30) et (330, 30), ailes (60, 180) et (300, 180), haut de la raquette (180, 240), poste bas (150, 120) et (210, 120).`,
  'Volley-ball': `Terrain de volley vu de dessus, cadre de 360 de large (x) sur 500 de haut (y), origine en haut à gauche.
Le filet est horizontal en y = 110. Au-dessus (y de 20 à 110) : une bande du camp adverse (le coach ou l'attaquant adverse s'y place). En dessous (y de 110 à 470) : notre camp.
Ligne des 3 mètres (attaque) en y = 230 ; ligne de fond en y = 470 ; lignes de côté x = 18 et x = 342.
Postes de notre camp (vu depuis notre ligne de fond, filet en haut) : 4 avant gauche (72, 138), 3 avant centre (180, 138), 2 avant droit (288, 138), 5 arrière gauche (72, 330), 6 arrière centre (180, 420), 1 arrière droit (288, 330).`,
};
const EXAMPLE: Record<string, string> = {
  'Basket-ball': `Exemple (passe et va, 3 étapes) : items [{id:"a1",k:"a",n:"1"},{id:"a2",k:"a",n:"2"},{id:"b",k:"b",n:""},{id:"c1",k:"c",n:""}] ;
étape 1 « Le 1 a le ballon en haut, le 2 attend à l'aile. » p [a1 (180,260), a2 (300,190), b (192,252), c1 (240,200)] ;
étape 2 « Le 1 passe au 2. » p [a1 (180,260), a2 (300,190), b (292,184), c1 (240,200)] ;
étape 3 « Le 1 coupe vers le panier par l'intérieur du plot, le 2 lui redonne : double pas. » p [a1 (170,70), a2 (300,190), b (176,62), c1 (240,200)].`,
  'Volley-ball': `Exemple (défense sur le passeur, attaque adverse en 4) : items 4, C (centrale), 2 (passeur), L (libéro, k "l"), 6, 1, E (coach, k "e"), ballon ;
étape 1 « Mise en place : ligne avant au filet, 5 et 1 bas. » ; étape 2 « Contre à deux en 2, le 4 en petite diagonale, L et 6 sur la grande diagonale, le 1 sur la ligne. » (2 en (326,126), C en (296,126), 4 en (108,250), L en (90,390), 6 en (137,430), 1 en (324,390)) ;
étape 3 « Le coach attaque sur le passeur. Le 2 reste au contre. » (ballon vers (150,330)) ; étape 4 « Le défenseur qui fait la réception (ici le 6) va faire la passe. » (6 vers (210,200), ballon en (210,190)) ; étape 5 « Il passe au 4 pour l'attaque. » (ballon vers (72,130)).`,
};

export function buildRequest(model: string, b: any) {
  const sport = b.sport === 'Volley-ball' ? 'Volley-ball' : 'Basket-ball';
  const system = `Tu prépares le schéma d'un exercice d'entraînement de ${sport === 'Volley-ball' ? 'volley' : 'basket'} pour un coach de club amateur, en français.
Le schéma est une suite d'étapes (de 2 à ${MAXF}). Chaque étape est un moment de l'exercice : la position de chaque élément, et une phrase courte qui dit ce qui se passe (tutoiement, 20 mots au plus).
${COURT[sport]}
Éléments (« k ») : a = joueur (attaque ou joueur de l'exercice), d = défenseur, l = libéro (volley seulement), e = entraîneur, c = plot, b = ballon. Au plus ${MAXI} éléments.
« n » est l'étiquette affichée dans le rond : un numéro ou une lettre, 3 caractères au plus (1, 2, P, C, L, E). Jamais de prénom ni de nom. Rien pour les plots et le ballon.
Garde le même « id » d'une étape à l'autre : l'application anime les déplacements entre deux étapes. Le ballon suit les passes et reste collé (à 8 près) au joueur qui l'a.
Positions réalistes, dans le terrain, sans deux joueurs au même endroit. Si la description est floue, fais la version la plus simple et la plus courante de l'exercice.
${EXAMPLE[sport]}
Réponds uniquement avec l'outil « schema ».`;
  const lines = [`Sport : ${sport}`, b.category && `Catégorie : ${txt(b.category, 40)}`, b.duration && `Durée : ${clampN(b.duration, 1, 120)} min`, b.level && `Niveau : ${txt(b.level, 40)}`,
    b.title && `Titre : ${txt(b.title, 80)}`, Array.isArray(b.tags) && b.tags.length && `Tags : ${b.tags.slice(0, 25).map((t: unknown) => txt(t, 40)).join(', ')}`,
    `Description du coach :\n${String(b.description || '').slice(0, 2000)}`].filter(Boolean);
  const pt = { type: 'object', properties: { id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['id', 'x', 'y'] };
  return {
    model, max_tokens: 4096, system,
    tools: [{ name: 'schema', description: 'Le schéma animé de l’exercice, étape par étape.', input_schema: { type: 'object', properties: {
      items: { type: 'array', maxItems: MAXI, items: { type: 'object', properties: { id: { type: 'string' }, k: { type: 'string', enum: KINDS }, n: { type: 'string' } }, required: ['id', 'k', 'n'] } },
      frames: { type: 'array', minItems: 2, maxItems: MAXF, items: { type: 'object', properties: { c: { type: 'string' }, p: { type: 'array', items: pt } }, required: ['c', 'p'] } },
    }, required: ['items', 'frames'] } }],
    tool_choice: { type: 'tool', name: 'schema' },
    messages: [{ role: 'user', content: lines.join('\n') }],
  };
}

type Env = { url: string; anon: string; service: string; apiKey: string; model: string };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const MSG: Record<string, string> = {
  droits: 'Seuls les coachs et le bureau du club peuvent préparer un schéma avec l’IA.',
  pause: 'La création avec l’IA est en pause pour le moment. Tu peux dessiner le schéma toi-même.',
  solde: 'La création avec l’IA est en pause pour le moment. Tu peux dessiner le schéma toi-même.',
  club: 'Ton club a utilisé son budget IA pour cette saison. Tu peux dessiner le schéma toi-même.',
  jour: 'Tu as atteint le nombre de schémas IA pour aujourd’hui. Réessaie demain, ou dessine-le toi-même.',
};

export async function handle(req: Request, env: Env, doFetch: typeof fetch = fetch): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, message: 'Méthode refusée.' }, 405);
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/.test(auth)) return json({ ok: false, reason: 'droits', message: MSG.droits }, 401);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, message: 'Demande illisible.' }, 400); }
  const club = String(b?.club_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(club)) return json({ ok: false, message: 'Club inconnu.' }, 400);
  if (String(b?.description || '').trim().length < 20 && String(b?.title || '').trim().length < 4) return json({ ok: false, reason: 'texte', message: 'Décris un peu plus ton exercice (20 caractères au moins).' });
  if (!env.apiKey) return json({ ok: false, reason: 'pause', message: MSG.pause });
  // 1. droits et budget, avec la session du coach
  const st = await doFetch(`${env.url}/rest/v1/rpc/ai_state`, { method: 'POST', headers: { apikey: env.anon, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_club: club }) });
  if (!st.ok) return json({ ok: false, reason: 'droits', message: MSG.droits }, 401);
  const state = await st.json();
  if (!state?.ok) return json({ ok: false, reason: state?.reason || 'pause', message: MSG[state?.reason] || MSG.pause });
  // 2. appel à l'IA
  const sport = b.sport === 'Volley-ball' ? 'Volley-ball' : 'Basket-ball';
  let r: Response;
  try {
    r = await doFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(buildRequest(env.model, b)) });
  } catch { return json({ ok: false, reason: 'ia', message: 'L’IA ne répond pas. Réessaie dans un moment.' }); }
  if (!r.ok) return json({ ok: false, reason: 'ia', message: r.status === 429 || r.status === 529 ? 'L’IA est très demandée. Réessaie dans une minute.' : 'L’IA n’a pas pu préparer le schéma. Réessaie dans un moment.' });
  const out = await r.json();
  const tin = (out?.usage?.input_tokens || 0) + (out?.usage?.cache_creation_input_tokens || 0) + (out?.usage?.cache_read_input_tokens || 0), tout = out?.usage?.output_tokens || 0;
  const use = (out?.content || []).find((c: any) => c?.type === 'tool_use' && c?.name === 'schema');
  const steps = out?.stop_reason === 'max_tokens' ? null : cleanSteps(use?.input, sport);
  // 3. note de l'appel (le coût compte même si le schéma n'est pas utilisable)
  await doFetch(`${env.url}/rest/v1/rpc/ai_log_usage`, { method: 'POST', headers: { apikey: env.service, Authorization: 'Bearer ' + env.service, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_club: club, p_user: state.uid, p_model: env.model, p_in: tin, p_out: tout, p_cost: Number(cost(env.model, tin, tout).toFixed(5)), p_ok: !!steps }) }).catch(() => {});
  if (!steps || steps.frames.length < 2) return json({ ok: false, reason: 'ia', message: 'Le schéma proposé n’était pas utilisable. Réessaie, ou précise la description.' });
  return json({ ok: true, steps, left_today: Math.max((state.left_today || 1) - 1, 0) });
}

declare const Deno: any;
if (typeof Deno !== 'undefined' && Deno.serve) {
  Deno.serve((req: Request) => handle(req, {
    url: Deno.env.get('SUPABASE_URL') || '', anon: Deno.env.get('SUPABASE_ANON_KEY') || '',
    service: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY') || '',
    apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '', model: Deno.env.get('AI_MODEL') || 'claude-sonnet-5-5',
  }));
}
