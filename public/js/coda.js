// Funzionamento senza campo.
// Ogni inserimento dal cantiere va prima in una coda sul telefono (IndexedDB, foto comprese)
// e viene inviato appena c'è connessione. Gli id sono generati qui, quindi un invio ripetuto
// non crea doppioni sul server. I dati di consultazione (cantieri, operai, mezzi, materiali,
// ultimi inserimenti) vengono salvati sul telefono per poterli usare anche offline.
import { api, ErroreApi } from './api.js';

const DB = 'scheda-cantiere', V = 1;
let dbp;
function apri() {
  dbp ??= new Promise((ok, ko) => {
    const r = indexedDB.open(DB, V);
    r.onupgradeneeded = () => { r.result.createObjectStore('coda', { keyPath: 'id' }); r.result.createObjectStore('cache'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  });
  return dbp;
}
async function op(store, modo, fn) {
  const db = await apri();
  return new Promise((ok, ko) => {
    const t = db.transaction(store, modo); const s = t.objectStore(store);
    const r = fn(s); t.oncomplete = () => ok(r?.result); t.onerror = () => ko(t.error);
  });
}

export const cacheSalva = (k, v) => op('cache', 'readwrite', (s) => s.put(v, k));
export const cacheLeggi = (k) => op('cache', 'readonly', (s) => s.get(k));
export const cacheSvuota = () => op('cache', 'readwrite', (s) => s.clear());

export const nuovoId = () => crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));

const ascoltatori = new Set();
export const suCambio = (fn) => { ascoltatori.add(fn); return () => ascoltatori.delete(fn); };
const avvisa = async () => { const st = await stato(); ascoltatori.forEach((f) => f(st)); };

export const elenco = () => op('coda', 'readonly', (s) => s.getAll()).then((l) => l.sort((a, b) => a.creato - b.creato));
export async function stato() {
  const l = await elenco();
  return { inAttesa: l.filter((x) => !x.errore).length, errori: l.filter((x) => x.errore), online: navigator.onLine, invio };
}

// voce: { tipo: 'ore'|'km'|'spese'|'movimenti'|'diario', campi: {...}, foto: [Blob], descrizione, cantiere_id }
export async function accoda(voce) {
  const v = { ...voce, id: voce.campi.id, creato: Date.now(), errore: null };
  await op('coda', 'readwrite', (s) => s.put(v));
  avvisa();
  invia();
  return v;
}
export async function rimuovi(id) { await op('coda', 'readwrite', (s) => s.delete(id)); avvisa(); }

let invio = false;
export async function invia() {
  if (invio) return; invio = true; avvisa();
  let inviate = 0;
  try {
    for (const v of await elenco()) {
      if (v.errore) continue;
      let corpo = v.campi;
      if (['spese', 'movimenti', 'diario'].includes(v.tipo)) {
        corpo = new FormData();
        for (const [k, val] of Object.entries(v.campi)) if (val !== null && val !== undefined) corpo.append(k, val);
        (v.foto || []).forEach((b, i) => corpo.append('foto', b, `foto${i + 1}.jpg`));
      }
      try {
        await api('POST', '/api/' + v.tipo, corpo);
        await op('coda', 'readwrite', (s) => s.delete(v.id)); inviate++;
      } catch (e) {
        if (e instanceof ErroreApi && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
          // Dato rifiutato dal server (es. cantiere non più assegnato): resta visibile con il motivo
          await op('coda', 'readwrite', (s) => s.put({ ...v, errore: e.message }));
        } else break; // nessuna rete o server non raggiungibile: si riprova più tardi
      }
    }
  } finally { invio = false; await avvisa(); }
  if (inviate) window.dispatchEvent(new CustomEvent('coda-inviata', { detail: inviate }));
}

window.addEventListener('online', () => { avvisa(); invia(); });
window.addEventListener('offline', avvisa);
setInterval(() => { if (navigator.onLine) invia(); }, 30000);
