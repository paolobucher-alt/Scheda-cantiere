// Dati di esempio: gli stessi del foglio Excel Scheda_cantiere_v2.xlsx, così i totali si possono confrontare.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { tx } from './db.js';

export function caricaDemo(db, { passwordUfficio = 'ufficio123', passwordCapo = 'cantiere123' } = {}) {
  return tx(db, () => {
    const ins = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
    const uff = ins(`INSERT INTO utenti (email, nome, password_hash, ruolo) VALUES (?,?,?,'ufficio')`, 'ufficio@demo.it', 'Ufficio Demo', bcrypt.hashSync(passwordUfficio, 8));
    const capo = ins(`INSERT INTO utenti (email, nome, password_hash, ruolo) VALUES (?,?,?,'caposquadra')`, 'rossi@demo.it', 'Rossi Mario', bcrypt.hashSync(passwordCapo, 8));
    const capo2 = ins(`INSERT INTO utenti (email, nome, password_hash, ruolo) VALUES (?,?,?,'caposquadra')`, 'bianchi@demo.it', 'Bianchi Luca', bcrypt.hashSync(passwordCapo, 8));
    const op = {};
    for (const [n, r, t] of [['Rossi Mario', 'Caposquadra', 32], ['Bianchi Luca', 'Operaio specializzato', 28], ['Verdi Andrea', 'Operaio', 24]]) {
      op[n] = ins('INSERT INTO operai (nome, ruolo) VALUES (?,?)', n, r);
      ins('INSERT INTO tariffe_operai (operaio_id, dal, tariffa) VALUES (?,?,?)', op[n], '2000-01-01', t);
    }
    const mz = {};
    for (const [n, c] of [['Furgone AB123CD', 0.45], ['Auto aziendale EF456GH', 0.35]]) {
      mz[n] = ins('INSERT INTO mezzi (nome) VALUES (?)', n);
      ins('INSERT INTO tariffe_mezzi (mezzo_id, dal, costo_km) VALUES (?,?,?)', mz[n], '2000-01-01', c);
    }
    const c1 = ins(`INSERT INTO cantieri (codice, nome, cliente, indirizzo, data_inizio, stato, offerta) VALUES ('C001','Ristrutturazione Villa Neri','Neri Giovanni','Via Roma 10, Milano','2026-10-05','In corso',48000)`);
    const c2 = ins(`INSERT INTO cantieri (codice, nome, cliente, indirizzo, data_inizio, data_fine, stato, offerta) VALUES ('C002','Capannone Alfa','Alfa S.r.l.','Zona Industriale, Bergamo','2026-09-01','2026-11-06','In corso',26500)`);
    ins('INSERT INTO assegnazioni VALUES (?,?)', c1, capo);
    ins('INSERT INTO assegnazioni VALUES (?,?)', c2, capo2);
    for (const [c, d, n, i, f, nt] of [[c1, '2026-10-31', 1, 15000, '2026/101', null], [c2, '2026-09-30', 1, 12000, '2026/088', null], [c2, '2026-11-06', 2, 14500, '2026/105', 'Saldo']])
      ins('INSERT INTO sal (cantiere_id, data, numero, importo, fattura, note) VALUES (?,?,?,?,?,?)', c, d, n, i, f, nt);
    const id = () => crypto.randomUUID();
    for (const [c, d, o, h, by] of [[c1, '2026-11-02', 'Rossi Mario', 8, capo], [c1, '2026-11-02', 'Verdi Andrea', 8, capo], [c1, '2026-11-03', 'Rossi Mario', 7.5, capo],
      [c2, '2026-10-15', 'Bianchi Luca', 9, capo2], [c2, '2026-10-15', 'Verdi Andrea', 9, capo2]])
      db.prepare('INSERT INTO ore (id, cantiere_id, operaio_id, data, ore, creato_da) VALUES (?,?,?,?,?,?)').run(id(), c, op[o], d, h, by);
    for (const [c, d, m, k, by] of [[c1, '2026-11-02', 'Furgone AB123CD', 64, capo], [c1, '2026-11-03', 'Furgone AB123CD', 64, capo], [c2, '2026-10-15', 'Auto aziendale EF456GH', 120, capo2]])
      db.prepare('INSERT INTO km (id, cantiere_id, mezzo_id, data, km, creato_da) VALUES (?,?,?,?,?,?)').run(id(), c, mz[m], d, k, by);
    for (const [c, d, t, i, s, by] of [[c2, '2026-10-15', 'Pranzo', 14.5, '0231', capo2], [c2, '2026-10-15', 'Cena', 22, '0577', capo2],
      [c2, '2026-10-15', 'Pernottamento', 65, 'F-882', capo2], [c1, '2026-11-02', 'Acquisto cibo', 18.3, '1120', capo]])
      db.prepare(`INSERT INTO spese (id, cantiere_id, data, tipo, importo, scontrino, stato, creato_da) VALUES (?,?,?,?,?,?,'auto',?)`).run(id(), c, d, t, i, s, by);
    for (const [c, m, um, p, qp, qa, qv, by] of [[c1, 'Cemento 25 kg', 'sacco', 6.8, 120, 15, 0, capo], [c1, 'Piastrelle gres 60x60', 'm²', 28, 85, 0, 6, capo],
      [c1, 'Tubo multistrato 20 mm', 'm', 3.2, 150, 30, 0, capo], [c2, 'Pannello sandwich', 'm²', 42, 300, 0, 12, capo2], [c2, 'Viti autoforanti (conf. 100)', 'conf.', 9.5, 40, 6, 2, capo2]]) {
      const mid = ins('INSERT INTO materiali (cantiere_id, materiale, um, prezzo, q_prevista) VALUES (?,?,?,?,?)', c, m, um, p, qp);
      if (qa) db.prepare(`INSERT INTO movimenti_materiale (id, materiale_id, tipo, quantita, data, creato_da) VALUES (?,?,'aggiunta',?,'2026-11-03',?)`).run(id(), mid, qa, by);
      if (qv) db.prepare(`INSERT INTO movimenti_materiale (id, materiale_id, tipo, quantita, data, creato_da) VALUES (?,?,'avanzo',?,'2026-11-05',?)`).run(id(), mid, qv, by);
    }
    db.prepare(`INSERT INTO diario (id, cantiere_id, data, tipo, testo, giorni_ritardo, azione, creato_da) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id(), c1, '2026-11-03', 'Ritardo', 'Consegna piastrelle slittata di 2 giorni dal fornitore', 2, 'Anticipati i lavori di impianto idraulico', capo);
    db.prepare(`INSERT INTO diario (id, cantiere_id, data, tipo, testo, giorni_ritardo, azione, creato_da) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id(), c2, '2026-10-14', 'Problema', 'Pioggia forte, montaggio pannelli sospeso nel pomeriggio', 0, null, capo2);
    return { uff, capo, capo2, c1, c2, op, mz };
  });
}
