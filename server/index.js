import { apriDb } from './db.js';
import { creaApp } from './app.js';

const dataDir = process.env.DATA_DIR || './data';
const db = apriDb(dataDir);
const app = creaApp(db, { dataDir, cookieSecure: process.env.COOKIE_SECURE === '1' });
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Scheda Cantiere in ascolto su http://localhost:${port} (dati in ${dataDir})`));
