// bêta 1.5.1 · n° 285 : lecteur de documents DANS l'application.
// Avant, chaque PDF ouvrait une nouvelle fenêtre (window.open) : sur une tablette Android, l'application
// installée se fermait et le bureau apparaissait. Ici, le document s'affiche dans un cadre plein écran,
// avec « Imprimer / Enregistrer en PDF » (impression du cadre seul) et « Fermer ». Aucune nouvelle fenêtre.
import { esc } from './core.js';
import { icon } from './ui.js';

let box = null, lastFocus = null;
const AUTO_PRINT = /<script>[^<]*print\(\)[^<]*<\/script>/gi; // les anciens documents lançaient l'impression tout seuls

export function closeDoc() {
  if (!box) return;
  box.remove(); box = null; document.body.classList.remove('dv-open');
  document.removeEventListener('keydown', onKey);
  try { lastFocus?.focus(); } catch { /* rien */ }
}
const onKey = (e) => { if (e.key === 'Escape') closeDoc(); };

// Ajuste la largeur d'une page A4 (210 mm) à l'écran, à l'écran seulement : l'impression garde la vraie taille.
function fit(fr) {
  try {
    const d = fr.contentDocument; if (!d?.body) return;
    const w = Math.max(d.documentElement.scrollWidth, d.body.scrollWidth), avail = fr.clientWidth;
    const k = w > avail + 4 ? Math.max(0.3, (avail - 8) / w) : 1;
    let st = d.getElementById('dv-fit'); if (!st) { st = d.createElement('style'); st.id = 'dv-fit'; d.head.appendChild(st); }
    st.textContent = k < 1 ? `@media screen{html{zoom:${k.toFixed(3)}}}` : '';
  } catch { /* rien */ }
}

// html : document complet ; o.title : titre de la barre ; o.download : { url, name } pour un bouton « Télécharger »
export function showDoc(html, o = {}) {
  closeDoc();
  lastFocus = document.activeElement;
  box = document.createElement('div');
  box.className = 'docview'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', o.title || 'Document');
  const canPrint = o.print !== false;
  box.innerHTML = `<div class="dv-bar"><button type="button" class="btn ghost small" data-dv="close" aria-label="Fermer le document">Fermer</button><b class="dv-t">${esc(o.title || 'Document')}</b>
    ${o.download ? `<a class="btn ghost small" href="${esc(o.download.url)}" download="${esc(o.download.name || 'document.pdf')}">${icon('down', 18)}Télécharger</a>` : ''}
    ${canPrint ? `<button type="button" class="btn main small" data-dv="print">${icon('doc', 18)}Imprimer / PDF</button>` : ''}</div>
    <iframe class="dv-frame" title="${esc(o.title || 'Document')}"></iframe>`;
  document.body.appendChild(box); document.body.classList.add('dv-open');
  const fr = box.querySelector('iframe');
  fr.addEventListener('load', () => { fit(fr); setTimeout(() => fit(fr), 400); });
  fr.srcdoc = String(html || '').replace(AUTO_PRINT, '');
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dv]'); if (!b) return;
    if (b.dataset.dv === 'close') closeDoc();
    else if (b.dataset.dv === 'print') { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch { window.print(); } }
  });
  document.addEventListener('keydown', onKey);
  box.querySelector('[data-dv=close]').focus();
  return box;
}

// Une image (fichier joint) dans le même lecteur, sans impression
export function showImage(url, name) {
  return showDoc(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#11162E}img{max-width:100%;max-height:100vh}</style></head><body><img src="${esc(url)}" alt="${esc(name || '')}"></body></html>`, { title: name, print: false, download: { url, name } });
}
