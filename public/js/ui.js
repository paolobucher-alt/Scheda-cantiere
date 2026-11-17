// Piccole utilità per costruire l'interfaccia senza librerie esterne.
export function h(tag, attrs, ...figli) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat(Infinity)) if (f !== null && f !== undefined && f !== false) el.append(f instanceof Node ? f : String(f));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const fEur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const fNum = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const fPct = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 1 });
export const eur = (v) => (v === null || v === undefined) ? '' : fEur.format(v);
export const n = (v) => (v === null || v === undefined) ? '' : fNum.format(v);
export const pct = (v) => (v === null || v === undefined) ? '–' : fPct.format(v);
export const dataIt = (s) => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
export const oggi = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
export const numero = (s) => { const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
export const classeSegno = (v) => v < 0 ? 'neg' : '';

let timerAvviso;
export function avviso(testo, ms = 2600) {
  const a = $('#avviso'); a.textContent = testo; a.classList.add('vis');
  clearTimeout(timerAvviso); timerAvviso = setTimeout(() => a.classList.remove('vis'), ms);
}

export function mostraFoto(src) {
  const d = h('dialog', { class: 'foto', onclick: () => d.close(), onclose: () => d.remove() }, h('img', { src, alt: 'Foto' }));
  document.body.append(d); d.showModal();
}

export function dialogo(titolo, contenuto, { conferma = 'Salva', onConferma } = {}) {
  const errore = h('div', { class: 'errore-campo' });
  const form = h('form', { method: 'dialog' }, h('h2', { style: 'margin-top:0' }, titolo), contenuto, errore,
    h('div', { style: 'display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem' },
      h('button', { type: 'button', onclick: () => d.close() }, 'Annulla'),
      h('button', { class: 'primario', type: 'submit' }, conferma)));
  const d = h('dialog', { onclose: () => d.remove() }, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { errore.textContent = ''; await onConferma?.(form); d.close(); } catch (er) { errore.textContent = er.message; }
  });
  document.body.append(d); d.showModal();
  return d;
}

// Campo con etichetta
export const campo = (etichetta, input) => [h('label', null, etichetta), input];
export const valori = (form) => Object.fromEntries(new FormData(form).entries());

// Riduce le foto a max 1600 px (JPEG) per non consumare dati mobili
export async function riduciFoto(file, lato = 1600, qualita = 0.75) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, lato / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b || file), 'image/jpeg', qualita));
  } catch { return file; }
}

// Selettore foto (fotocamera del telefono) con anteprime
export function sceltaFoto({ multiple = false, etichetta = '📷 Scatta o scegli una foto' } = {}) {
  const foto = [];
  const anteprime = h('div', { class: 'foto-anteprime' });
  const disegna = () => {
    anteprime.replaceChildren(...foto.map((b, i) => h('div', { style: 'position:relative' },
      h('img', { src: URL.createObjectURL(b), alt: 'Foto ' + (i + 1) }),
      h('button', { type: 'button', class: 'piccolo pericolo', style: 'position:absolute;top:2px;right:2px;padding:0 .4rem;background:#fff',
        onclick: () => { foto.splice(i, 1); disegna(); } }, '×'))));
  };
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple,
    onchange: async () => {
      for (const f of input.files) { foto.push(await riduciFoto(f)); if (!multiple) foto.splice(0, foto.length - 1); }
      input.value = ''; disegna();
    } });
  const el = h('div', null, h('label', { class: 'bottone-foto' }, input, etichetta), anteprime);
  return { el, foto };
}
