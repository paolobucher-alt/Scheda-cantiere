// Calcoli del bilancio: gli stessi del foglio Excel Scheda_cantiere_v2.xlsx.
// Differenza voluta: tariffa oraria e costo al km sono quelli in vigore il giorno del lavoro.

const TARIFFA_ORE = `COALESCE((SELECT t.tariffa FROM tariffe_operai t WHERE t.operaio_id = o.operaio_id AND t.dal <= o.data ORDER BY t.dal DESC LIMIT 1), 0)`;
const COSTO_KM = `COALESCE((SELECT t.costo_km FROM tariffe_mezzi t WHERE t.mezzo_id = k.mezzo_id AND t.dal <= k.data ORDER BY t.dal DESC LIMIT 1), 0)`;
export const SQL_TARIFFA_ORE = TARIFFA_ORE;
export const SQL_COSTO_KM = COSTO_KM;

// Spese che contano nel bilancio: entro limite oppure approvate
export const SPESE_VALIDE = `stato IN ('auto','approvata')`;

const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;

export function materialiCantiere(db, cantiereId) {
  return db.prepare(`
    SELECT m.*,
      COALESCE((SELECT SUM(quantita) FROM movimenti_materiale WHERE materiale_id = m.id AND tipo = 'aggiunta'), 0) AS q_aggiunta,
      COALESCE((SELECT SUM(quantita) FROM movimenti_materiale WHERE materiale_id = m.id AND tipo = 'avanzo'), 0) AS q_avanzata
    FROM materiali m WHERE m.cantiere_id = ? ORDER BY m.materiale`).all(cantiereId).map((m) => {
    const prezzo = m.prezzo || 0;
    const q_usata = m.q_prevista + m.q_aggiunta - m.q_avanzata;
    return {
      ...m, q_usata,
      costo_previsto: r2(prezzo * m.q_prevista),
      costo_aggiunte: r2(prezzo * m.q_aggiunta),
      valore_avanzi: r2(prezzo * m.q_avanzata),
      costo_reale: r2(prezzo * q_usata),
      scostamento: r2(prezzo * (m.q_aggiunta - m.q_avanzata)),
    };
  });
}

export function bilancioCantiere(db, c) {
  const id = c.id;
  const one = (sql) => db.prepare(sql).get(id);
  const sal = one(`SELECT COALESCE(SUM(importo),0) v FROM sal WHERE cantiere_id = ?`).v;
  const ore = one(`SELECT COALESCE(SUM(o.ore),0) h, COALESCE(SUM(o.ore * ${TARIFFA_ORE}),0) v FROM ore o WHERE o.cantiere_id = ?`);
  const km = one(`SELECT COALESCE(SUM(k.km),0) n, COALESCE(SUM(k.km * ${COSTO_KM}),0) v FROM km k WHERE k.cantiere_id = ?`);
  const spese = db.prepare(`SELECT tipo, SUM(importo) v FROM spese WHERE cantiere_id = ? AND ${SPESE_VALIDE} GROUP BY tipo`).all(id);
  const daApprovare = one(`SELECT COUNT(*) n, COALESCE(SUM(importo),0) v FROM spese WHERE cantiere_id = ? AND stato = 'da_approvare'`);
  const diario = one(`SELECT COUNT(*) n, COALESCE(SUM(giorni_ritardo),0) g FROM diario WHERE cantiere_id = ?`);
  const per = Object.fromEntries(spese.map((s) => [s.tipo, s.v]));
  const pasti = (per['Pranzo'] || 0) + (per['Cena'] || 0) + (per['Acquisto cibo'] || 0);
  const pernott = per['Pernottamento'] || 0;
  const altro = per['Altro'] || 0;
  const mat = materialiCantiere(db, id);
  const sum = (k) => r2(mat.reduce((a, m) => a + m[k], 0));
  const costi = {
    manodopera: r2(ore.v), trasporti: r2(km.v),
    trasferte_pasti: r2(pasti), trasferte_pernottamenti: r2(pernott), trasferte_altro: r2(altro),
    trasferte: r2(pasti + pernott + altro),
    materiali: sum('costo_reale'),
  };
  costi.totale = r2(costi.manodopera + costi.trasporti + costi.trasferte + costi.materiali);
  const offerta = c.offerta || 0;
  const margine = r2(offerta - costi.totale);
  return {
    ricavi: { offerta, sal_fatturati: r2(sal), da_fatturare: r2(offerta - sal) },
    costi,
    margine, margine_pct: offerta ? margine / offerta : null,
    materiali: {
      previsto: sum('costo_previsto'), aggiunte: sum('costo_aggiunte'),
      avanzi: sum('valore_avanzi'), reale: sum('costo_reale'), scostamento: sum('scostamento'),
    },
    quantita: { ore: ore.h, km: km.n },
    spese_da_approvare: { numero: daApprovare.n, importo: r2(daApprovare.v) },
    diario: { note: diario.n, giorni_ritardo: diario.g },
  };
}
