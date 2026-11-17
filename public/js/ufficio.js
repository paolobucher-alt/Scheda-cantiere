// Schermate per l'ufficio: cruscotto, scheda cantiere, approvazioni, anagrafiche, esportazione.
import { h, eur, n, pct, dataIt, oggi, numero, avviso, dialogo, campo, valori, mostraFoto, classeSegno } from './ui.js';
import { get, post, put, del } from './api.js';

const STATI = ['Da iniziare', 'In corso', 'Concluso'];
const td = (v, cls) => h('td', { class: cls }, v);
const tdE = (v, segno) => h('td', { class: 'n ' + (segno ? classeSegno(v) : '') }, eur(v));
const fotoMini = (ids) => ids?.length ? h('div', { class: 'miniature' }, ids.map((f) => h('img', { src: `/api/foto/${f}`, loading: 'lazy', alt: 'Foto', onclick: () => mostraFoto(`/api/foto/${f}`) }))) : null;
const conErrore = (fn) => async (...a) => { try { await fn(...a); } catch (e) { avviso(e.message, 4000); } };

// ---------- Cruscotto ----------
export async function cruscotto(main) {
  const dati = await get('/api/riepilogo');
  const filtroStato = h('select', null, h('option', { value: '' }, 'Tutti gli stati'), STATI.map((s) => h('option', { value: s, selected: s === 'In corso' }, s)));
  const filtroTesto = h('input', { type: 'search', placeholder: 'Cerca cantiere o cliente', style: 'min-width:240px' });
  const corpo = h('tbody'); const piede = h('tfoot');
  const disegna = () => {
    const t = filtroTesto.value.toLowerCase();
    const righe = dati.filter((c) => (!filtroStato.value || c.stato === filtroStato.value) && (!t || `${c.codice} ${c.nome} ${c.cliente || ''}`.toLowerCase().includes(t)));
    corpo.replaceChildren(...righe.map((c) => { const b = c.bilancio; return h('tr', { class: 'click', onclick: () => { location.hash = `#/u/cantiere/${c.id}`; } },
      td(c.codice), td(h('strong', null, c.nome), h('div', { class: 'det' }, c.cliente || '')), h('td', { style: 'white-space:nowrap' }, c.stato),
      tdE(b.ricavi.offerta), tdE(b.ricavi.sal_fatturati), tdE(b.ricavi.da_fatturare),
      tdE(b.costi.manodopera), tdE(b.costi.trasporti), tdE(b.costi.trasferte), tdE(b.costi.materiali), tdE(b.costi.totale),
      tdE(b.margine, true), h('td', { class: 'n ' + classeSegno(b.margine) }, pct(b.margine_pct)),
      h('td', { class: 'n' }, b.spese_da_approvare.numero ? h('span', { class: 'pill attesa' }, b.spese_da_approvare.numero) : ''),
      h('td', { class: 'n' }, b.diario.giorni_ritardo || '')); }));
    const s = (f) => righe.reduce((a, c) => a + f(c.bilancio), 0);
    const off = s((b) => b.ricavi.offerta), marg = s((b) => b.margine);
    piede.replaceChildren(h('tr', { class: 'tot' }, td(''), td(`Totale (${righe.length})`), td(''),
      tdE(off), tdE(s((b) => b.ricavi.sal_fatturati)), tdE(s((b) => b.ricavi.da_fatturare)),
      tdE(s((b) => b.costi.manodopera)), tdE(s((b) => b.costi.trasporti)), tdE(s((b) => b.costi.trasferte)), tdE(s((b) => b.costi.materiali)),
      tdE(s((b) => b.costi.totale)), tdE(marg, true), h('td', { class: 'n' }, off ? pct(marg / off) : '–'), td(''), td('')));
  };
  filtroStato.onchange = filtroTesto.oninput = disegna;
  main.append(h('div', { class: 'intestazione' }, h('h1', null, 'Cruscotto cantieri'),
    h('div', { class: 'no-stampa', style: 'display:flex;gap:.5rem' }, h('button', { onclick: () => print() }, 'Stampa'), h('button', { class: 'primario', onclick: () => modificaCantiere() }, '+ Nuovo cantiere'))),
    h('div', { class: 'filtri no-stampa' }, filtroStato, filtroTesto),
    h('div', { class: 'scorri' }, h('table', { class: 'tabella' },
      h('thead', null, h('tr', null, ['Codice', 'Cantiere', 'Stato'].map((x) => h('th', null, x)),
        ['Offerta', 'SAL fatturati', 'Da fatturare', 'Manodopera', 'Trasporti', 'Trasferte', 'Materiali', 'Costo totale', 'Margine', 'Margine %', 'Spese da appr.', 'Gg ritardo'].map((x) => h('th', { class: 'n' }, x)))),
      corpo, piede)),
    h('p', { class: 'det' }, 'Margine = offerta confermata − costo totale. I costi comprendono gli scontrini entro il limite e quelli approvati.'));
  disegna();
}

export function modificaCantiere(c = {}, dopo) {
  const i = (name, attrs = {}) => h('input', { name, value: c[name] ?? '', ...attrs });
  dialogo(c.id ? 'Modifica cantiere' : 'Nuovo cantiere', [
    h('div', { class: 'form-riga' }, h('div', { class: 'stretto' }, campo('Codice', i('codice', { required: true, placeholder: 'C003' }))), h('div', null, campo('Nome cantiere', i('nome', { required: true })))),
    campo('Cliente', i('cliente')), campo('Indirizzo', i('indirizzo')),
    h('div', { class: 'form-riga' }, h('div', null, campo('Data inizio', i('data_inizio', { type: 'date' }))), h('div', null, campo('Data fine', i('data_fine', { type: 'date' })))),
    h('div', { class: 'form-riga' }, h('div', null, campo('Stato', h('select', { name: 'stato' }, STATI.map((s) => h('option', { selected: s === (c.stato || 'In corso') }, s))))),
      h('div', null, campo('Offerta confermata (€)', i('offerta', { inputmode: 'decimal', value: c.offerta ?? '' })))),
  ], { onConferma: async (f) => {
    const v = valori(f); v.offerta = numero(v.offerta || 0);
    if (c.id) { await put(`/api/cantieri/${c.id}`, v); avviso('Cantiere aggiornato'); dopo?.(); }
    else { const r = await post('/api/cantieri', v); avviso('Cantiere creato'); location.hash = `#/u/cantiere/${r.id}`; }
  } });
}

// ---------- Scheda cantiere ----------
export async function scheda(main, id) {
  const [s, utenti] = await Promise.all([get(`/api/cantieri/${id}/scheda`), get('/api/utenti')]);
  const { cantiere: c, bilancio: b } = s;
  const ricarica = () => window.dispatchEvent(new Event('hashchange'));
  const riga = (et, v, cls = '') => h('div', { class: 'r ' + cls }, h('span', null, et), h('span', { class: typeof v === 'number' ? classeSegno(v) : '' }, typeof v === 'number' ? eur(v) : v));

  main.append(
    h('a', { href: '#/u', class: 'no-stampa', style: 'font-size:.9rem' }, '‹ Cruscotto'),
    h('div', { class: 'solo-stampa', style: 'color:#555;font-size:9pt' }, `Scheda cantiere stampata il ${dataIt(oggi())}`),
    h('div', { class: 'intestazione' },
      h('div', null, h('div', { class: 'det' }, c.codice, ' · ', c.stato), h('h1', { style: 'margin:.2rem 0' }, c.nome),
        h('div', { class: 'det' }, [c.cliente, c.indirizzo].filter(Boolean).join(' · ')),
        h('div', { class: 'det' }, 'Dal ', dataIt(c.data_inizio) || '–', c.data_fine ? ' al ' + dataIt(c.data_fine) : '',
          ' · Capisquadra: ', s.assegnati.map((a) => a.nome).join(', ') || 'nessuno')),
      h('div', { class: 'no-stampa', style: 'display:flex;gap:.5rem;flex-wrap:wrap' },
        h('button', { onclick: () => modificaCantiere(c, ricarica) }, 'Modifica'),
        h('button', { onclick: () => assegna(c, s.assegnati, utenti, ricarica) }, 'Capisquadra'),
        h('a', { class: 'bottone', href: `#/c/${c.id}` }, 'Inserisci dati'),
        h('button', { class: 'primario', onclick: () => print() }, 'Stampa PDF'))),
    h('div', { class: 'griglia', style: 'margin-top:1rem' },
      h('div', { class: 'kpi' }, h('div', { class: 'et' }, 'Offerta confermata'), h('div', { class: 'v' }, eur(b.ricavi.offerta))),
      h('div', { class: 'kpi' }, h('div', { class: 'et' }, 'Costo totale'), h('div', { class: 'v' }, eur(b.costi.totale))),
      h('div', { class: 'kpi' }, h('div', { class: 'et' }, 'Margine'), h('div', { class: 'v ' + classeSegno(b.margine) }, eur(b.margine), ' ', h('small', null, pct(b.margine_pct))))),
    h('div', { class: 'griglia', style: 'margin-top:.75rem' },
      h('div', { class: 'card righe' }, h('h3', { style: 'margin-top:0' }, 'Ricavi'),
        riga('Offerta confermata', b.ricavi.offerta), riga('SAL fatturati', b.ricavi.sal_fatturati), riga('Da fatturare', b.ricavi.da_fatturare, 'tot')),
      h('div', { class: 'card righe' }, h('h3', { style: 'margin-top:0' }, 'Costi'),
        riga(`Manodopera (${n(b.quantita.ore)} ore)`, b.costi.manodopera), riga(`Trasporti (${n(b.quantita.km)} km)`, b.costi.trasporti),
        riga('Trasferte: pasti e cibo', b.costi.trasferte_pasti), riga('Trasferte: pernottamenti', b.costi.trasferte_pernottamenti), riga('Trasferte: altro', b.costi.trasferte_altro),
        riga('Materiali (costo reale)', b.costi.materiali), riga('Costo totale', b.costi.totale, 'tot'),
        b.spese_da_approvare.numero ? h('div', { class: 'det', style: 'margin-top:.4rem' }, `Esclusi ${b.spese_da_approvare.numero} scontrini da approvare (${eur(b.spese_da_approvare.importo)})`) : null),
      h('div', { class: 'card righe' }, h('h3', { style: 'margin-top:0' }, 'Materiali'),
        riga('Costo previsto (preventivo)', b.materiali.previsto), riga('Mancanti aggiunti', b.materiali.aggiunte), riga('Avanzi resi', -b.materiali.avanzi),
        riga('Costo reale', b.materiali.reale, 'tot'), riga('Scostamento sul preventivo', b.materiali.scostamento),
        h('div', { class: 'det', style: 'margin-top:.4rem' }, `Diario: ${b.diario.note} note, ${b.diario.giorni_ritardo} giorni di ritardo annotati`))),
  );

  // Materiali (preventivo modificabile)
  const senzaPrezzo = s.materiali.filter((m) => m.prezzo === null).length;
  main.append(h('h2', null, 'Materiali'),
    senzaPrezzo ? h('div', { class: 'card', style: 'background:var(--giallo)' }, senzaPrezzo === 1 ? 'Un materiale aggiunto dal cantiere non ha ancora un prezzo: inseriscilo per averlo nel bilancio.' : `${senzaPrezzo} materiali aggiunti dal cantiere non hanno ancora un prezzo: inseriscilo per averli nel bilancio.`) : null,
    h('div', { class: 'scorri' }, h('table', { class: 'tabella' },
      h('thead', null, h('tr', null, h('th', null, 'Materiale'), h('th', null, 'U.M.'), ['Prezzo', 'Prevista', 'Aggiunta', 'Avanzata', 'Usata', 'Costo previsto', 'Costo reale', 'Scostamento'].map((x) => h('th', { class: 'n' }, x)), h('th', { class: 'no-stampa' }, ''))),
      h('tbody', null, s.materiali.map((m) => h('tr', null, td(m.materiale), td(m.um || ''), h('td', { class: 'n' }, m.prezzo === null ? h('span', { class: 'pill attesa' }, 'manca') : eur(m.prezzo)),
        h('td', { class: 'n' }, n(m.q_prevista)), h('td', { class: 'n' }, n(m.q_aggiunta)), h('td', { class: 'n' }, n(m.q_avanzata)), h('td', { class: 'n' }, n(m.q_usata)),
        tdE(m.costo_previsto), tdE(m.costo_reale), h('td', { class: 'n ' + (m.scostamento > 0 ? 'neg' : m.scostamento < 0 ? 'pos' : '') }, eur(m.scostamento)),
        h('td', { class: 'no-stampa', style: 'white-space:nowrap' }, h('button', { class: 'piccolo', onclick: () => materiale(c.id, m, ricarica) }, 'Modifica'), ' ',
          h('button', { class: 'piccolo pericolo', onclick: conErrore(async () => { if (confirm(`Eliminare ${m.materiale} e i suoi movimenti?`)) { await del(`/api/materiali/${m.id}`); ricarica(); } }) }, '×')))),
      s.materiali.length ? null : h('tr', null, h('td', { colspan: 11, class: 'det' }, 'Nessun materiale a preventivo.'))))),
    h('button', { class: 'no-stampa', style: 'margin-top:.5rem', onclick: () => materiale(c.id, {}, ricarica) }, '+ Materiale a preventivo'));

  // SAL
  main.append(h('h2', null, 'SAL emessi'),
    h('div', { class: 'scorri' }, h('table', { class: 'tabella' },
      h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'N.'), h('th', { class: 'n' }, 'Importo'), h('th', null, 'Fattura'), h('th', null, 'Note'), h('th', { class: 'no-stampa' }, ''))),
      h('tbody', null, s.sal.map((x) => h('tr', null, td(dataIt(x.data)), td(x.numero ?? ''), tdE(x.importo), td(x.fattura || ''), td(x.note || ''),
        h('td', { class: 'no-stampa' }, h('button', { class: 'piccolo pericolo', onclick: conErrore(async () => { if (confirm('Eliminare questo SAL?')) { await del(`/api/sal/${x.id}`); ricarica(); } }) }, '×')))),
      s.sal.length ? null : h('tr', null, h('td', { colspan: 6, class: 'det' }, 'Nessun SAL emesso.'))))),
    h('button', { class: 'no-stampa', style: 'margin-top:.5rem', onclick: () => nuovoSal(c.id, s.sal.length + 1, ricarica) }, '+ Nuovo SAL'));

  // Dettaglio ore e km
  main.append(h('div', { class: 'griglia' },
    h('div', null, h('h2', null, 'Ore per operaio'), h('div', { class: 'scorri' }, h('table', { class: 'tabella' },
      h('thead', null, h('tr', null, h('th', null, 'Operaio'), h('th', { class: 'n' }, 'Ore'), h('th', { class: 'n' }, 'Costo'))),
      h('tbody', null, s.ore_per_operaio.map((o) => h('tr', null, td(o.nome), h('td', { class: 'n' }, n(o.ore)), tdE(o.costo))))))),
    h('div', null, h('h2', null, 'Km per mezzo'), h('div', { class: 'scorri' }, h('table', { class: 'tabella' },
      h('thead', null, h('tr', null, h('th', null, 'Mezzo'), h('th', { class: 'n' }, 'Km'), h('th', { class: 'n' }, 'Costo'))),
      h('tbody', null, s.km_per_mezzo.map((o) => h('tr', null, td(o.nome), h('td', { class: 'n' }, n(o.km)), tdE(o.costo)))))))));

  // Spese
  const statoSpesa = { auto: ['Entro limite', 'ok'], da_approvare: ['Da approvare', 'attesa'], approvata: ['Approvata', 'ok'], rifiutata: ['Rifiutata', 'no'] };
  main.append(h('h2', null, 'Spese di trasferta'), h('div', { class: 'scorri' }, h('table', { class: 'tabella' },
    h('thead', null, h('tr', null, h('th', null, 'Data'), h('th', null, 'Tipo'), h('th', { class: 'n' }, 'Importo'), h('th', null, 'Stato'), h('th', null, 'Inserita da'), h('th', { class: 'no-stampa' }, 'Foto'))),
    h('tbody', null, s.spese.map((x) => h('tr', null, td(dataIt(x.data)), td(x.tipo, ''), tdE(x.importo), td(h('span', { class: 'pill ' + statoSpesa[x.stato][1] }, statoSpesa[x.stato][0])),
      td(x.autore || ''), h('td', { class: 'no-stampa' }, fotoMini(x.foto))))),
    s.spese.length ? null : h('tr', null, h('td', { colspan: 6, class: 'det' }, 'Nessuna spesa.')))));

  // Diario
  main.append(h('h2', null, 'Diario'), ...(s.diario.length ? s.diario.map((d) => h('div', { class: 'diario-voce ' + d.tipo },
    h('div', { class: 'det' }, dataIt(d.data), ' · ', d.tipo, d.giorni_ritardo ? ` · ${d.giorni_ritardo} gg di ritardo` : '', d.autore ? ' · ' + d.autore : ''),
    h('div', null, d.testo), d.azione ? h('div', { class: 'det' }, 'Azione: ', d.azione) : null, fotoMini(d.foto))) : [h('p', { class: 'det' }, 'Nessuna nota.')]));
}

function assegna(c, assegnati, utenti, dopo) {
  const set = new Set(assegnati.map((a) => a.id));
  const capi = utenti.filter((u) => u.ruolo === 'caposquadra' && u.attivo);
  dialogo('Capisquadra del cantiere', [h('p', { class: 'det' }, 'Solo i capisquadra assegnati vedono questo cantiere sul telefono.'),
    capi.length ? capi.map((u) => h('label', { style: 'font-weight:400;display:flex;gap:.6rem;align-items:center' },
      h('input', { type: 'checkbox', name: 'u', value: u.id, checked: set.has(u.id), style: 'width:1.3rem;height:1.3rem' }), u.nome)) : h('p', null, 'Nessun caposquadra: crealo in Utenti.')],
  { onConferma: async (f) => { await put(`/api/cantieri/${c.id}/assegnazioni`, { utenti: new FormData(f).getAll('u').map(Number) }); avviso('Assegnazioni salvate'); dopo(); } });
}

function materiale(cid, m, dopo) {
  dialogo(m.id ? 'Modifica materiale' : 'Materiale a preventivo', [
    campo('Materiale', h('input', { name: 'materiale', value: m.materiale || '', required: true })),
    h('div', { class: 'form-riga' }, h('div', null, campo('U.M.', h('input', { name: 'um', value: m.um || '' }))),
      h('div', null, campo('Prezzo unitario (€)', h('input', { name: 'prezzo', inputmode: 'decimal', value: m.prezzo ?? '' }))),
      h('div', null, campo('Quantità prevista', h('input', { name: 'q_prevista', inputmode: 'decimal', value: m.q_prevista ?? '' })))),
  ], { onConferma: async (f) => {
    const v = valori(f); v.prezzo = v.prezzo === '' ? null : numero(v.prezzo); v.q_prevista = numero(v.q_prevista || 0);
    if (m.id) await put(`/api/materiali/${m.id}`, v); else await post(`/api/cantieri/${cid}/materiali`, v);
    dopo();
  } });
}

function nuovoSal(cid, numeroSal, dopo) {
  dialogo('Nuovo SAL', [
    h('div', { class: 'form-riga' }, h('div', null, campo('Data', h('input', { type: 'date', name: 'data', value: oggi(), required: true }))),
      h('div', { class: 'stretto' }, campo('N. SAL', h('input', { name: 'numero', inputmode: 'numeric', value: numeroSal })))),
    campo('Importo (€)', h('input', { name: 'importo', inputmode: 'decimal', required: true })),
    campo('N. fattura', h('input', { name: 'fattura' })), campo('Note', h('input', { name: 'note' })),
  ], { onConferma: async (f) => { const v = valori(f); v.importo = numero(v.importo); v.numero = v.numero ? numero(v.numero) : null; await post(`/api/cantieri/${cid}/sal`, v); dopo(); } });
}

// ---------- Spese da approvare ----------
export async function spese(main) {
  const lista = await get('/api/spese?stato=da_approvare');
  main.append(h('h1', null, 'Spese da approvare'), h('p', { class: 'det' }, 'Scontrini sopra il limite impostato per il loro tipo. Finché non li approvi non entrano nel bilancio.'));
  if (!lista.length) { main.append(h('div', { class: 'card' }, '✓ Nessuna spesa in attesa.')); return; }
  main.append(h('div', { class: 'griglia' }, lista.map((s) => {
    const card = h('div', { class: 'card' },
      h('div', { class: 'intestazione' }, h('div', null, h('strong', null, s.tipo, ' · ', eur(s.importo)), h('div', { class: 'det' }, dataIt(s.data), ' · ', s.codice, ' ', s.cantiere),
        h('div', { class: 'det' }, 'Inserita da ', s.autore || '–', s.scontrino ? ' · scontrino ' + s.scontrino : '')), null),
      s.note ? h('p', { style: 'margin:.4rem 0' }, s.note) : null,
      fotoMini(s.foto) || h('div', { class: 'det' }, 'Senza foto'),
      h('div', { style: 'display:flex;gap:.5rem;margin-top:.75rem' },
        h('button', { class: 'primario', onclick: conErrore(async () => { await post(`/api/spese/${s.id}/stato`, { stato: 'approvata' }); card.remove(); avviso('Approvata'); }) }, 'Approva'),
        h('button', { class: 'pericolo', onclick: conErrore(async () => { await post(`/api/spese/${s.id}/stato`, { stato: 'rifiutata' }); card.remove(); avviso('Rifiutata'); }) }, 'Rifiuta')));
    return card;
  })));
}

// ---------- Anagrafiche operai e mezzi ----------
function anagrafica(main, { titolo, url, col, etCol, extra, etExtra, descr }) {
  return async () => {
    const lista = await get(url);
    const ricarica = () => window.dispatchEvent(new Event('hashchange'));
    const fmt = (v) => col === 'costo_km' ? eur(v).replace(/,(\d\d)\s/, ',$1 ') : eur(v);
    main.append(h('div', { class: 'intestazione' }, h('h1', null, titolo),
      h('button', { class: 'primario', onclick: () => dialogo(`Nuovo: ${titolo.toLowerCase()}`, [
        campo('Nome', h('input', { name: 'nome', required: true })), extra ? campo(etExtra, h('input', { name: extra })) : null,
        h('div', { class: 'form-riga' }, h('div', null, campo(etCol, h('input', { name: col, inputmode: 'decimal', required: true }))),
          h('div', null, campo('Valida dal', h('input', { name: 'dal', type: 'date', value: '2000-01-01' })))),
      ], { onConferma: async (f) => { const v = valori(f); v[col] = numero(v[col]); await post(url, v); ricarica(); } }) }, '+ Aggiungi')),
    h('p', { class: 'det' }, descr),
    h('div', { class: 'scorri' }, h('table', { class: 'tabella' },
      h('thead', null, h('tr', null, h('th', null, 'Nome'), extra ? h('th', null, etExtra) : null, h('th', { class: 'n' }, etCol + ' attuale'), h('th', null, 'Storico'), h('th', null, 'Attivo'), h('th', null, ''))),
      h('tbody', null, lista.map((x) => h('tr', { style: x.attivo ? '' : 'opacity:.55' }, td(x.nome), extra ? td(x[extra] || '') : null,
        h('td', { class: 'n' }, fmt(x[col + '_attuale'])),
        td(h('div', { class: 'det' }, x.storico.map((t) => `dal ${dataIt(t.dal)}: ${fmt(t[col])}`).join(' · '))),
        td(x.attivo ? 'Sì' : 'No'),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'piccolo', onclick: () => dialogo(`Nuova ${etCol.toLowerCase()}: ${x.nome}`, [
            h('p', { class: 'det' }, 'Vale dal giorno indicato in poi. Le registrazioni precedenti mantengono la tariffa vecchia.'),
            h('div', { class: 'form-riga' }, h('div', null, campo(etCol, h('input', { name: col, inputmode: 'decimal', required: true }))),
              h('div', null, campo('Valida dal', h('input', { name: 'dal', type: 'date', value: oggi(), required: true })))),
          ], { onConferma: async (f) => { const v = valori(f); v[col] = numero(v[col]); await post(`${url}/${x.id}/tariffe`, v); ricarica(); } }) }, 'Nuova tariffa'), ' ',
          h('button', { class: 'piccolo', onclick: () => dialogo('Modifica', [
            campo('Nome', h('input', { name: 'nome', value: x.nome, required: true })), extra ? campo(etExtra, h('input', { name: extra, value: x[extra] || '' })) : null,
            h('label', { style: 'display:flex;gap:.5rem;align-items:center' }, h('input', { type: 'checkbox', name: 'attivo', checked: !!x.attivo, style: 'width:1.2rem' }), 'Attivo (compare negli elenchi del cantiere)'),
          ], { onConferma: async (f) => { const v = valori(f); v.attivo = !!v.attivo; await put(`${url}/${x.id}`, v); ricarica(); } }) }, 'Modifica'))))))));
  };
}
export const operai = (main) => anagrafica(main, { titolo: 'Operai', url: '/api/operai', col: 'tariffa', etCol: 'Tariffa oraria', extra: 'ruolo', etExtra: 'Ruolo',
  descr: 'Gli operai non entrano nell\'app: le loro ore le inserisce il caposquadra.' })();
export const mezzi = (main) => anagrafica(main, { titolo: 'Mezzi', url: '/api/mezzi', col: 'costo_km', etCol: 'Costo al km', descr: 'Costo al km comprensivo di carburante, usura e assicurazione.' })();

// ---------- Utenti ----------
export async function utenti(main) {
  const lista = await get('/api/utenti');
  const ricarica = () => window.dispatchEvent(new Event('hashchange'));
  const form = (u = {}) => [
    campo('Nome', h('input', { name: 'nome', value: u.nome || '', required: true })),
    campo('Email (per accedere)', h('input', { name: 'email', type: 'email', value: u.email || '', required: true })),
    campo('Ruolo', h('select', { name: 'ruolo' }, h('option', { value: 'caposquadra', selected: u.ruolo !== 'ufficio' }, 'Caposquadra (telefono, senza costi)'), h('option', { value: 'ufficio', selected: u.ruolo === 'ufficio' }, 'Ufficio (vede tutto)'))),
    campo(u.id ? 'Nuova password (lascia vuoto per non cambiarla)' : 'Password (almeno 8 caratteri)', h('input', { name: 'password', type: 'text', autocomplete: 'new-password', required: !u.id, minLength: 8 })),
    u.id ? h('label', { style: 'display:flex;gap:.5rem;align-items:center' }, h('input', { type: 'checkbox', name: 'attivo', checked: !!u.attivo, style: 'width:1.2rem' }), 'Può accedere') : null,
  ];
  main.append(h('div', { class: 'intestazione' }, h('h1', null, 'Utenti'),
    h('button', { class: 'primario', onclick: () => dialogo('Nuovo utente', form(), { onConferma: async (f) => { await post('/api/utenti', valori(f)); ricarica(); } }) }, '+ Nuovo utente')),
    h('p', { class: 'det' }, 'Dopo aver creato un caposquadra, assegnalo ai suoi cantieri dalla scheda del cantiere (pulsante "Capisquadra").'),
    h('div', { class: 'scorri' }, h('table', { class: 'tabella' }, h('thead', null, h('tr', null, ['Nome', 'Email', 'Ruolo', 'Accesso', ''].map((x) => h('th', null, x)))),
      h('tbody', null, lista.map((u) => h('tr', { style: u.attivo ? '' : 'opacity:.55' }, td(u.nome), td(u.email), td(u.ruolo === 'ufficio' ? 'Ufficio' : 'Caposquadra'), td(u.attivo ? 'Attivo' : 'Disattivato'),
        td(h('button', { class: 'piccolo', onclick: () => dialogo('Modifica utente', form(u), { onConferma: async (f) => { const v = valori(f); v.attivo = !!v.attivo; await put(`/api/utenti/${u.id}`, v); ricarica(); } }) }, 'Modifica'))))))));
}

// ---------- Limiti di spesa ----------
export async function limiti(main) {
  const lista = await get('/api/limiti');
  main.className = 'stretto';
  main.append(h('h1', null, 'Limiti di spesa'),
    h('p', { class: 'det' }, 'Uno scontrino fino al limite conta subito nel bilancio; sopra il limite va approvato dall\'ufficio. Con 0 € va sempre approvato.'),
    h('form', { class: 'card', onsubmit: conErrore(async (e) => { e.preventDefault(); const v = valori(e.target); for (const k in v) v[k] = numero(v[k]); await put('/api/limiti', v); avviso('Limiti salvati'); }) },
      lista.map((l) => campo(l.tipo + ' (€)', h('input', { name: l.tipo, inputmode: 'decimal', value: String(l.limite).replace('.', ',') }))),
      h('button', { class: 'primario grande', type: 'submit' }, 'Salva')));
}

// ---------- Esporta ----------
export async function esporta(main) {
  const cantieri = await get('/api/riepilogo');
  const d = new Date(); const primo = new Date(d.getFullYear(), d.getMonth() - 1, 1); const ultimo = new Date(d.getFullYear(), d.getMonth(), 0);
  const iso = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dal = h('input', { type: 'date', value: iso(primo) }), al = h('input', { type: 'date', value: iso(ultimo) });
  const cant = h('select', null, h('option', { value: '' }, 'Tutti i cantieri'), cantieri.map((c) => h('option', { value: c.id }, `${c.codice} ${c.nome}`)));
  const scarica = (tipo, periodo = true) => {
    const p = new URLSearchParams(); if (periodo) { p.set('dal', dal.value); p.set('al', al.value); } if (cant.value) p.set('cantiere', cant.value);
    location.href = `/api/export/${tipo}.csv?${p}`;
  };
  main.className = 'stretto';
  main.append(h('h1', null, 'Esporta dati'),
    h('p', { class: 'det' }, 'File CSV che si aprono direttamente con Excel, da inviare al commercialista o caricare in un gestionale.'),
    h('div', { class: 'card' }, h('div', { class: 'form-riga' }, h('div', null, campo('Dal', dal)), h('div', null, campo('Al', al))), campo('Cantiere', cant),
      h('h3', null, 'Movimenti del periodo'),
      h('div', { class: 'scelte' }, [['ore', 'Ore'], ['km', 'Km'], ['spese', 'Spese'], ['sal', 'SAL']].map(([t, et]) => h('button', { type: 'button', onclick: () => scarica(t) }, et))),
      h('h3', null, 'Situazione attuale'),
      h('div', { class: 'scelte' }, h('button', { type: 'button', onclick: () => scarica('riepilogo', false) }, 'Riepilogo cantieri'), h('button', { type: 'button', onclick: () => scarica('materiali', false) }, 'Materiali'))));
}
