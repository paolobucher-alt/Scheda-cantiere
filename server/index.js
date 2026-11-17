import bcrypt from 'bcryptjs';
import { apriDb } from './db.js';
import { creaApp } from './app.js';

const dataDir = process.env.DATA_DIR || './data';
const db = apriDb(dataDir);

// Al primo avvio, se il database è vuoto, crea l'utente dell'ufficio indicato nelle variabili d'ambiente
const { ADMIN_EMAIL, ADMIN_NOME, ADMIN_PASSWORD } = process.env;
if (ADMIN_EMAIL && ADMIN_PASSWORD && db.prepare('SELECT COUNT(*) n FROM utenti').get().n === 0) {
  if (ADMIN_PASSWORD.length < 8) console.error('ADMIN_PASSWORD deve avere almeno 8 caratteri: utente non creato');
  else {
    db.prepare(`INSERT INTO utenti (email, nome, password_hash, ruolo) VALUES (?, ?, ?, 'ufficio')`)
      .run(ADMIN_EMAIL.trim(), (ADMIN_NOME || 'Ufficio').trim(), bcrypt.hashSync(ADMIN_PASSWORD, 10));
    console.log(`Creato il primo utente dell'ufficio: ${ADMIN_EMAIL}`);
  }
}

const app = creaApp(db, { dataDir, cookieSecure: process.env.COOKIE_SECURE === '1' });
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Scheda Cantiere in ascolto sulla porta ${port} (dati in ${dataDir})`));
