// Crea (o reimposta) un utente ufficio:  npm run crea-admin -- email@ditta.it "Nome Cognome" password
import bcrypt from 'bcryptjs';
import { apriDb } from './db.js';

const [email, nome, password] = process.argv.slice(2);
if (!email || !nome || !password || password.length < 8) {
  console.error('Uso: npm run crea-admin -- email "Nome Cognome" password   (password di almeno 8 caratteri)');
  process.exit(1);
}
const db = apriDb(process.env.DATA_DIR || './data');
db.prepare(`INSERT INTO utenti (email, nome, password_hash, ruolo) VALUES (?, ?, ?, 'ufficio')
  ON CONFLICT(email) DO UPDATE SET nome = excluded.nome, password_hash = excluded.password_hash, ruolo = 'ufficio', attivo = 1`)
  .run(email, nome, bcrypt.hashSync(password, 10));
console.log(`Utente ufficio pronto: ${email}`);
