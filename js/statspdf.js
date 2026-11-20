// bêta 1.5.0 · n° 279 : PDF des statistiques d'une équipe, plus lisible (camembert, colonnes), au look du club
// (ses couleurs et son logo ; sinon le look mypocketclub) avec la bande de pied mypocketclub (charte des convocations, chantier 72).
// Par défaut, AUCUN nom de joueur (avis « Légal » attendu sur les noms d'enfants) : chiffres de l'équipe seulement.
// Fabrication gratuite : une fenêtre d'impression (« Enregistrer en PDF »), comme la convocation.
import { BRAND } from '../config.js';
import { esc, contrast, toast } from './core.js';
import { crest, ballSrc } from './ui.js';
import { showDoc } from './docview.js'; // bêta 1.5.1 · n° 285

const abs = (u) => { try { return new URL(u, location.href).href; } catch { return u; } };
const tint = (hex, k = 0.9) => { const n = parseInt(String(hex).slice(1), 16), m = (v) => Math.round(v + (255 - v) * k); return '#' + [m(n >> 16), m((n >> 8) & 255), m(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join(''); };
const pc = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const COL = { present: '#1F9D55', retard: '#F2B705', absent: '#D9472B' }; // mêmes repères que l'écran : vert, jaune, rouge

// Camembert (anneau) en SVG : parts { l, n, c }
function donut(parts, label) {
  const tot = parts.reduce((a, x) => a + x.n, 0) || 1, R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = parts.filter((x) => x.n > 0).map((x) => { const len = (C * x.n) / tot, s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${x.c}" stroke-width="26" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"/>`; off += len; return s; }).join('');
  const lead = parts[0];
  return `<svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="${esc(label)}"><circle r="${R}" cx="70" cy="70" fill="none" stroke="#EEF0F6" stroke-width="26"/>${arcs}<text x="70" y="68" text-anchor="middle" font-size="24" font-weight="800" fill="#11162E">${pc(lead.n, tot)} %</text><text x="70" y="86" text-anchor="middle" font-size="10" fill="#4A5068">${esc(lead.l.toLowerCase())}</text></svg>`;
}
// Colonnes : taux de présence de chaque séance (les 16 dernières)
function columns(items, color) {
  const W = 500, H = 130, n = items.length || 1, bw = Math.min(26, (W - 10) / n - 6);
  const bars = items.map((x, i) => { const h = Math.round((H - 30) * x.p / 100), X = 6 + i * ((W - 10) / n); return `<rect x="${X.toFixed(1)}" y="${H - 18 - h}" width="${bw.toFixed(1)}" height="${h}" rx="3" fill="${color}"/><text x="${(X + bw / 2).toFixed(1)}" y="${H - 22 - h}" text-anchor="middle" font-size="8.5" fill="#11162E">${x.p}</text><text x="${(X + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="#4A5068">${esc(x.l)}</text>`; }).join('');
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Présence à chaque séance, en pourcentage"><line x1="0" x2="${W}" y1="${H - 18}" y2="${H - 18}" stroke="#D8DCEA"/>${bars}</svg>`;
}

// st : { rows, detail } (écran Statistiques) ; c : le club ; team : nom de l'équipe ; period : libellé de la période
export function statsDoc(st, c, team, period, { print = true } = {}) {
  const c1 = c?.color1 || '#2F5BFF', c2 = c?.color2 || '#FFC93C', soft = tint(c1), head = contrast(c1, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#11162E';
  const evs = [...new Map(st.detail.map((d) => [d.event_id, d])).values()].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const count = (k) => st.detail.filter((d) => d.status === k).length;
  const P = count('present'), Rt = count('retard'), A = count('absent'), N = P + Rt + A;
  const tot = st.rows.reduce((o, r) => ({ s: o.s + r.sessions, an: o.an + r.answered, ya: o.ya + r.yes_absent, np: o.np + (r.no_present || 0) }), { s: 0, an: 0, ya: 0, np: 0 });
  const per = evs.slice(-16).map((e) => { const l = st.detail.filter((d) => d.event_id === e.event_id && d.status); const ok = l.filter((d) => d.status !== 'absent').length; return { p: pc(ok, l.length), l: new Date(e.starts_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) }; });
  const types = Object.entries(evs.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {})).map(([t, n]) => `${n} ${esc(t.toLowerCase())}${n > 1 && !/s$/.test(t) ? 's' : ''}`).join(' · ');
  const now = new Date(), ref = 'ST-' + now.toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(team || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase();
  const logo = c?.logo ? `<span class="lg">${crest(c, 58, c1)}</span>` : `<span class="lg"><img src="${abs(ballSrc(c?.sport))}" width="58" height="58" alt=""></span>`;
  const leg = [['Présents', P, COL.present], ['En retard', Rt, COL.retard], ['Absents', A, COL.absent]];
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Statistiques ${esc(team)} · ${esc(c?.name || '')}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:wght@400;500;700&display=swap">
<style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'DM Sans',Arial,sans-serif;color:#11162E;font-size:13px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;display:flex;flex-direction:column}
.hd{background:${c1};color:${head};padding:14mm 14mm 8mm;display:flex;gap:14px;align-items:center}.lg{display:flex;align-items:center;justify-content:center;flex:none}
.hd .nm{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:22px;line-height:1.1}.tag{margin-left:auto;border:1.5px solid ${head};border-radius:20px;padding:5px 12px;font-weight:700;font-size:11px;white-space:nowrap}
.lis{height:8px;background:${c2}}.ct{padding:9mm 14mm;flex:1;display:flex;flex-direction:column;gap:12px}
h2{margin:0;font-size:13px;color:${c1};text-transform:uppercase;letter-spacing:.06em}h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:28px;margin:2px 0 0;line-height:1.1}.sub{color:#4A5068}
.kp{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.k{background:${soft};border-radius:12px;padding:12px 14px}.k b{display:block;font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:30px;color:${c1};line-height:1}.k span{color:#4A5068;font-size:11.5px}
.bx{border:1px solid #D8DCEA;border-radius:12px;padding:12px 14px;page-break-inside:avoid}.bx h3{margin:0 0 8px;font-size:14px}
.two{display:flex;gap:18px;align-items:center}.lgd{display:flex;flex-direction:column;gap:6px}.lgd div{display:flex;align-items:center;gap:8px}.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
.rel{display:grid;grid-template-columns:1fr 1fr;gap:10px}.note{color:#4A5068;font-size:11px}
.ft{background:#F7F8FC;border-top:1px solid #D8DCEA;padding:5mm 14mm;display:flex;align-items:center;gap:12px;font-size:10.5px;color:#4A5068}.wm{font-family:'Bricolage Grotesque',sans-serif;font-weight:800;font-size:16px;letter-spacing:-.04em;color:#11162E;white-space:nowrap}.wm .my{display:inline-block;background:#FFC93C;color:#11162E;border-radius:.2em;padding:0 .09em .12em;transform:rotate(-5deg);margin-right:.07em}.wm .cl{color:#2F5BFF}.ft .r{margin-left:auto;text-align:right}
@media screen{body{background:#E9ECF5}.page{margin:12px auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.12)}}</style></head><body><div class="page">
<div class="hd">${logo}<div class="nm">${esc(c?.name || '')}</div><span class="tag">Statistiques de l’équipe</span></div><div class="lis"></div>
<div class="ct"><div><h2>Présences · ${esc(period)}</h2><h1>${esc(team)}</h1><div class="sub">${evs.length} séance${evs.length > 1 ? 's' : ''} pointée${evs.length > 1 ? 's' : ''}${types ? ' · ' + types : ''}</div></div>
<div class="kp"><div class="k"><b>${pc(P + Rt, N)} %</b><span>assiduité (un retard compte comme une présence)</span></div><div class="k"><b>${pc(tot.an, tot.s)} %</b><span>réponses données avant la séance</span></div><div class="k"><b>${st.rows.length}</b><span>joueur${st.rows.length > 1 ? 's' : ''} suivi${st.rows.length > 1 ? 's' : ''}</span></div></div>
<div class="bx"><h3>Répartition des présences</h3><div class="two">${donut([{ l: 'Présents', n: P, c: COL.present }, { l: 'En retard', n: Rt, c: COL.retard }, { l: 'Absents', n: A, c: COL.absent }], `Présents ${P}, en retard ${Rt}, absents ${A}`)}<div class="lgd">${leg.map(([l, n, col]) => `<div><span class="sw" style="background:${col}"></span><span>${l}</span><b>${n}</b><span class="note">${pc(n, N)} %</span></div>`).join('')}</div></div></div>
${per.length > 1 ? `<div class="bx"><h3>Présence à chaque séance (%)</h3>${columns(per, c1)}</div>` : ''}
<div class="bx"><h3>Fiabilité des réponses</h3><div class="rel"><div class="k"><b>${tot.ya}</b><span>« Je viens » puis absent</span></div><div class="k"><b>${tot.np}</b><span>« Je ne viens pas » puis venu</span></div></div></div>
<p class="note">Seules les séances dont l’appel est fait comptent. Document sans nom de joueur : les chiffres sont ceux de toute l’équipe.</p></div>
<div class="ft"><span class="wm" role="img" aria-label="${esc(BRAND.aria)}"><span class="my">my</span>p<img src="${abs(ballSrc(c?.sport))}" width="13" height="13" alt="" style="vertical-align:-0.1em">cket<span class="cl">club</span></span><span>Document créé et généré avec ${esc(BRAND.name)}</span><span class="r">Émis le ${now.toLocaleDateString('fr-FR')}<br>Réf. ${esc(ref)}</span></div>
</div>${print ? '<script>document.fonts&&document.fonts.ready.then(function(){setTimeout(function(){print()},300)})<\/script>' : ''}</body></html>`;
  return html;
}

export function openStatsPdf(st, c, team, period) {
  showDoc(statsDoc(st, c, team, period, { print: false }), { title: 'Statistiques · ' + (team || '') }); // n° 285 : dans l'appli
}
