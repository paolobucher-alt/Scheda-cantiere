// Crea un database di prova con i dati di esempio:  DATA_DIR=./data-demo npm run demo
import { apriDb } from './db.js';
import { caricaDemo } from './dati-demo.js';

const db = apriDb(process.env.DATA_DIR || './data');
if (db.prepare('SELECT COUNT(*) n FROM utenti').get().n > 0) { console.error('Il database contiene già dati: uso una cartella DATA_DIR vuota.'); process.exit(1); }
caricaDemo(db);
console.log('Dati di esempio caricati. Accessi: ufficio@demo.it / ufficio123 · rossi@demo.it / cantiere123 · bianchi@demo.it / cantiere123');
