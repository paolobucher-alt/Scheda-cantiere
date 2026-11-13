import express from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tx } from './db.js';
import { bilancioCantiere, materialiCantiere, SQL_TARIFFA_ORE, SQL_COSTO_KM, SPESE_VALIDE } from './calcoli.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TIPI_SPESA = ['Pranzo', 'Cena', 'Acquisto cibo', 'Pernottamento', 'Altro'];
const TIPI_DIARIO = ['Problema', 'Ritardo', 'Richiesta cliente', 'Sicurezza', 'Varie'];
const STATI_CANTIERE = ['Da iniziare', 'In corso', 'Concluso'];
const GIORNI_MODIFICA = 7; // il caposquadra può cancellare i propri inserimenti entro 7 giorni
const SESSIONE_GIORNI = 60;

class Errore extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const err = (s, m) => new Errore(s, m);

const isData = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const num = (v, nome, { min = -Infinity, max = Infinity, opz = false } = {}) => {
  if ((v === undefined || v === null || v === '') && opz) return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw err(400, `Valore non valido: ${nome}`);
  return n;
};
const txt = (v, nome, { opz = false, max = 2000 } = {}) => {
  if (v === undefined || v === null || String(v).trim() === '') { if (opz) return null; throw err(400, `Campo obbligatorio: ${nome}`); }
  const s = String(v).trim();
  if (s.length > max) throw err(400, `Testo troppo lungo: ${nome}`);
  return s;
};
const data = (v, nome = 'data', opz = false) => {
  if ((v === undefined || v === null || v === '') && opz) return null;
  if (!isData(v)) throw err(400, `Data non valida: ${nome}`);
  return v;
};

export function creaApp(db, { dataDir, cookieSecure = false } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const fotoDir = dataDir ? path.join(dataDir, 'foto') : fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'sc-foto-'));
  const upload = multer({
    storage: multer.diskStorage({
      destination: fotoDir,
      filename: (req, file, cb) => cb(null, crypto.randomUUID() + (file.mimetype === 'image/png' ? '.png' : '.jpg')),
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 6 },
    fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
  });

  // ---------- sessioni ----------
  const leggiCookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]));
  const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

  app.use((req, res, next) => {
    const tok = leggiCookie(req).sc_sess;
    if (tok) {
      const u = db.prepare(`SELECT u.id, u.email, u.nome, u.ruolo FROM sessioni s JOIN utenti u ON u.id = s.utente_id
        WHERE s.token = ? AND s.scadenza > datetime('now') AND u.attivo = 1`).get(hash(tok));
      if (u) req.utente = { ...u };
    }
    next();
  });

  const tentativi = new Map();
  app.post('/api/login', (req, res) => {
    const chiave = (req.ip || '') + '|' + String(req.body?.email || '').toLowerCase();
    const t = tentativi.get(chiave) || { n: 0, da: Date.now() };
    if (Date.now() - t.da > 15 * 60 * 1000) { t.n = 0; t.da = Date.now(); }
    if (t.n >= 10) return res.status(429).json({ errore: 'Troppi tentativi, riprova tra qualche minuto' });
    const u = db.prepare('SELECT * FROM utenti WHERE email = ? AND attivo = 1').get(String(req.body?.email || '').trim());
    if (!u || !bcrypt.compareSync(String(req.body?.password || ''), u.password_hash)) {
      t.n++; tentativi.set(chiave, t);
      return res.status(401).json({ errore: 'Email o password non corretti' });
    }
    tentativi.delete(chiave);
    const tok = crypto.randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessioni (token, utente_id, scadenza) VALUES (?, ?, datetime('now', '+${SESSIONE_GIORNI} days'))`).run(hash(tok), u.id);
    db.prepare(`DELETE FROM sessioni WHERE scadenza <= datetime('now')`).run();
    res.setHeader('Set-Cookie', `sc_sess=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSIONE_GIORNI * 86400}${cookieSecure ? '; Secure' : ''}`);
    res.json({ id: u.id, nome: u.nome, email: u.email, ruolo: u.ruolo });
  });

  app.post('/api/logout', (req, res) => {
    const tok = leggiCookie(req).sc_sess;
    if (tok) db.prepare('DELETE FROM sessioni WHERE token = ?').run(hash(tok));
    res.setHeader('Set-Cookie', 'sc_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  app.use('/api', (req, res, next) => {
    if (!req.utente) return res.status(401).json({ errore: 'Accesso richiesto' });
    next();
  });
  const soloUfficio = (req, res, next) => req.utente.ruolo === 'ufficio' ? next() : res.status(403).json({ errore: 'Riservato all\'ufficio' });
  const h = (fn) => (req, res, next) => { try { const r = fn(req, res); if (r !== undefined) res.json(r); } catch (e) { next(e); } };

  const cantiereAccessibile = (req, cantiereId) => {
    const c = db.prepare('SELECT * FROM cantieri WHERE id = ?').get(cantiereId);
    if (!c) throw err(404, 'Cantiere non trovato');
    if (req.utente.ruolo === 'ufficio') return c;
    const a = db.prepare('SELECT 1 FROM assegnazioni WHERE cantiere_id = ? AND utente_id = ?').get(cantiereId, req.utente.id);
    if (!a) throw err(403, 'Non sei assegnato a questo cantiere');
    return c;
  };

  app.get('/api/me', h((req) => req.utente));

  // ---------- dati per il telefono (nessun costo per il caposquadra) ----------
  app.get('/api/dati-base', h((req) => {
    const uff = req.utente.ruolo === 'ufficio';
    const cantieri = uff
      ? db.prepare(`SELECT id, codice, nome, cliente, indirizzo, stato FROM cantieri WHERE stato != 'Concluso' ORDER BY codice`).all()
      : db.prepare(`SELECT c.id, c.codice, c.nome, c.cliente, c.indirizzo, c.stato FROM cantieri c JOIN assegnazioni a ON a.cantiere_id = c.id
          WHERE a.utente_id = ? AND c.stato != 'Concluso' ORDER BY c.codice`).all(req.utente.id);
    const ids = cantieri.map((c) => c.id);
    const materiali = ids.length ? db.prepare(`SELECT id, cantiere_id, materiale, um, q_prevista FROM materiali
      WHERE cantiere_id IN (${ids.map(() => '?').join(',')}) ORDER BY materiale`).all(...ids) : [];
    return {
      utente: req.utente,
      cantieri,
      operai: db.prepare('SELECT id, nome, ruolo FROM operai WHERE attivo = 1 ORDER BY nome').all(),
      mezzi: db.prepare('SELECT id, nome FROM mezzi WHERE attivo = 1 ORDER BY nome').all(),
      materiali,
      tipi_spesa: TIPI_SPESA,
      tipi_diario: TIPI_DIARIO,
    };
  }));

  const salvaFoto = (files, entita, entitaId) => {
    const ins = db.prepare('INSERT INTO foto (id, entita, entita_id, file) VALUES (?, ?, ?, ?)');
    for (const f of files || []) ins.run(crypto.randomUUID(), entita, entitaId, f.filename);
  };
  const scartaFoto = (files) => { for (const f of files || []) fs.rm(f.path, () => {}); };
  // Inserimento idempotente: se l'id esiste già (invio ripetuto) non fa nulla.
  const esiste = (tab, id) => !!db.prepare(`SELECT 1 FROM ${tab} WHERE id = ?`).get(id);

  app.post('/api/ore', h((req) => {
    const b = req.body;
    if (!isUuid(b.id)) throw err(400, 'id non valido');
    cantiereAccessibile(req, b.cantiere_id);
    if (esiste('ore', b.id)) return { ok: true, duplicato: true };
    if (!db.prepare('SELECT 1 FROM operai WHERE id = ?').get(b.operaio_id)) throw err(400, 'Operaio non valido');
    db.prepare('INSERT INTO ore (id, cantiere_id, operaio_id, data, ore, note, creato_da) VALUES (?,?,?,?,?,?,?)')
      .run(b.id, b.cantiere_id, b.operaio_id, data(b.data), num(b.ore, 'ore', { min: 0.25, max: 24 }), txt(b.note, 'note', { opz: true }), req.utente.id);
    return { ok: true };
  }));

  app.post('/api/km', h((req) => {
    const b = req.body;
    if (!isUuid(b.id)) throw err(400, 'id non valido');
    cantiereAccessibile(req, b.cantiere_id);
    if (esiste('km', b.id)) return { ok: true, duplicato: true };
    if (!db.prepare('SELECT 1 FROM mezzi WHERE id = ?').get(b.mezzo_id)) throw err(400, 'Mezzo non valido');
    db.prepare('INSERT INTO km (id, cantiere_id, mezzo_id, data, km, note, creato_da) VALUES (?,?,?,?,?,?,?)')
      .run(b.id, b.cantiere_id, b.mezzo_id, data(b.data), num(b.km, 'km', { min: 0.1, max: 5000 }), txt(b.note, 'note', { opz: true }), req.utente.id);
    return { ok: true };
  }));

  const conFoto = (fn) => [upload.array('foto', 6), (req, res, next) => {
    try { const r = fn(req, res); res.json(r); } catch (e) { scartaFoto(req.files); next(e); }
  }];

  app.post('/api/spese', ...conFoto((req) => {
    const b = req.body;
    if (!isUuid(b.id)) throw err(400, 'id non valido');
    const cid = Number(b.cantiere_id);
    cantiereAccessibile(req, cid);
    if (esiste('spese', b.id)) { scartaFoto(req.files); return { ok: true, duplicato: true }; }
    if (!TIPI_SPESA.includes(b.tipo)) throw err(400, 'Tipo di spesa non valido');
    const importo = num(b.importo, 'importo', { min: 0.01, max: 100000 });
    const lim = db.prepare('SELECT limite FROM limiti_spesa WHERE tipo = ?').get(b.tipo)?.limite ?? 0;
    const stato = importo <= lim ? 'auto' : 'da_approvare';
    tx(db, () => {
      db.prepare('INSERT INTO spese (id, cantiere_id, data, tipo, importo, scontrino, note, stato, creato_da) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(b.id, cid, data(b.data), b.tipo, importo, txt(b.scontrino, 'scontrino', { opz: true, max: 100 }), txt(b.note, 'note', { opz: true }), stato, req.utente.id);
      salvaFoto(req.files, 'spesa', b.id);
    });
    return { ok: true, stato };
  }));

  app.post('/api/movimenti', ...conFoto((req) => {
    const b = req.body;
    if (!isUuid(b.id)) throw err(400, 'id non valido');
    if (esiste('movimenti_materiale', b.id)) { scartaFoto(req.files); return { ok: true, duplicato: true }; }
    if (!['aggiunta', 'avanzo'].includes(b.tipo)) throw err(400, 'Tipo movimento non valido');
    const q = num(b.quantita, 'quantità', { min: 0.001, max: 1e7 });
    tx(db, () => {
      let mid = Number(b.materiale_id) || null;
      if (mid) {
        const m = db.prepare('SELECT cantiere_id FROM materiali WHERE id = ?').get(mid);
        if (!m) throw err(400, 'Materiale non valido');
        cantiereAccessibile(req, m.cantiere_id);
      } else {
        // Materiale non previsto nel preventivo: lo crea con quantità prevista 0, il prezzo lo mette l'ufficio
        if (b.tipo !== 'aggiunta') throw err(400, 'Un avanzo deve riferirsi a un materiale del preventivo');
        const cid = Number(b.cantiere_id);
        cantiereAccessibile(req, cid);
        mid = Number(db.prepare('INSERT INTO materiali (cantiere_id, materiale, um, prezzo, q_prevista) VALUES (?,?,?,NULL,0)')
          .run(cid, txt(b.nuovo_materiale, 'materiale', { max: 200 }), txt(b.um, 'unità di misura', { opz: true, max: 20 })).lastInsertRowid);
      }
      db.prepare('INSERT INTO movimenti_materiale (id, materiale_id, tipo, quantita, data, note, creato_da) VALUES (?,?,?,?,?,?,?)')
        .run(b.id, mid, b.tipo, q, data(b.data), txt(b.note, 'note', { opz: true }), req.utente.id);
      salvaFoto(req.files, 'movimento', b.id);
    });
    return { ok: true };
  }));

  app.post('/api/diario', ...conFoto((req) => {
    const b = req.body;
    if (!isUuid(b.id)) throw err(400, 'id non valido');
    const cid = Number(b.cantiere_id);
    cantiereAccessibile(req, cid);
    if (esiste('diario', b.id)) { scartaFoto(req.files); return { ok: true, duplicato: true }; }
    if (!TIPI_DIARIO.includes(b.tipo)) throw err(400, 'Tipo di nota non valido');
    tx(db, () => {
      db.prepare('INSERT INTO diario (id, cantiere_id, data, tipo, testo, giorni_ritardo, azione, creato_da) VALUES (?,?,?,?,?,?,?,?)')
        .run(b.id, cid, data(b.data), b.tipo, txt(b.testo, 'descrizione', { max: 5000 }),
          num(b.giorni_ritardo || 0, 'giorni di ritardo', { min: 0, max: 365 }), txt(b.azione, 'azione', { opz: true }), req.utente.id);
      salvaFoto(req.files, 'diario', b.id);
    });
    return { ok: true };
  }));

  const fotoDi = (entita, id) => db.prepare('SELECT id FROM foto WHERE entita = ? AND entita_id = ?').all(entita, id).map((f) => f.id);

  // Ultimi inserimenti del cantiere (vista telefono: quantità, niente costi)
  app.get('/api/cantieri/:id/attivita', h((req) => {
    const c = cantiereAccessibile(req, Number(req.params.id));
    const giorni = Math.min(Number(req.query.giorni) || 14, 365);
    const lim = `date('now', '-${giorni} days')`;
    const mio = (r) => ({ ...r, cancellabile: req.utente.ruolo === 'ufficio' || (r.creato_da === req.utente.id && r.eta_giorni <= GIORNI_MODIFICA) });
    const eta = `CAST(julianday('now') - julianday(x.creato_il) AS REAL) AS eta_giorni`;
    return {
      cantiere: { id: c.id, codice: c.codice, nome: c.nome, cliente: c.cliente, indirizzo: c.indirizzo, stato: c.stato },
      ore: db.prepare(`SELECT x.id, x.data, x.ore, x.note, x.creato_da, o.nome operaio, ${eta} FROM ore x JOIN operai o ON o.id = x.operaio_id
        WHERE x.cantiere_id = ? AND x.data >= ${lim} ORDER BY x.data DESC, o.nome`).all(c.id).map(mio),
      km: db.prepare(`SELECT x.id, x.data, x.km, x.note, x.creato_da, m.nome mezzo, ${eta} FROM km x JOIN mezzi m ON m.id = x.mezzo_id
        WHERE x.cantiere_id = ? AND x.data >= ${lim} ORDER BY x.data DESC`).all(c.id).map(mio),
      spese: db.prepare(`SELECT x.id, x.data, x.tipo, x.importo, x.stato, x.scontrino, x.creato_da, ${eta} FROM spese x
        WHERE x.cantiere_id = ? AND x.data >= ${lim} ORDER BY x.data DESC`).all(c.id).map(mio).map((s) => ({ ...s, foto: fotoDi('spesa', s.id) })),
      movimenti: db.prepare(`SELECT x.id, x.data, x.tipo, x.quantita, x.creato_da, m.materiale, m.um, ${eta} FROM movimenti_materiale x
        JOIN materiali m ON m.id = x.materiale_id WHERE m.cantiere_id = ? AND x.data >= ${lim} ORDER BY x.data DESC`).all(c.id).map(mio),
      diario: db.prepare(`SELECT x.id, x.data, x.tipo, x.testo, x.giorni_ritardo, x.azione, x.creato_da, u.nome autore, ${eta} FROM diario x
        LEFT JOIN utenti u ON u.id = x.creato_da WHERE x.cantiere_id = ? AND x.data >= ${lim} ORDER BY x.data DESC, x.creato_il DESC`).all(c.id)
        .map(mio).map((d) => ({ ...d, foto: fotoDi('diario', d.id) })),
    };
  }));

  // Cancellazione: caposquadra solo i propri entro 7 giorni; ufficio sempre
  const TAB = { ore: ['ore', 'cantiere_id'], km: ['km', 'cantiere_id'], spese: ['spese', 'cantiere_id'], diario: ['diario', 'cantiere_id'], movimenti: ['movimenti_materiale', null] };
  app.delete('/api/:tipo(ore|km|spese|diario|movimenti)/:id', h((req) => {
    const [tab] = TAB[req.params.tipo];
    const r = tab === 'movimenti_materiale'
      ? db.prepare(`SELECT x.*, m.cantiere_id, julianday('now') - julianday(x.creato_il) eta FROM movimenti_materiale x JOIN materiali m ON m.id = x.materiale_id WHERE x.id = ?`).get(req.params.id)
      : db.prepare(`SELECT *, julianday('now') - julianday(creato_il) eta FROM ${tab} WHERE id = ?`).get(req.params.id);
    if (!r) return { ok: true };
    cantiereAccessibile(req, r.cantiere_id);
    if (req.utente.ruolo !== 'ufficio' && (r.creato_da !== req.utente.id || r.eta > GIORNI_MODIFICA))
      throw err(403, `Puoi cancellare solo i tuoi inserimenti degli ultimi ${GIORNI_MODIFICA} giorni`);
    const ent = { spese: 'spesa', diario: 'diario', movimenti: 'movimento' }[req.params.tipo];
    tx(db, () => {
      if (ent) {
        for (const f of db.prepare('SELECT file FROM foto WHERE entita = ? AND entita_id = ?').all(ent, r.id)) fs.rm(path.join(fotoDir, f.file), () => {});
        db.prepare('DELETE FROM foto WHERE entita = ? AND entita_id = ?').run(ent, r.id);
      }
      db.prepare(`DELETE FROM ${tab} WHERE id = ?`).run(r.id);
    });
    return { ok: true };
  }));

  app.get('/api/foto/:id', (req, res, next) => {
    try {
      const f = db.prepare('SELECT * FROM foto WHERE id = ?').get(req.params.id);
      if (!f) throw err(404, 'Foto non trovata');
      const q = { spesa: 'SELECT cantiere_id FROM spese WHERE id = ?', diario: 'SELECT cantiere_id FROM diario WHERE id = ?',
        movimento: 'SELECT m.cantiere_id FROM movimenti_materiale x JOIN materiali m ON m.id = x.materiale_id WHERE x.id = ?' }[f.entita];
      const r = db.prepare(q).get(f.entita_id);
      if (!r) throw err(404, 'Foto non trovata');
      cantiereAccessibile(req, r.cantiere_id);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.sendFile(path.join(fotoDir, path.basename(f.file)));
    } catch (e) { next(e); }
  });

  // ================= UFFICIO =================
  const u = express.Router();
  u.use(soloUfficio);

  u.get('/riepilogo', h(() => db.prepare('SELECT * FROM cantieri ORDER BY codice').all().map((c) => ({ ...c, bilancio: bilancioCantiere(db, c) }))));

  u.get('/cantieri/:id/scheda', h((req) => {
    const c = db.prepare('SELECT * FROM cantieri WHERE id = ?').get(Number(req.params.id));
    if (!c) throw err(404, 'Cantiere non trovato');
    return {
      cantiere: c,
      bilancio: bilancioCantiere(db, c),
      materiali: materialiCantiere(db, c.id),
      sal: db.prepare('SELECT * FROM sal WHERE cantiere_id = ? ORDER BY data, numero').all(c.id),
      assegnati: db.prepare('SELECT u.id, u.nome FROM assegnazioni a JOIN utenti u ON u.id = a.utente_id WHERE a.cantiere_id = ?').all(c.id),
      diario: db.prepare(`SELECT d.*, u.nome autore FROM diario d LEFT JOIN utenti u ON u.id = d.creato_da WHERE d.cantiere_id = ? ORDER BY d.data DESC, d.creato_il DESC`)
        .all(c.id).map((d) => ({ ...d, foto: fotoDi('diario', d.id) })),
      ore_per_operaio: db.prepare(`SELECT op.nome, SUM(o.ore) ore, SUM(o.ore * ${SQL_TARIFFA_ORE}) costo FROM ore o JOIN operai op ON op.id = o.operaio_id
        WHERE o.cantiere_id = ? GROUP BY op.id ORDER BY op.nome`).all(c.id),
      km_per_mezzo: db.prepare(`SELECT m.nome, SUM(k.km) km, SUM(k.km * ${SQL_COSTO_KM}) costo FROM km k JOIN mezzi m ON m.id = k.mezzo_id
        WHERE k.cantiere_id = ? GROUP BY m.id ORDER BY m.nome`).all(c.id),
      spese: db.prepare(`SELECT s.*, u.nome autore FROM spese s LEFT JOIN utenti u ON u.id = s.creato_da WHERE s.cantiere_id = ? ORDER BY s.data DESC`)
        .all(c.id).map((s) => ({ ...s, foto: fotoDi('spesa', s.id) })),
    };
  }));

  const campiCantiere = (b) => ({
    codice: txt(b.codice, 'codice', { max: 30 }), nome: txt(b.nome, 'nome', { max: 200 }),
    cliente: txt(b.cliente, 'cliente', { opz: true, max: 200 }), indirizzo: txt(b.indirizzo, 'indirizzo', { opz: true, max: 300 }),
    data_inizio: data(b.data_inizio, 'data inizio', true), data_fine: data(b.data_fine, 'data fine', true),
    stato: STATI_CANTIERE.includes(b.stato) ? b.stato : (() => { throw err(400, 'Stato non valido'); })(),
    offerta: num(b.offerta || 0, 'offerta', { min: 0 }),
  });
  const unico = (fn) => { try { return fn(); } catch (e) { if (/UNIQUE/.test(e.message)) throw err(409, 'Esiste già un elemento con questo codice o email'); throw e; } };
  u.post('/cantieri', h((req) => unico(() => {
    const c = campiCantiere(req.body);
    const id = db.prepare('INSERT INTO cantieri (codice, nome, cliente, indirizzo, data_inizio, data_fine, stato, offerta) VALUES (?,?,?,?,?,?,?,?)')
      .run(c.codice, c.nome, c.cliente, c.indirizzo, c.data_inizio, c.data_fine, c.stato, c.offerta).lastInsertRowid;
    return { id: Number(id) };
  })));
  u.put('/cantieri/:id', h((req) => unico(() => {
    const c = campiCantiere(req.body);
    db.prepare('UPDATE cantieri SET codice=?, nome=?, cliente=?, indirizzo=?, data_inizio=?, data_fine=?, stato=?, offerta=? WHERE id=?')
      .run(c.codice, c.nome, c.cliente, c.indirizzo, c.data_inizio, c.data_fine, c.stato, c.offerta, Number(req.params.id));
    return { ok: true };
  })));
  u.put('/cantieri/:id/assegnazioni', h((req) => {
    const id = Number(req.params.id);
    tx(db, () => {
      db.prepare('DELETE FROM assegnazioni WHERE cantiere_id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO assegnazioni (cantiere_id, utente_id) VALUES (?, ?)');
      for (const uid of req.body.utenti || []) ins.run(id, Number(uid));
    });
    return { ok: true };
  }));

  // Preventivo materiali
  const campiMat = (b) => ({ materiale: txt(b.materiale, 'materiale', { max: 200 }), um: txt(b.um, 'U.M.', { opz: true, max: 20 }),
    prezzo: num(b.prezzo, 'prezzo', { min: 0, opz: true }), q_prevista: num(b.q_prevista || 0, 'quantità prevista', { min: 0 }) });
  u.post('/cantieri/:id/materiali', h((req) => {
    const m = campiMat(req.body);
    const id = db.prepare('INSERT INTO materiali (cantiere_id, materiale, um, prezzo, q_prevista) VALUES (?,?,?,?,?)')
      .run(Number(req.params.id), m.materiale, m.um, m.prezzo, m.q_prevista).lastInsertRowid;
    return { id: Number(id) };
  }));
  u.put('/materiali/:id', h((req) => {
    const m = campiMat(req.body);
    db.prepare('UPDATE materiali SET materiale=?, um=?, prezzo=?, q_prevista=? WHERE id=?').run(m.materiale, m.um, m.prezzo, m.q_prevista, Number(req.params.id));
    return { ok: true };
  }));
  u.delete('/materiali/:id', h((req) => { db.prepare('DELETE FROM materiali WHERE id = ?').run(Number(req.params.id)); return { ok: true }; }));

  // SAL
  u.post('/cantieri/:id/sal', h((req) => {
    const b = req.body;
    const id = db.prepare('INSERT INTO sal (cantiere_id, data, numero, importo, fattura, note) VALUES (?,?,?,?,?,?)')
      .run(Number(req.params.id), data(b.data), num(b.numero, 'numero SAL', { min: 0, opz: true }), num(b.importo, 'importo', { min: 0 }),
        txt(b.fattura, 'fattura', { opz: true, max: 50 }), txt(b.note, 'note', { opz: true })).lastInsertRowid;
    return { id: Number(id) };
  }));
  u.delete('/sal/:id', h((req) => { db.prepare('DELETE FROM sal WHERE id = ?').run(Number(req.params.id)); return { ok: true }; }));

  // Spese da approvare
  u.get('/spese', h((req) => {
    const stato = req.query.stato || 'da_approvare';
    return db.prepare(`SELECT s.*, c.codice, c.nome cantiere, u.nome autore FROM spese s JOIN cantieri c ON c.id = s.cantiere_id
      LEFT JOIN utenti u ON u.id = s.creato_da WHERE s.stato = ? ORDER BY s.data DESC LIMIT 500`).all(stato).map((s) => ({ ...s, foto: fotoDi('spesa', s.id) }));
  }));
  u.post('/spese/:id/stato', h((req) => {
    if (!['approvata', 'rifiutata', 'da_approvare'].includes(req.body.stato)) throw err(400, 'Stato non valido');
    db.prepare('UPDATE spese SET stato = ? WHERE id = ?').run(req.body.stato, req.params.id);
    return { ok: true };
  }));

  // Anagrafiche con tariffe storicizzate
  const anagrafica = (tab, tabT, col, fk, campoExtra) => {
    u.get(`/${tab}`, h(() => db.prepare(`SELECT x.*,
        (SELECT ${col} FROM ${tabT} t WHERE t.${fk} = x.id AND t.dal <= date('now') ORDER BY t.dal DESC LIMIT 1) AS ${col}_attuale
        FROM ${tab} x ORDER BY x.attivo DESC, x.nome`).all()
      .map((x) => ({ ...x, storico: db.prepare(`SELECT dal, ${col} FROM ${tabT} WHERE ${fk} = ? ORDER BY dal DESC`).all(x.id) }))));
    u.post(`/${tab}`, h((req) => {
      const b = req.body;
      return tx(db, () => {
        const id = Number(campoExtra
          ? db.prepare(`INSERT INTO ${tab} (nome, ${campoExtra}) VALUES (?, ?)`).run(txt(b.nome, 'nome', { max: 100 }), txt(b[campoExtra], campoExtra, { opz: true, max: 100 })).lastInsertRowid
          : db.prepare(`INSERT INTO ${tab} (nome) VALUES (?)`).run(txt(b.nome, 'nome', { max: 100 })).lastInsertRowid);
        db.prepare(`INSERT INTO ${tabT} (${fk}, dal, ${col}) VALUES (?, ?, ?)`).run(id, data(b.dal || '2000-01-01', 'valida dal'), num(b[col], col, { min: 0 }));
        return { id };
      });
    }));
    u.put(`/${tab}/:id`, h((req) => {
      const b = req.body;
      if (campoExtra) db.prepare(`UPDATE ${tab} SET nome=?, ${campoExtra}=?, attivo=? WHERE id=?`).run(txt(b.nome, 'nome'), txt(b[campoExtra], campoExtra, { opz: true }), b.attivo ? 1 : 0, Number(req.params.id));
      else db.prepare(`UPDATE ${tab} SET nome=?, attivo=? WHERE id=?`).run(txt(b.nome, 'nome'), b.attivo ? 1 : 0, Number(req.params.id));
      return { ok: true };
    }));
    // Nuova tariffa valida da una data: le registrazioni precedenti mantengono quella vecchia
    u.post(`/${tab}/:id/tariffe`, h((req) => {
      db.prepare(`INSERT INTO ${tabT} (${fk}, dal, ${col}) VALUES (?, ?, ?) ON CONFLICT(${fk}, dal) DO UPDATE SET ${col} = excluded.${col}`)
        .run(Number(req.params.id), data(req.body.dal, 'valida dal'), num(req.body[col], col, { min: 0 }));
      return { ok: true };
    }));
  };
  anagrafica('operai', 'tariffe_operai', 'tariffa', 'operaio_id', 'ruolo');
  anagrafica('mezzi', 'tariffe_mezzi', 'costo_km', 'mezzo_id', null);

  // Utenti
  u.get('/utenti', h(() => db.prepare('SELECT id, email, nome, ruolo, attivo FROM utenti ORDER BY attivo DESC, nome').all()));
  u.post('/utenti', h((req) => unico(() => {
    const b = req.body;
    if (!['ufficio', 'caposquadra'].includes(b.ruolo)) throw err(400, 'Ruolo non valido');
    const pw = txt(b.password, 'password', { max: 200 });
    if (pw.length < 8) throw err(400, 'La password deve avere almeno 8 caratteri');
    const id = db.prepare('INSERT INTO utenti (email, nome, password_hash, ruolo) VALUES (?,?,?,?)')
      .run(txt(b.email, 'email', { max: 200 }), txt(b.nome, 'nome', { max: 100 }), bcrypt.hashSync(pw, 10), b.ruolo).lastInsertRowid;
    return { id: Number(id) };
  })));
  u.put('/utenti/:id', h((req) => unico(() => {
    const b = req.body; const id = Number(req.params.id);
    if (!['ufficio', 'caposquadra'].includes(b.ruolo)) throw err(400, 'Ruolo non valido');
    if (id === req.utente.id && (!b.attivo || b.ruolo !== 'ufficio')) throw err(400, 'Non puoi disattivare o declassare te stesso');
    tx(db, () => {
      db.prepare('UPDATE utenti SET email=?, nome=?, ruolo=?, attivo=? WHERE id=?').run(txt(b.email, 'email'), txt(b.nome, 'nome'), b.ruolo, b.attivo ? 1 : 0, id);
      if (b.password) {
        if (String(b.password).length < 8) throw err(400, 'La password deve avere almeno 8 caratteri');
        db.prepare('UPDATE utenti SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(b.password), 10), id);
        db.prepare('DELETE FROM sessioni WHERE utente_id = ?').run(id);
      }
      if (!b.attivo) db.prepare('DELETE FROM sessioni WHERE utente_id = ?').run(id);
    });
    return { ok: true };
  })));

  // Limiti di spesa
  u.get('/limiti', h(() => db.prepare('SELECT * FROM limiti_spesa').all()));
  u.put('/limiti', h((req) => {
    const up = db.prepare('UPDATE limiti_spesa SET limite = ? WHERE tipo = ?');
    tx(db, () => { for (const [t, l] of Object.entries(req.body || {})) if (TIPI_SPESA.includes(t)) up.run(num(l, t, { min: 0 }), t); });
    return { ok: true };
  }));

  // Export CSV (separatore ; e virgola decimale, si apre direttamente in Excel italiano)
  u.get('/export/:tipo', (req, res, next) => {
    try {
      const { dal = '0000-01-01', al = '9999-12-31' } = req.query;
      const cid = req.query.cantiere ? Number(req.query.cantiere) : null;
      const fc = (col) => cid ? ` AND ${col} = ${cid}` : '';
      const Q = {
        ore: [`SELECT o.data Data, c.codice Cantiere, op.nome Operaio, o.ore Ore, ${SQL_TARIFFA_ORE} "Tariffa €/h", o.ore * ${SQL_TARIFFA_ORE} "Costo €", o.note Note
          FROM ore o JOIN cantieri c ON c.id = o.cantiere_id JOIN operai op ON op.id = o.operaio_id WHERE o.data BETWEEN ? AND ?${fc('o.cantiere_id')} ORDER BY o.data`, true],
        km: [`SELECT k.data Data, c.codice Cantiere, m.nome Mezzo, k.km Km, ${SQL_COSTO_KM} "Costo €/km", k.km * ${SQL_COSTO_KM} "Costo €", k.note Note
          FROM km k JOIN cantieri c ON c.id = k.cantiere_id JOIN mezzi m ON m.id = k.mezzo_id WHERE k.data BETWEEN ? AND ?${fc('k.cantiere_id')} ORDER BY k.data`, true],
        spese: [`SELECT s.data Data, c.codice Cantiere, s.tipo Tipo, s.importo "Importo €", s.scontrino "N. scontrino",
          CASE s.stato WHEN 'auto' THEN 'Entro limite' WHEN 'approvata' THEN 'Approvata' WHEN 'rifiutata' THEN 'Rifiutata' ELSE 'Da approvare' END Stato, u.nome Inserita_da, s.note Note
          FROM spese s JOIN cantieri c ON c.id = s.cantiere_id LEFT JOIN utenti u ON u.id = s.creato_da WHERE s.data BETWEEN ? AND ?${fc('s.cantiere_id')} ORDER BY s.data`, true],
        sal: [`SELECT s.data Data, c.codice Cantiere, s.numero "N. SAL", s.importo "Importo €", s.fattura Fattura, s.note Note
          FROM sal s JOIN cantieri c ON c.id = s.cantiere_id WHERE s.data BETWEEN ? AND ?${fc('s.cantiere_id')} ORDER BY s.data`, true],
      };
      let righe;
      const t = req.params.tipo.replace(/\.csv$/, '');
      if (Q[t]) righe = db.prepare(Q[t][0]).all(dal, al);
      else if (t === 'materiali') {
        const cs = db.prepare(`SELECT id, codice FROM cantieri ${cid ? 'WHERE id = ?' : ''} ORDER BY codice`).all(...(cid ? [cid] : []));
        righe = cs.flatMap((c) => materialiCantiere(db, c.id).map((m) => ({ Cantiere: c.codice, Materiale: m.materiale, 'U.M.': m.um, 'Prezzo €': m.prezzo,
          'Q.tà prevista': m.q_prevista, 'Q.tà aggiunta': m.q_aggiunta, 'Q.tà avanzata': m.q_avanzata, 'Q.tà usata': m.q_usata,
          'Costo previsto €': m.costo_previsto, 'Costo reale €': m.costo_reale, 'Scostamento €': m.scostamento })));
      } else if (t === 'riepilogo') {
        const cs = db.prepare(`SELECT * FROM cantieri ${cid ? 'WHERE id = ?' : ''} ORDER BY codice`).all(...(cid ? [cid] : []));
        righe = cs.map((c) => { const b = bilancioCantiere(db, c); return { Codice: c.codice, Cantiere: c.nome, Cliente: c.cliente, Stato: c.stato,
          'Offerta €': b.ricavi.offerta, 'SAL fatturati €': b.ricavi.sal_fatturati, 'Da fatturare €': b.ricavi.da_fatturare,
          'Manodopera €': b.costi.manodopera, 'Trasporti €': b.costi.trasporti, 'Trasferte €': b.costi.trasferte, 'Materiali €': b.costi.materiali,
          'Costo totale €': b.costi.totale, 'Margine €': b.margine, 'Margine %': b.margine_pct === null ? '' : Math.round(b.margine_pct * 1000) / 10,
          'Scostamento materiali €': b.materiali.scostamento, 'Giorni ritardo': b.diario.giorni_ritardo }; });
      } else throw err(404, 'Export non disponibile');
      const cella = (v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'number') return String(Math.round(v * 1000) / 1000).replace('.', ',');
        const s = String(v);
        return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const cols = righe.length ? Object.keys(righe[0]) : ['Nessun dato'];
      const csv = '﻿' + [cols.join(';'), ...righe.map((r) => cols.map((c) => cella(r[c])).join(';'))].join('\r\n') + '\r\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${t}_${dal.startsWith('0000') ? 'tutto' : dal + '_' + al}.csv"`);
      res.send(csv);
    } catch (e) { next(e); }
  });

  app.use('/api', u);

  app.use('/api', (req, res) => res.status(404).json({ errore: 'Risorsa non trovata' }));
  app.use(express.static(PUBLIC, { index: 'index.html', setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get('*', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((e, req, res, next) => {
    if (e instanceof multer.MulterError) return res.status(400).json({ errore: 'Foto non valida o troppo grande' });
    if (e.status) return res.status(e.status).json({ errore: e.message });
    if (/FOREIGN KEY/.test(e.message)) return res.status(400).json({ errore: 'Elemento collegato non valido o ancora in uso' });
    console.error(e);
    res.status(500).json({ errore: 'Errore interno' });
  });
  return app;
}
