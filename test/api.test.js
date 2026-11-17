import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { apriDb } from '../server/db.js';
import { creaApp } from '../server/app.js';
import { caricaDemo } from '../server/dati-demo.js';

let server, base, demo, db;
before(async () => {
  db = apriDb(null);
  demo = caricaDemo(db);
  server = creaApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(email, password) {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (method, url, body, isForm) => {
    const res = await fetch(base + url, { method, headers: { cookie, ...(body && !isForm ? { 'content-type': 'application/json' } : {}) }, body: isForm ? body : body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  };
  return call;
}

test('bilancio identico al foglio Excel (C001 e C002)', async () => {
  const uff = await login('ufficio@demo.it', 'ufficio123');
  const r = await uff('GET', '/api/riepilogo');
  const [c1, c2] = r.body;
  assert.equal(c1.bilancio.costi.manodopera, 688);
  assert.equal(c1.bilancio.costi.trasporti, 57.6);
  assert.equal(c1.bilancio.costi.trasferte, 18.3);
  assert.equal(c1.bilancio.costi.materiali, 3706);
  assert.equal(c1.bilancio.costi.totale, 4469.9);
  assert.equal(c1.bilancio.margine, 43530.1);
  assert.equal(c1.bilancio.ricavi.da_fatturare, 33000);
  assert.equal(c1.bilancio.materiali.scostamento, 30);
  assert.equal(c2.bilancio.costi.totale, 13125.5);
  assert.equal(c2.bilancio.materiali.scostamento, -466);
  assert.equal(c1.bilancio.diario.giorni_ritardo, 2);
});

test('login errato rifiutato e API protette', async () => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ufficio@demo.it', password: 'sbagliata' }) });
  assert.equal(r.status, 401);
  assert.equal((await fetch(base + '/api/riepilogo')).status, 401);
});

test('il caposquadra non vede costi né cantieri non assegnati', async () => {
  const capo = await login('rossi@demo.it', 'cantiere123');
  const d = await capo('GET', '/api/dati-base');
  assert.deepEqual(d.body.cantieri.map((c) => c.codice), ['C001']);
  const testo = JSON.stringify(d.body);
  assert.ok(!/tariffa|costo|prezzo|offerta/i.test(testo), 'nessun dato economico nei dati base');
  assert.equal((await capo('GET', '/api/riepilogo')).status, 403);
  assert.equal((await capo('GET', `/api/cantieri/${demo.c1}/scheda`)).status, 403);
  assert.equal((await capo('GET', `/api/cantieri/${demo.c2}/attivita`)).status, 403);
  assert.equal((await capo('GET', '/api/export/ore.csv')).status, 403);
  const att = await capo('GET', `/api/cantieri/${demo.c1}/attivita?giorni=365`);
  assert.equal(att.status, 200);
  assert.ok(!/tariffa|costo|prezzo/i.test(JSON.stringify(att.body)));
});

test('inserimento ore idempotente (invio ripetuto dopo offline)', async () => {
  const capo = await login('rossi@demo.it', 'cantiere123');
  const uff = await login('ufficio@demo.it', 'ufficio123');
  const id = crypto.randomUUID();
  const voce = { id, cantiere_id: demo.c1, operaio_id: demo.op['Verdi Andrea'], data: '2026-11-10', ore: 8 };
  assert.equal((await capo('POST', '/api/ore', voce)).status, 200);
  const r2 = await capo('POST', '/api/ore', voce);
  assert.equal(r2.body.duplicato, true);
  const s = await uff('GET', `/api/cantieri/${demo.c1}/scheda`);
  assert.equal(s.body.bilancio.costi.manodopera, 688 + 8 * 24);
  assert.equal((await capo('POST', '/api/ore', { ...voce, id: crypto.randomUUID(), cantiere_id: demo.c2 })).status, 403);
  assert.equal((await capo('POST', '/api/ore', { ...voce, id: crypto.randomUUID(), ore: 30 })).status, 400);
  await capo('DELETE', `/api/ore/${id}`);
});

test('scontrino: entro limite conta subito, oltre va approvato', async () => {
  const capo = await login('rossi@demo.it', 'cantiere123');
  const uff = await login('ufficio@demo.it', 'ufficio123');
  const prima = (await uff('GET', `/api/cantieri/${demo.c1}/scheda`)).body.bilancio.costi.trasferte;
  const f1 = new FormData();
  Object.entries({ id: crypto.randomUUID(), cantiere_id: demo.c1, data: '2026-11-10', tipo: 'Pranzo', importo: '20,50' }).forEach(([k, v]) => f1.append(k, v));
  f1.append('foto', new Blob([Buffer.from('/9j/4AAQ', 'base64')], { type: 'image/jpeg' }), 'scontrino.jpg');
  const r1 = await capo('POST', '/api/spese', f1, true);
  assert.equal(r1.body.stato, 'auto');
  const idGrande = crypto.randomUUID();
  const f2 = new FormData();
  Object.entries({ id: idGrande, cantiere_id: demo.c1, data: '2026-11-10', tipo: 'Pernottamento', importo: '120' }).forEach(([k, v]) => f2.append(k, v));
  const r2 = await capo('POST', '/api/spese', f2, true);
  assert.equal(r2.body.stato, 'da_approvare');
  let b = (await uff('GET', `/api/cantieri/${demo.c1}/scheda`)).body.bilancio;
  assert.equal(b.costi.trasferte, Math.round((prima + 20.5) * 100) / 100);
  assert.equal(b.spese_da_approvare.numero, 1);
  const lista = await uff('GET', '/api/spese?stato=da_approvare');
  assert.equal(lista.body.length, 1);
  await uff('POST', `/api/spese/${idGrande}/stato`, { stato: 'approvata' });
  b = (await uff('GET', `/api/cantieri/${demo.c1}/scheda`)).body.bilancio;
  assert.equal(b.costi.trasferte, Math.round((prima + 140.5) * 100) / 100);
  // la foto è visibile al caposquadra del cantiere ma non a un altro
  const att = await capo('GET', `/api/cantieri/${demo.c1}/attivita`);
  const fid = att.body.spese.find((s) => s.foto.length).foto[0];
  assert.equal((await capo('GET', `/api/foto/${fid}`)).status, 200);
  const altro = await login('bianchi@demo.it', 'cantiere123');
  assert.equal((await altro('GET', `/api/foto/${fid}`)).status, 403);
});

test('tariffa storicizzata: un aumento non cambia le ore già fatte', async () => {
  const uff = await login('ufficio@demo.it', 'ufficio123');
  const prima = (await uff('GET', `/api/cantieri/${demo.c1}/scheda`)).body.bilancio.costi.manodopera;
  await uff('POST', `/api/operai/${demo.op['Rossi Mario']}/tariffe`, { dal: '2027-01-01', tariffa: 40 });
  assert.equal((await uff('GET', `/api/cantieri/${demo.c1}/scheda`)).body.bilancio.costi.manodopera, prima);
});

test('materiale mancante non previsto e avanzo', async () => {
  const capo = await login('rossi@demo.it', 'cantiere123');
  const f = new FormData();
  Object.entries({ id: crypto.randomUUID(), cantiere_id: demo.c1, tipo: 'aggiunta', nuovo_materiale: 'Silicone', um: 'tubetto', quantita: '4', data: '2026-11-10' }).forEach(([k, v]) => f.append(k, v));
  assert.equal((await capo('POST', '/api/movimenti', f, true)).status, 200);
  const d = await capo('GET', '/api/dati-base');
  assert.ok(d.body.materiali.some((m) => m.materiale === 'Silicone' && m.q_prevista === 0));
});

test('diario e export CSV', async () => {
  const capo = await login('rossi@demo.it', 'cantiere123');
  const uff = await login('ufficio@demo.it', 'ufficio123');
  const f = new FormData();
  Object.entries({ id: crypto.randomUUID(), cantiere_id: demo.c1, data: '2026-11-11', tipo: 'Ritardo', testo: 'Pioggia; lavori fermi', giorni_ritardo: '1' }).forEach(([k, v]) => f.append(k, v));
  assert.equal((await capo('POST', '/api/diario', f, true)).status, 200);
  const s = await uff('GET', `/api/cantieri/${demo.c1}/scheda`);
  assert.equal(s.body.bilancio.diario.giorni_ritardo, 3);
  const csv = await uff('GET', '/api/export/riepilogo.csv');
  assert.match(csv.body, /^\uFEFF?Codice;Cantiere/); // fetch toglie il BOM in lettura
  assert.match(csv.body, /C001;Ristrutturazione Villa Neri/);
  const ore = await uff('GET', '/api/export/ore.csv?dal=2026-11-01&al=2026-11-30');
  assert.equal(ore.body.trim().split('\r\n').length, 4); // intestazione + 3 righe di novembre su C001
});
