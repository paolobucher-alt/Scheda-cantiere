// Database SQLite (modulo integrato di Node 22). Un solo file in DATA_DIR.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS utenti (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  ruolo TEXT NOT NULL CHECK (ruolo IN ('ufficio','caposquadra')),
  attivo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessioni (
  token TEXT PRIMARY KEY,
  utente_id INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  scadenza TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operai (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  ruolo TEXT,
  attivo INTEGER NOT NULL DEFAULT 1
);
-- Tariffe storicizzate: vale la tariffa con "dal" più recente <= data del lavoro
CREATE TABLE IF NOT EXISTS tariffe_operai (
  id INTEGER PRIMARY KEY,
  operaio_id INTEGER NOT NULL REFERENCES operai(id) ON DELETE CASCADE,
  dal TEXT NOT NULL,
  tariffa REAL NOT NULL,
  UNIQUE (operaio_id, dal)
);
CREATE TABLE IF NOT EXISTS mezzi (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  attivo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tariffe_mezzi (
  id INTEGER PRIMARY KEY,
  mezzo_id INTEGER NOT NULL REFERENCES mezzi(id) ON DELETE CASCADE,
  dal TEXT NOT NULL,
  costo_km REAL NOT NULL,
  UNIQUE (mezzo_id, dal)
);
CREATE TABLE IF NOT EXISTS cantieri (
  id INTEGER PRIMARY KEY,
  codice TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  cliente TEXT,
  indirizzo TEXT,
  data_inizio TEXT,
  data_fine TEXT,
  stato TEXT NOT NULL DEFAULT 'In corso' CHECK (stato IN ('Da iniziare','In corso','Concluso')),
  offerta REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assegnazioni (
  cantiere_id INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  utente_id INTEGER NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  PRIMARY KEY (cantiere_id, utente_id)
);
CREATE TABLE IF NOT EXISTS sal (
  id INTEGER PRIMARY KEY,
  cantiere_id INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  numero INTEGER,
  importo REAL NOT NULL,
  fattura TEXT,
  note TEXT
);
-- Le registrazioni dal telefono usano id generati sul dispositivo (UUID):
-- così un invio ripetuto dopo un periodo offline non crea doppioni.
CREATE TABLE IF NOT EXISTS ore (
  id TEXT PRIMARY KEY,
  cantiere_id INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  operaio_id INTEGER NOT NULL REFERENCES operai(id),
  data TEXT NOT NULL,
  ore REAL NOT NULL CHECK (ore > 0 AND ore <= 24),
  note TEXT,
  creato_da INTEGER REFERENCES utenti(id),
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS km (
  id TEXT PRIMARY KEY,
  cantiere_id INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  mezzo_id INTEGER NOT NULL REFERENCES mezzi(id),
  data TEXT NOT NULL,
  km REAL NOT NULL CHECK (km > 0),
  note TEXT,
  creato_da INTEGER REFERENCES utenti(id),
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS limiti_spesa (
  tipo TEXT PRIMARY KEY,
  limite REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS spese (
  id TEXT PRIMARY KEY,
  cantiere_id INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Pranzo','Cena','Acquisto cibo','Pernottamento','Altro')),
  importo REAL NOT NULL CHECK (importo > 0),
  scontrino TEXT,
  note TEXT,
  -- auto = entro il limite, conta subito
  stato TEXT NOT NULL CHECK (stato IN ('auto','da_approvare','approvata','rifiutata')),
  creato_da INTEGER REFERENCES utenti(id),
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Preventivo materiali del cantiere
CREATE TABLE IF NOT EXISTS materiali (
  id INTEGER PRIMARY KEY,
  cantiere_id INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  materiale TEXT NOT NULL,
  um TEXT,
  prezzo REAL,
  q_prevista REAL NOT NULL DEFAULT 0
);
-- Mancanti aggiunti e avanzi resi, registrati dal cantiere
CREATE TABLE IF NOT EXISTS movimenti_materiale (
  id TEXT PRIMARY KEY,
  materiale_id INTEGER NOT NULL REFERENCES materiali(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('aggiunta','avanzo')),
  quantita REAL NOT NULL CHECK (quantita > 0),
  data TEXT NOT NULL,
  note TEXT,
  creato_da INTEGER REFERENCES utenti(id),
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS diario (
  id TEXT PRIMARY KEY,
  cantiere_id INTEGER NOT NULL REFERENCES cantieri(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('Problema','Ritardo','Richiesta cliente','Sicurezza','Varie')),
  testo TEXT NOT NULL,
  giorni_ritardo INTEGER NOT NULL DEFAULT 0,
  azione TEXT,
  creato_da INTEGER REFERENCES utenti(id),
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Foto allegate a scontrini, movimenti materiale o note del diario
CREATE TABLE IF NOT EXISTS foto (
  id TEXT PRIMARY KEY,
  entita TEXT NOT NULL CHECK (entita IN ('spesa','movimento','diario')),
  entita_id TEXT NOT NULL,
  file TEXT NOT NULL,
  creato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ore_c ON ore(cantiere_id);
CREATE INDEX IF NOT EXISTS ix_km_c ON km(cantiere_id);
CREATE INDEX IF NOT EXISTS ix_spese_c ON spese(cantiere_id);
CREATE INDEX IF NOT EXISTS ix_mat_c ON materiali(cantiere_id);
CREATE INDEX IF NOT EXISTS ix_diario_c ON diario(cantiere_id);
CREATE INDEX IF NOT EXISTS ix_foto_e ON foto(entita, entita_id);
`;

// Limiti iniziali confermati da Paolo il 13/11/2026 (modificabili dall'ufficio)
const LIMITI_INIZIALI = { 'Pranzo': 25, 'Cena': 25, 'Acquisto cibo': 30, 'Pernottamento': 90, 'Altro': 0 };

export function apriDb(dataDir) {
  let file = ':memory:';
  if (dataDir) {
    fs.mkdirSync(path.join(dataDir, 'foto'), { recursive: true });
    file = path.join(dataDir, 'scheda-cantiere.sqlite');
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO limiti_spesa (tipo, limite) VALUES (?, ?)');
  for (const [t, l] of Object.entries(LIMITI_INIZIALI)) ins.run(t, l);
  return db;
}

// Esegue fn dentro una transazione
export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
