import { h, avviso } from './ui.js';
import { get, post } from './api.js';
import { stato, suCambio, invia, cacheLeggi, cacheSalva, cacheSvuota, elenco } from './coda.js';
import * as campo from './campo.js';
import * as uff from './ufficio.js';

const app = document.getElementById('app');
let utente = null;
let pulizia = null;

async function caricaUtente() {
  try { utente = await get('/api/me'); await cacheSalva('utente', utente); }
  catch (e) { utente = e.status === 0 ? await cacheLeggi('utente') : null; } // offline: ultimo utente collegato
}

function login() {
  const err = h('div', { class: 'errore-campo' });
  const f = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { utente = await post('/api/login', { email: f.email.value, password: f.password.value }); await cacheSalva('utente', utente); location.hash = '#/'; mostra(); }
    catch (er) { err.textContent = er.status === 0 ? 'Serve la connessione per il primo accesso' : er.message; }
  } },
    h('img', { class: 'logo', src: '/icona.svg', alt: '' }), h('h1', null, 'Scheda Cantiere'),
    h('label', null, 'Email'), h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true }),
    h('label', null, 'Password'), h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true }),
    err, h('button', { class: 'primario grande', type: 'submit' }, 'Entra'));
  app.replaceChildren(f);
}

const badge = h('span', { class: 'stato-invio' });
suCambio((s) => {
  badge.className = 'stato-invio' + (s.errori.length ? ' errore' : s.inAttesa ? ' attesa' : '');
  badge.textContent = s.errori.length ? `⚠ ${s.errori.length} non inviati` : s.inAttesa ? `${s.inAttesa} da inviare${s.online ? '' : ' · offline'}` : s.online ? '✓ Inviato' : 'Offline';
});
badge.onclick = () => { invia(); };

const ROTTE_UFFICIO = [['#/u', 'Cruscotto'], ['#/u/spese', 'Spese da approvare'], ['#/u/operai', 'Operai'], ['#/u/mezzi', 'Mezzi'],
  ['#/u/utenti', 'Utenti'], ['#/u/limiti', 'Limiti spesa'], ['#/u/esporta', 'Esporta'], ['#/campo', 'Inserisci dal cantiere']];

async function mostra() {
  pulizia?.(); pulizia = null;
  if (!utente) return login();
  let hash = location.hash || '#/';
  if (hash === '#/' || hash === '#') hash = utente.ruolo === 'ufficio' ? '#/u' : '#/campo';
  const uffic = utente.ruolo === 'ufficio';
  if (hash.startsWith('#/u') && !uffic) hash = '#/campo';

  const main = h('main');
  const barra = h('header', { class: 'barra' }, h('a', { href: '#/', style: 'border:0;padding:0' }, h('img', { src: '/icona.svg', alt: 'Home', width: 30, height: 30 })),
    h('span', { class: 'titolo' }, 'Scheda Cantiere'), badge,
    h('button', { onclick: esci, title: utente.nome }, 'Esci'));
  const pezzi = [barra];
  if (uffic && hash.startsWith('#/u')) {
    let n = 0; try { n = (await get('/api/spese?stato=da_approvare')).length; } catch { /* offline */ }
    pezzi.push(h('nav', { class: 'nav' }, ROTTE_UFFICIO.map(([r, et]) => h('a', { href: r, class: (hash === r || (r === '#/u' && hash.startsWith('#/u/cantiere'))) ? 'attivo' : '' },
      et, r === '#/u/spese' && n ? h('span', { class: 'badge' }, n) : null))));
  } else if (uffic) pezzi.push(h('nav', { class: 'nav' }, h('a', { href: '#/u' }, '‹ Torna all\'ufficio')));
  pezzi.push(main);
  app.replaceChildren(...pezzi);

  const p = hash.slice(2).split('/');
  try {
    if (p[0] === 'u') {
      if (!p[1]) await uff.cruscotto(main);
      else if (p[1] === 'cantiere') await uff.scheda(main, p[2]);
      else if (uff[p[1]]) await uff[p[1]](main);
      else main.append('Pagina non trovata');
    } else if (p[0] === 'c' && p[1]) {
      const pag = { ore: campo.paginaOre, km: campo.paginaKm, scontrino: campo.paginaScontrino, materiale: campo.paginaMateriale, diario: campo.paginaDiario }[p[2]];
      pulizia = await (pag ? pag(main, p[1]) : campo.paginaCantiere(main, p[1]));
    } else await campo.paginaCantieri(main);
  } catch (e) {
    main.append(h('div', { class: 'card' }, e.status === 0 ? 'Questa pagina richiede la connessione.' : 'Errore: ' + e.message));
  }
  window.scrollTo(0, 0);
}

async function esci() {
  const attesa = (await elenco()).length;
  if (attesa && !confirm(`Ci sono ${attesa} inserimenti non ancora inviati: se esci vanno persi. Uscire comunque?`)) return;
  try { await post('/api/logout'); } catch { /* offline */ }
  await cacheSvuota(); utente = null; window.__base = null;
  indexedDB.deleteDatabase('scheda-cantiere');
  location.hash = '#/'; location.reload();
}

window.addEventListener('hashchange', mostra);
window.addEventListener('sessione-scaduta', () => { utente = null; avviso('Sessione scaduta: accedi di nuovo'); mostra(); });
window.addEventListener('coda-inviata', (e) => avviso(e.detail === 1 ? 'Inserimento inviato all\'ufficio' : `${e.detail} inserimenti inviati all'ufficio`));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
await caricaUtente();
stato(); invia();
mostra();
