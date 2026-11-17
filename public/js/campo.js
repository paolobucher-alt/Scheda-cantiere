// Schermate da telefono per il caposquadra (usate anche dall'ufficio per inserire dati).
import { h, oggi, dataIt, n, eur, numero, avviso, sceltaFoto, mostraFoto, campo } from './ui.js';
import { get, del } from './api.js';
import { accoda, elenco, rimuovi, nuovoId, cacheLeggi, cacheSalva } from './coda.js';

// Dati di base: dal server se c'è rete, altrimenti l'ultima copia salvata sul telefono
export async function datiBase(forza = false) {
  if (!forza && window.__base) return window.__base;
  try { window.__base = await get('/api/dati-base'); await cacheSalva('dati-base', window.__base); }
  catch (e) { const c = await cacheLeggi('dati-base'); if (!c) throw e; window.__base = c; }
  return window.__base;
}
const cantiere = (base, id) => base.cantieri.find((c) => c.id === Number(id));
const pref = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('sc:' + k)); localStorage.setItem('sc:' + k, JSON.stringify(v)); } catch { return null; } };

export async function paginaCantieri(main) {
  const base = await datiBase(true).catch(() => datiBase());
  main.className = 'stretto';
  main.append(h('h1', null, 'I miei cantieri'));
  if (!base.cantieri.length) main.append(h('div', { class: 'card' }, 'Nessun cantiere assegnato. Chiedi all\'ufficio di assegnarti ai cantieri in corso.'));
  main.append(h('div', { class: 'lista-cantieri' }, base.cantieri.map((c) => h('a', { class: 'card', href: `#/c/${c.id}` },
    h('div', { class: 'codice' }, c.codice, ' · ', c.stato), h('div', { class: 'nome' }, c.nome),
    h('div', { class: 'det' }, [c.cliente, c.indirizzo].filter(Boolean).join(' · '))))));
}

const etichettaStato = { auto: ['Conteggiata', 'ok'], da_approvare: ['Da approvare', 'attesa'], approvata: ['Approvata', 'ok'], rifiutata: ['Rifiutata', 'no'] };

export async function paginaCantiere(main, id) {
  const base = await datiBase();
  const c = cantiere(base, id);
  if (!c) { main.append(h('div', { class: 'card' }, 'Cantiere non trovato o non assegnato.')); return; }
  main.className = 'stretto';
  main.append(h('div', { class: 'codice', style: 'color:var(--grigio);font-size:.85rem' }, c.codice), h('h1', null, c.nome));
  if (c.indirizzo) main.append(h('div', { class: 'det', style: 'margin-top:-.5rem' }, h('a', { href: 'https://maps.google.com/?q=' + encodeURIComponent(c.indirizzo), target: '_blank', rel: 'noopener' }, '📍 ', c.indirizzo)));
  main.append(h('div', { class: 'azioni-grandi' },
    h('a', { href: `#/c/${id}/ore` }, h('span', null, '⏱'), 'Ore'),
    h('a', { href: `#/c/${id}/km` }, h('span', null, '🚚'), 'Km'),
    h('a', { href: `#/c/${id}/scontrino` }, h('span', null, '🧾'), 'Scontrino'),
    h('a', { href: `#/c/${id}/materiale` }, h('span', null, '🧱'), 'Materiale'),
    h('a', { href: `#/c/${id}/diario` }, h('span', null, '📝'), 'Diario')));

  const box = h('div');
  main.append(h('h2', null, 'Ultimi 14 giorni'), box);
  const disegna = async () => {
    const coda = (await elenco()).filter((v) => Number(v.cantiere_id) === Number(id));
    let att;
    try { att = await get(`/api/cantieri/${id}/attivita`); await cacheSalva('att:' + id, att); }
    catch { att = await cacheLeggi('att:' + id); }
    const voci = [];
    for (const v of coda) voci.push({ data: v.campi.data, testo: v.descrizione, det: v.errore ? '⚠ ' + v.errore : 'In attesa di invio',
      pill: v.errore ? ['Non inviato', 'no'] : ['Da inviare', 'attesa'], elimina: () => rimuovi(v.id) });
    if (att) {
      const canc = (tipo, x) => x.cancellabile ? async () => { await del(`/api/${tipo}/${x.id}`); } : null;
      att.ore.forEach((x) => voci.push({ data: x.data, testo: `${x.operaio}: ${n(x.ore)} ore`, det: x.note, elimina: canc('ore', x) }));
      att.km.forEach((x) => voci.push({ data: x.data, testo: `${x.mezzo}: ${n(x.km)} km`, det: x.note, elimina: canc('km', x) }));
      att.spese.forEach((x) => voci.push({ data: x.data, testo: `${x.tipo} ${eur(x.importo)}`, det: x.scontrino ? 'Scontrino ' + x.scontrino : '',
        pill: etichettaStato[x.stato], foto: x.foto, elimina: canc('spese', x) }));
      att.movimenti.forEach((x) => voci.push({ data: x.data, testo: `${x.tipo === 'aggiunta' ? 'Mancante' : 'Avanzo'}: ${x.materiale} ${n(x.quantita)} ${x.um || ''}`, elimina: canc('movimenti', x) }));
      att.diario.forEach((x) => voci.push({ data: x.data, testo: `${x.tipo}: ${x.testo}`, det: [x.giorni_ritardo ? `${x.giorni_ritardo} gg di ritardo` : '', x.autore].filter(Boolean).join(' · '),
        foto: x.foto, elimina: canc('diario', x) }));
    } else voci.push({ testo: 'Nessuna connessione: gli ultimi inserimenti non sono disponibili.' });
    voci.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    box.replaceChildren(h('div', { class: 'card attivita' }, voci.length ? voci.map((v) => h('div', { class: 'voce' },
      h('div', null, h('div', null, v.testo), v.det ? h('div', { class: 'det' }, v.det) : null,
        v.foto?.length ? h('div', { class: 'miniature' }, v.foto.map((f) => h('img', { src: `/api/foto/${f}`, loading: 'lazy', alt: 'Foto', onclick: () => mostraFoto(`/api/foto/${f}`) }))) : null),
      h('div', { style: 'text-align:right' }, v.data ? h('div', { class: 'det' }, dataIt(v.data)) : null, v.pill ? h('span', { class: 'pill ' + v.pill[1] }, v.pill[0]) : null,
        v.elimina ? h('div', null, h('button', { class: 'piccolo pericolo', style: 'margin-top:.3rem', onclick: async () => {
          if (!confirm('Eliminare questo inserimento?')) return;
          try { await v.elimina(); avviso('Eliminato'); disegna(); } catch (e) { avviso(e.message); }
        } }, 'Elimina')) : null))) : h('div', { class: 'det' }, 'Nessun inserimento negli ultimi 14 giorni.')));
  };
  disegna();
  const agg = () => disegna();
  window.addEventListener('coda-inviata', agg);
  return () => window.removeEventListener('coda-inviata', agg);
}

// Struttura comune dei moduli di inserimento
function modulo(main, c, titolo, corpo, salva) {
  main.className = 'stretto';
  const errore = h('div', { class: 'errore-campo' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); errore.textContent = '';
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const msg = await salva(form);
      avviso(msg || (navigator.onLine ? 'Salvato' : 'Salvato sul telefono: verrà inviato appena c\'è campo'));
      location.hash = `#/c/${c.id}`;
    } catch (er) { errore.textContent = er.message; btn.disabled = false; }
  } }, corpo, errore, h('button', { class: 'primario grande', type: 'submit' }, 'Salva'));
  main.append(h('a', { href: `#/c/${c.id}`, style: 'font-size:.9rem' }, '‹ ', c.nome), h('h1', { style: 'margin-top:.4rem' }, titolo), form);
}
const inputData = () => h('input', { type: 'date', name: 'data', value: oggi(), max: oggi(), required: true });
const scelte = (nome, opzioni, iniziale) => {
  const hidden = h('input', { type: 'hidden', name: nome, value: iniziale || '' });
  const btns = opzioni.map((o) => h('button', { type: 'button', class: o === iniziale ? 'sel' : '', onclick: (e) => {
    hidden.value = o; btns.forEach((b) => b.classList.toggle('sel', b === e.currentTarget)); hidden.dispatchEvent(new Event('change'));
  } }, o));
  return h('div', null, hidden, h('div', { class: 'scelte' }, btns));
};
const deveEssere = (cond, msg) => { if (!cond) throw new Error(msg); };

export async function paginaOre(main, id) {
  const base = await datiBase(); const c = cantiere(base, id); if (!c) return;
  const squadra = new Set(pref('squadra:' + id) || []);
  const righe = base.operai.map((o) => {
    const chk = h('input', { type: 'checkbox', checked: squadra.has(o.id), 'aria-label': o.nome });
    const ore = h('input', { type: 'number', inputmode: 'decimal', step: '0.5', min: '0.5', max: '24', value: '8', 'aria-label': 'Ore ' + o.nome });
    return { o, chk, ore, el: h('label', { class: 'riga', style: 'font-weight:400;margin:0' }, chk, h('span', { class: 'n' }, o.nome, o.ruolo ? h('div', { class: 'det' }, o.ruolo) : null), ore, 'h') };
  });
  const note = h('input', { name: 'note', placeholder: 'Facoltativo' });
  modulo(main, c, 'Ore della squadra', [
    campo('Giorno', inputData()),
    h('label', null, 'Chi ha lavorato oggi'),
    h('div', { class: 'card squadra', style: 'padding:.25rem 1rem' }, righe.map((r) => r.el)),
    campo('Note', note),
  ], async (form) => {
    const sel = righe.filter((r) => r.chk.checked);
    deveEssere(sel.length, 'Seleziona almeno un operaio');
    const giorno = form.data.value;
    for (const r of sel) { const v = numero(r.ore.value); deveEssere(v > 0 && v <= 24, `Ore non valide per ${r.o.nome}`); }
    for (const r of sel) await accoda({ tipo: 'ore', cantiere_id: c.id, descrizione: `${r.o.nome}: ${n(numero(r.ore.value))} ore`,
      campi: { id: nuovoId(), cantiere_id: c.id, operaio_id: r.o.id, data: giorno, ore: numero(r.ore.value), note: note.value || null } });
    pref('squadra:' + id, sel.map((r) => r.o.id));
    return `${sel.length} ${sel.length === 1 ? 'operaio registrato' : 'operai registrati'}${navigator.onLine ? '' : ' sul telefono'}`;
  });
}

export async function paginaKm(main, id) {
  const base = await datiBase(); const c = cantiere(base, id); if (!c) return;
  const ultimo = pref('mezzo');
  const mezzo = h('select', { name: 'mezzo', required: true }, h('option', { value: '' }, 'Scegli il mezzo'),
    base.mezzi.map((m) => h('option', { value: m.id, selected: m.id === ultimo }, m.nome)));
  const km = h('input', { name: 'km', type: 'number', inputmode: 'decimal', step: '0.1', min: '0', placeholder: 'es. 64' });
  const part = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'Partenza' });
  const arr = h('input', { type: 'number', inputmode: 'numeric', placeholder: 'Arrivo' });
  const calc = () => { const a = numero(arr.value) - numero(part.value); if (a > 0) km.value = a; };
  part.oninput = arr.oninput = calc;
  modulo(main, c, 'Km percorsi', [
    campo('Giorno', inputData()), campo('Mezzo', mezzo), campo('Km totali', km),
    h('details', { style: 'margin-top:.75rem' }, h('summary', null, 'Calcola dal contachilometri'),
      h('div', { style: 'display:flex;gap:.5rem;margin-top:.5rem' }, part, arr)),
    campo('Note', h('input', { name: 'note', placeholder: 'es. andata e ritorno dal magazzino' })),
  ], async (form) => {
    const v = numero(km.value);
    deveEssere(mezzo.value, 'Scegli il mezzo'); deveEssere(v > 0, 'Inserisci i km');
    const m = base.mezzi.find((x) => x.id === Number(mezzo.value));
    pref('mezzo', m.id);
    await accoda({ tipo: 'km', cantiere_id: c.id, descrizione: `${m.nome}: ${n(v)} km`,
      campi: { id: nuovoId(), cantiere_id: c.id, mezzo_id: m.id, data: form.data.value, km: v, note: form.note.value || null } });
  });
}

export async function paginaScontrino(main, id) {
  const base = await datiBase(); const c = cantiere(base, id); if (!c) return;
  const foto = sceltaFoto({ etichetta: '📷 Fotografa lo scontrino' });
  modulo(main, c, 'Scontrino', [
    foto.el,
    campo('Tipo di spesa', scelte('tipo', base.tipi_spesa)),
    campo('Importo (€)', h('input', { name: 'importo', type: 'text', inputmode: 'decimal', placeholder: 'es. 14,50', autocomplete: 'off' })),
    campo('Giorno', inputData()),
    campo('N. scontrino', h('input', { name: 'scontrino', placeholder: 'Facoltativo' })),
    campo('Note', h('input', { name: 'note', placeholder: 'es. pranzo squadra di 3 persone' })),
  ], async (form) => {
    const imp = numero(form.importo.value);
    deveEssere(form.tipo.value, 'Scegli il tipo di spesa'); deveEssere(imp > 0, 'Inserisci l\'importo');
    deveEssere(foto.foto.length || confirm('Salvare senza foto dello scontrino?'), 'Aggiungi la foto dello scontrino');
    await accoda({ tipo: 'spese', cantiere_id: c.id, descrizione: `${form.tipo.value} ${eur(imp)}`, foto: foto.foto,
      campi: { id: nuovoId(), cantiere_id: c.id, data: form.data.value, tipo: form.tipo.value, importo: imp, scontrino: form.scontrino.value || null, note: form.note.value || null } });
  });
}

export async function paginaMateriale(main, id) {
  const base = await datiBase(); const c = cantiere(base, id); if (!c) return;
  const mats = base.materiali.filter((m) => m.cantiere_id === c.id);
  const tipo = scelte('tipo', ['Mancante acquistato', 'Avanzo da rendere'], 'Mancante acquistato');
  const sel = h('select', { name: 'materiale_id' }, h('option', { value: '' }, 'Scegli dal preventivo'),
    mats.map((m) => h('option', { value: m.id }, `${m.materiale}${m.um ? ' (' + m.um + ')' : ''}`)), h('option', { value: 'nuovo' }, '+ Materiale non previsto'));
  const nuovo = h('div', { hidden: true }, campo('Nome materiale', h('input', { name: 'nuovo_materiale', placeholder: 'es. Silicone trasparente' })),
    campo('Unità di misura', h('input', { name: 'um', placeholder: 'es. pz, m, m², sacco' })));
  const umLbl = h('span');
  sel.onchange = () => { nuovo.hidden = sel.value !== 'nuovo'; const m = mats.find((x) => x.id === Number(sel.value)); umLbl.textContent = m?.um ? ` (${m.um})` : ''; };
  tipo.querySelector('input').addEventListener('change', (e) => { const av = e.target.value.startsWith('Avanzo'); sel.lastChild.hidden = av; if (av && sel.value === 'nuovo') { sel.value = ''; sel.onchange(); } });
  const foto = sceltaFoto({ etichetta: '📷 Foto della bolla o dello scontrino (facoltativa)' });
  modulo(main, c, 'Materiale', [
    tipo, campo('Materiale', sel), nuovo,
    h('label', null, 'Quantità', umLbl), h('input', { name: 'quantita', type: 'text', inputmode: 'decimal', placeholder: 'es. 15' }),
    campo('Giorno', inputData()), h('div', { style: 'margin-top:.9rem' }, foto.el),
    campo('Note', h('input', { name: 'note', placeholder: 'Facoltativo' })),
  ], async (form) => {
    const q = numero(form.quantita.value);
    const t = form.tipo.value.startsWith('Avanzo') ? 'avanzo' : 'aggiunta';
    deveEssere(sel.value, 'Scegli il materiale'); deveEssere(q > 0, 'Inserisci la quantità');
    const m = mats.find((x) => x.id === Number(sel.value));
    const nome = m ? m.materiale : form.nuovo_materiale.value.trim();
    deveEssere(nome, 'Scrivi il nome del materiale');
    await accoda({ tipo: 'movimenti', cantiere_id: c.id, descrizione: `${t === 'avanzo' ? 'Avanzo' : 'Mancante'}: ${nome} ${n(q)}`, foto: foto.foto,
      campi: { id: nuovoId(), cantiere_id: c.id, tipo: t, materiale_id: m ? m.id : null, nuovo_materiale: m ? null : nome, um: m ? null : (form.um.value || null),
        quantita: q, data: form.data.value, note: form.note.value || null } });
  });
}

export async function paginaDiario(main, id) {
  const base = await datiBase(); const c = cantiere(base, id); if (!c) return;
  const foto = sceltaFoto({ multiple: true, etichetta: '📷 Aggiungi foto' });
  const ritardo = h('div', { hidden: true }, campo('Giorni di ritardo', h('input', { name: 'giorni_ritardo', type: 'number', inputmode: 'numeric', min: '0', value: '0' })));
  const tipo = scelte('tipo', base.tipi_diario);
  tipo.querySelector('input').addEventListener('change', (e) => { ritardo.hidden = e.target.value !== 'Ritardo'; });
  modulo(main, c, 'Nota di diario', [
    campo('Tipo di nota', tipo),
    campo('Cosa è successo', h('textarea', { name: 'testo', placeholder: 'es. Consegna piastrelle slittata di 2 giorni' })),
    ritardo,
    campo('Azione presa', h('input', { name: 'azione', placeholder: 'Facoltativo' })),
    campo('Giorno', inputData()), h('div', { style: 'margin-top:.9rem' }, foto.el),
  ], async (form) => {
    deveEssere(form.tipo.value, 'Scegli il tipo di nota'); deveEssere(form.testo.value.trim(), 'Scrivi cosa è successo');
    await accoda({ tipo: 'diario', cantiere_id: c.id, descrizione: `${form.tipo.value}: ${form.testo.value.trim().slice(0, 60)}`, foto: foto.foto,
      campi: { id: nuovoId(), cantiere_id: c.id, data: form.data.value, tipo: form.tipo.value, testo: form.testo.value.trim(),
        giorni_ritardo: form.tipo.value === 'Ritardo' ? (numero(form.giorni_ritardo.value) || 0) : 0, azione: form.azione.value || null } });
  });
}
