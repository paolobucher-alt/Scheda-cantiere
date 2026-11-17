// Archivio di un cantiere: scheda in PDF/A-2b (conservazione a lungo termine)
// e cartella Excel con tutti i dati di dettaglio.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { bilancioCantiere, materialiCantiere, SQL_TARIFFA_ORE, SQL_COSTO_KM } from './calcoli.js';

const FONTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const FONT = path.join(FONTS, 'DejaVuSans.ttf');
const FONT_B = path.join(FONTS, 'DejaVuSans-Bold.ttf');

const STATO_SPESA = { auto: 'Entro limite', da_approvare: 'Da approvare', approvata: 'Approvata', rifiutata: 'Rifiutata' };
const fEur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const fNum = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2, useGrouping: 'always' });
const fPct = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 1 });
const eur = (v) => v === null || v === undefined ? '' : fEur.format(v);
const num = (v) => v === null || v === undefined ? '' : fNum.format(v);
const dataIt = (s) => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
const oggiIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

// Nome file sicuro: "C001_Villa-Rossi"
export const nomeFile = (c) => `${c.codice}_${c.nome}`.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'cantiere';

export function datiArchivio(db, id) {
  const c = db.prepare('SELECT * FROM cantieri WHERE id = ?').get(id);
  if (!c) return null;
  const foto = (entita, eid) => db.prepare('SELECT file FROM foto WHERE entita = ? AND entita_id = ? ORDER BY creato_il').all(entita, eid).map((f) => f.file);
  return {
    generato: oggiIso(),
    cantiere: c,
    bilancio: bilancioCantiere(db, c),
    materiali: materialiCantiere(db, c.id),
    assegnati: db.prepare('SELECT u.nome FROM assegnazioni a JOIN utenti u ON u.id = a.utente_id WHERE a.cantiere_id = ? ORDER BY u.nome').all(c.id).map((u) => u.nome),
    sal: db.prepare('SELECT * FROM sal WHERE cantiere_id = ? ORDER BY data, numero').all(c.id),
    ore_per_operaio: db.prepare(`SELECT op.nome, SUM(o.ore) ore, SUM(o.ore * ${SQL_TARIFFA_ORE}) costo FROM ore o JOIN operai op ON op.id = o.operaio_id
      WHERE o.cantiere_id = ? GROUP BY op.id ORDER BY op.nome`).all(c.id),
    km_per_mezzo: db.prepare(`SELECT m.nome, SUM(k.km) km, SUM(k.km * ${SQL_COSTO_KM}) costo FROM km k JOIN mezzi m ON m.id = k.mezzo_id
      WHERE k.cantiere_id = ? GROUP BY m.id ORDER BY m.nome`).all(c.id),
    ore: db.prepare(`SELECT o.data, op.nome operaio, o.ore, ${SQL_TARIFFA_ORE} tariffa, o.ore * ${SQL_TARIFFA_ORE} costo, o.note, u.nome autore
      FROM ore o JOIN operai op ON op.id = o.operaio_id LEFT JOIN utenti u ON u.id = o.creato_da WHERE o.cantiere_id = ? ORDER BY o.data, op.nome`).all(c.id),
    km: db.prepare(`SELECT k.data, m.nome mezzo, k.km, ${SQL_COSTO_KM} costo_km, k.km * ${SQL_COSTO_KM} costo, k.note, u.nome autore
      FROM km k JOIN mezzi m ON m.id = k.mezzo_id LEFT JOIN utenti u ON u.id = k.creato_da WHERE k.cantiere_id = ? ORDER BY k.data, m.nome`).all(c.id),
    spese: db.prepare(`SELECT s.*, u.nome autore FROM spese s LEFT JOIN utenti u ON u.id = s.creato_da WHERE s.cantiere_id = ? ORDER BY s.data, s.creato_il`)
      .all(c.id).map((s) => ({ ...s, foto: foto('spesa', s.id) })),
    movimenti: db.prepare(`SELECT x.*, m.materiale, m.um, u.nome autore FROM movimenti_materiale x JOIN materiali m ON m.id = x.materiale_id
      LEFT JOIN utenti u ON u.id = x.creato_da WHERE m.cantiere_id = ? ORDER BY x.data, x.creato_il`).all(c.id).map((x) => ({ ...x, foto: foto('movimento', x.id) })),
    diario: db.prepare(`SELECT d.*, u.nome autore FROM diario d LEFT JOIN utenti u ON u.id = d.creato_da WHERE d.cantiere_id = ? ORDER BY d.data, d.creato_il`)
      .all(c.id).map((d) => ({ ...d, foto: foto('diario', d.id) })),
  };
}

// ======================= PDF/A =======================

// Solo JPEG e PNG si possono incorporare nel PDF
function leggiImmagine(fotoDir, file) {
  try {
    const buf = fs.readFileSync(path.join(fotoDir, path.basename(file)));
    const jpg = buf[0] === 0xff && buf[1] === 0xd8;
    const png = buf.subarray(0, 4).toString('hex') === '89504e47';
    return jpg || png ? buf : null;
  } catch { return null; }
}

export function pdfArchivio(d, fotoDir) {
  const { cantiere: c, bilancio: b } = d;
  const doc = new PDFDocument({
    size: 'A4', margins: { top: 42, bottom: 50, left: 42, right: 42 },
    pdfVersion: '1.7', subset: 'PDF/A-2b', lang: 'it-IT', font: FONT, bufferPages: true, displayTitle: true,
    info: { Title: `Scheda cantiere ${c.codice} - ${c.nome}`, Subject: 'Archivio scheda cantiere', Author: 'Scheda Cantiere', Creator: 'Scheda Cantiere' },
  });
  doc.registerFont('n', FONT);
  doc.registerFont('b', FONT_B);
  doc.font('n');
  const chunks = [];
  doc.on('data', (x) => chunks.push(x));
  const fine = new Promise((ok, ko) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', ko); });

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const fondo = () => doc.page.height - doc.page.margins.bottom;
  const GRIGIO = '#5b6470', LINEA = '#c9ced6', ROSSO = '#b42318';
  const spazio = (h) => { if (doc.y + h > fondo()) doc.addPage(); };

  const titolo = (t) => { spazio(60); doc.moveDown(0.6); doc.font('b').fontSize(12.5).fillColor('#1d3557').text(t, L, doc.y); doc.moveDown(0.25); doc.fillColor('black'); };
  const nota = (t) => { doc.font('n').fontSize(8.5).fillColor(GRIGIO).text(t, L, doc.y, { width: W }); doc.fillColor('black'); };

  // Tabella semplice con intestazione ripetuta a ogni pagina
  function tabella(colonne, righe, { totale } = {}) {
    const fs_ = 8.5, pad = 3;
    const tot = colonne.reduce((a, x) => a + x.w, 0);
    const cols = colonne.map((x) => ({ ...x, w: (x.w / tot) * W }));
    const altezza = (vals, font) => {
      doc.font(font).fontSize(fs_);
      return Math.max(...vals.map((v, i) => doc.heightOfString(String(v ?? ''), { width: cols[i].w - 2 * pad }))) + 2 * pad;
    };
    const disegna = (vals, { font = 'n', sfondo, colore } = {}) => {
      const hh = altezza(vals, font);
      let x = L; const y = doc.y;
      if (sfondo) doc.rect(L, y, W, hh).fill(sfondo);
      vals.forEach((v, i) => {
        const col = cols[i];
        doc.font(font).fontSize(fs_).fillColor(typeof colore === 'function' ? colore(i) : (colore || 'black'))
          .text(String(v ?? ''), x + pad, y + pad, { width: col.w - 2 * pad, align: col.a || 'left' });
        x += col.w;
      });
      doc.moveTo(L, y + hh).lineTo(L + W, y + hh).lineWidth(0.5).strokeColor(LINEA).stroke();
      doc.x = L; doc.y = y + hh; doc.fillColor('black');
    };
    const intestazione = () => disegna(cols.map((x) => x.t), { font: 'b', sfondo: '#eef1f5' });
    spazio(altezza(cols.map((x) => x.t), 'b') + 18);
    intestazione();
    if (!righe.length) { disegna(['Nessun dato', ...cols.slice(1).map(() => '')], { colore: () => GRIGIO }); return; }
    for (const r of righe) {
      const vals = r.celle || r;
      if (doc.y + altezza(vals, r.font || 'n') > fondo()) { doc.addPage(); intestazione(); }
      disegna(vals, { colore: r.colore, font: r.font, sfondo: r.sfondo });
    }
    if (totale) { if (doc.y + 18 > fondo()) { doc.addPage(); intestazione(); } disegna(totale, { font: 'b' }); }
  }

  // ---- Intestazione ----
  doc.font('n').fontSize(8.5).fillColor(GRIGIO).text(`Scheda cantiere archiviata il ${dataIt(d.generato)}`, L, doc.y);
  doc.moveDown(0.3);
  doc.font('n').fontSize(9.5).text(`${c.codice} · ${c.stato}`);
  doc.font('b').fontSize(18).fillColor('black').text(c.nome, { width: W });
  doc.font('n').fontSize(9.5).fillColor(GRIGIO);
  const det = [[c.cliente, c.indirizzo].filter(Boolean).join(' · '),
    `Dal ${dataIt(c.data_inizio) || '–'}${c.data_fine ? ' al ' + dataIt(c.data_fine) : ''}`,
    `Capisquadra: ${d.assegnati.join(', ') || 'nessuno'}`].filter(Boolean);
  for (const t of det) doc.text(t, { width: W });
  doc.fillColor('black');
  if (c.stato !== 'Concluso') { doc.moveDown(0.3); doc.font('b').fontSize(9).fillColor(ROSSO).text(`Cantiere non ancora concluso: i dati sono la situazione al ${dataIt(d.generato)}.`); doc.fillColor('black'); }

  // ---- Riquadri principali ----
  doc.moveDown(0.8);
  const kpi = [['Offerta confermata', eur(b.ricavi.offerta)], ['Costo totale', eur(b.costi.totale)],
    ['Margine', `${eur(b.margine)}  ${b.margine_pct === null ? '' : fPct.format(b.margine_pct)}`]];
  const kw = (W - 16) / 3, ky = doc.y;
  kpi.forEach(([et, v], i) => {
    const x = L + i * (kw + 8);
    doc.roundedRect(x, ky, kw, 46, 4).lineWidth(0.7).strokeColor(LINEA).stroke();
    doc.font('n').fontSize(8.5).fillColor(GRIGIO).text(et, x + 8, ky + 7, { width: kw - 16 });
    doc.font('b').fontSize(13).fillColor(i === 2 && b.margine < 0 ? ROSSO : 'black').text(v, x + 8, ky + 21, { width: kw - 16 });
  });
  doc.fillColor('black'); doc.x = L; doc.y = ky + 54;

  titolo('Ricavi e costi');
  const RC = [{ t: 'Voce', w: 3 }, { t: 'Importo', w: 1.4, a: 'right' }];
  tabella(RC, [
    ['Offerta confermata', eur(b.ricavi.offerta)], ['SAL fatturati', eur(b.ricavi.sal_fatturati)], ['Da fatturare', eur(b.ricavi.da_fatturare)],
    [`Manodopera (${num(b.quantita.ore)} ore)`, eur(b.costi.manodopera)], [`Trasporti (${num(b.quantita.km)} km)`, eur(b.costi.trasporti)],
    ['Trasferte: pasti e cibo', eur(b.costi.trasferte_pasti)], ['Trasferte: pernottamenti', eur(b.costi.trasferte_pernottamenti)],
    ['Trasferte: altro', eur(b.costi.trasferte_altro)], ['Materiali (costo reale)', eur(b.costi.materiali)],
    { celle: ['Costo totale', eur(b.costi.totale)], font: 'b' },
    { celle: ['Margine', `${eur(b.margine)}${b.margine_pct === null ? '' : ' (' + fPct.format(b.margine_pct) + ')'}`], font: 'b', sfondo: '#f6f7f9',
      colore: (i) => i === 1 && b.margine < 0 ? ROSSO : 'black' },
  ]);
  if (b.spese_da_approvare.numero) { doc.moveDown(0.3); nota(`Esclusi dal bilancio ${b.spese_da_approvare.numero} scontrini ancora da approvare (${eur(b.spese_da_approvare.importo)}).`); }

  titolo('Materiali');
  tabella([{ t: 'Materiale', w: 3 }, { t: 'U.M.', w: 0.8 }, { t: 'Prezzo', w: 1.2, a: 'right' }, { t: 'Q. prev.', w: 1, a: 'right' },
    { t: 'Q. agg.', w: 1, a: 'right' }, { t: 'Q. avanz.', w: 1.1, a: 'right' }, { t: 'Costo previsto', w: 1.4, a: 'right' },
    { t: 'Costo reale', w: 1.4, a: 'right' }, { t: 'Scostam.', w: 1.3, a: 'right' }],
  d.materiali.map((m) => [m.materiale, m.um || '', m.prezzo === null ? 'manca' : eur(m.prezzo), num(m.q_prevista), num(m.q_aggiunta), num(m.q_avanzata),
    eur(m.costo_previsto), eur(m.costo_reale), eur(m.scostamento)]),
  { totale: ['Totale', '', '', '', '', '', eur(b.materiali.previsto), eur(b.materiali.reale), eur(b.materiali.scostamento)] });

  if (d.movimenti.length) {
    titolo('Mancanti aggiunti e avanzi resi');
    tabella([{ t: 'Data', w: 1.4 }, { t: 'Materiale', w: 3 }, { t: 'Tipo', w: 1.2 }, { t: 'Quantità', w: 1.1, a: 'right' }, { t: 'Note', w: 2.6 }, { t: 'Inserito da', w: 1.6 }],
      d.movimenti.map((x) => [dataIt(x.data), x.materiale, x.tipo === 'aggiunta' ? 'Mancante' : 'Avanzo', `${num(x.quantita)} ${x.um || ''}`.trim(), x.note || '', x.autore || '']));
  }

  titolo('SAL emessi');
  tabella([{ t: 'Data', w: 1.2 }, { t: 'N.', w: 0.6 }, { t: 'Importo', w: 1.5, a: 'right' }, { t: 'Fattura', w: 1.5 }, { t: 'Note', w: 3.5 }],
    d.sal.map((x) => [dataIt(x.data), x.numero ?? '', eur(x.importo), x.fattura || '', x.note || '']),
    { totale: ['Totale', '', eur(b.ricavi.sal_fatturati), '', ''] });

  titolo('Ore per operaio');
  tabella([{ t: 'Operaio', w: 3 }, { t: 'Ore', w: 1, a: 'right' }, { t: 'Costo', w: 1.4, a: 'right' }],
    d.ore_per_operaio.map((o) => [o.nome, num(o.ore), eur(o.costo)]), { totale: ['Totale', num(b.quantita.ore), eur(b.costi.manodopera)] });

  titolo('Km per mezzo');
  tabella([{ t: 'Mezzo', w: 3 }, { t: 'Km', w: 1, a: 'right' }, { t: 'Costo', w: 1.4, a: 'right' }],
    d.km_per_mezzo.map((o) => [o.nome, num(o.km), eur(o.costo)]), { totale: ['Totale', num(b.quantita.km), eur(b.costi.trasporti)] });

  titolo('Spese di trasferta');
  tabella([{ t: 'Data', w: 1.4 }, { t: 'Tipo', w: 1.4 }, { t: 'Importo', w: 1.2, a: 'right' }, { t: 'Stato', w: 1.3 }, { t: 'N. scontrino', w: 1.2 }, { t: 'Note', w: 2.2 }, { t: 'Inserita da', w: 1.5 }],
    d.spese.map((x) => ({ celle: [dataIt(x.data), x.tipo, eur(x.importo), STATO_SPESA[x.stato], x.scontrino || '', x.note || '', x.autore || ''],
      colore: x.stato === 'rifiutata' || x.stato === 'da_approvare' ? () => GRIGIO : null })));
  nota('Nel bilancio contano solo le spese entro limite o approvate.');

  // ---- Diario con foto ----
  titolo('Diario');
  if (!d.diario.length) nota('Nessuna nota.');
  const TW = (W - 16) / 3, TH = TW * 0.75;
  const griglia = (files) => {
    const imgs = files.map((f) => leggiImmagine(fotoDir, f));
    let i = 0;
    while (i < imgs.length) {
      spazio(TH + 8);
      const y = doc.y;
      for (let k = 0; k < 3 && i < imgs.length; k++, i++) {
        const x = L + k * (TW + 8);
        if (imgs[i]) { try { doc.image(imgs[i], x, y, { fit: [TW, TH], align: 'center', valign: 'center' }); continue; } catch { /* formato non leggibile */ } }
        doc.rect(x, y, TW, TH).lineWidth(0.5).strokeColor(LINEA).stroke();
        doc.font('n').fontSize(8).fillColor(GRIGIO).text('Foto non disponibile', x, y + TH / 2 - 5, { width: TW, align: 'center' });
      }
      doc.fillColor('black'); doc.x = L; doc.y = y + TH + 8;
    }
  };
  for (const n of d.diario) {
    spazio(40);
    doc.moveDown(0.3);
    doc.font('b').fontSize(9).fillColor(GRIGIO)
      .text([dataIt(n.data), n.tipo, n.giorni_ritardo ? `${n.giorni_ritardo} gg di ritardo` : '', n.autore || ''].filter(Boolean).join(' · '), L, doc.y, { width: W });
    doc.font('n').fontSize(9.5).fillColor('black').text(n.testo, { width: W });
    if (n.azione) doc.font('n').fontSize(9).fillColor(GRIGIO).text('Azione: ' + n.azione, { width: W });
    doc.fillColor('black'); doc.moveDown(0.3);
    griglia(n.foto);
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.5).strokeColor(LINEA).stroke();
  }

  // ---- Foto di scontrini e bolle ----
  const allegati = [
    ...d.spese.flatMap((s) => s.foto.map((f) => ({ f, t: `Scontrino ${dataIt(s.data)} · ${s.tipo} · ${eur(s.importo)}` }))),
    ...d.movimenti.flatMap((x) => x.foto.map((f) => ({ f, t: `${x.tipo === 'aggiunta' ? 'Mancante' : 'Avanzo'} ${dataIt(x.data)} · ${x.materiale}` }))),
  ];
  if (allegati.length) {
    doc.addPage();
    titolo('Foto di scontrini e bolle');
    const AW = (W - 12) / 2, AH = 250;
    for (let i = 0; i < allegati.length; i += 2) {
      spazio(AH + 24);
      const y = doc.y;
      for (let k = 0; k < 2 && i + k < allegati.length; k++) {
        const a = allegati[i + k], x = L + k * (AW + 12), img = leggiImmagine(fotoDir, a.f);
        doc.font('n').fontSize(8.5).fillColor(GRIGIO).text(a.t, x, y, { width: AW, lineBreak: false, ellipsis: true });
        let ok = false;
        if (img) { try { doc.image(img, x, y + 14, { fit: [AW, AH], align: 'center', valign: 'top' }); ok = true; } catch { /* formato non leggibile */ } }
        if (!ok) doc.text('Foto non disponibile', x, y + 30, { width: AW });
      }
      doc.fillColor('black'); doc.x = L; doc.y = y + AH + 24;
    }
  }

  // ---- Piè di pagina ----
  const r = doc.bufferedPageRange();
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(r.start + i);
    const mb = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('n').fontSize(7.5).fillColor(GRIGIO)
      .text(`${c.codice} · ${c.nome}`, L, doc.page.height - 32, { width: W * 0.7, lineBreak: false, ellipsis: true })
      .text(`Pagina ${i + 1} di ${r.count}`, L, doc.page.height - 32, { width: W, align: 'right', lineBreak: false });
    doc.page.margins.bottom = mb;
  }
  doc.end();
  return fine;
}

// ======================= EXCEL =======================

const FMT_EUR = '#,##0.00 "€"';
const FMT_NUM = '#,##0.##';
const dataXl = (s) => s ? new Date(s.slice(0, 10) + 'T00:00:00Z') : null;

export async function excelArchivio(d) {
  const { cantiere: c, bilancio: b } = d;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Scheda Cantiere';
  wb.title = `Archivio ${c.codice} - ${c.nome}`;
  wb.created = new Date();

  const foglio = (nome, colonne, righe, { totale } = {}) => {
    const ws = wb.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = colonne.map((x) => ({ header: x.t, key: x.k, width: x.w || 14, style: x.f ? { numFmt: x.f } : (x.d ? { numFmt: 'dd/mm/yyyy' } : {}) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F5' } };
    for (const r of righe) ws.addRow(r);
    if (totale && righe.length) { const row = ws.addRow(totale); row.font = { bold: true }; }
    if (righe.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colonne.length } };
    return ws;
  };

  // Riepilogo: dati generali e bilancio
  const ws = wb.addWorksheet('Riepilogo');
  ws.columns = [{ width: 34 }, { width: 22 }];
  const riga = (et, v, fmt, bold) => { const r = ws.addRow([et, v]); if (fmt) r.getCell(2).numFmt = fmt; if (bold) r.font = { bold: true }; };
  ws.addRow([`Scheda cantiere ${c.codice} - ${c.nome}`]).font = { bold: true, size: 14 };
  riga('Archiviata il', dataXl(d.generato), 'dd/mm/yyyy');
  ws.addRow([]);
  riga('Codice', c.codice); riga('Cantiere', c.nome); riga('Cliente', c.cliente || ''); riga('Indirizzo', c.indirizzo || '');
  riga('Stato', c.stato); riga('Data inizio', dataXl(c.data_inizio), 'dd/mm/yyyy'); riga('Data fine', dataXl(c.data_fine), 'dd/mm/yyyy');
  riga('Capisquadra', d.assegnati.join(', '));
  ws.addRow([]);
  ws.addRow(['Ricavi']).font = { bold: true };
  riga('Offerta confermata', b.ricavi.offerta, FMT_EUR); riga('SAL fatturati', b.ricavi.sal_fatturati, FMT_EUR); riga('Da fatturare', b.ricavi.da_fatturare, FMT_EUR);
  ws.addRow([]);
  ws.addRow(['Costi']).font = { bold: true };
  riga('Ore lavorate', b.quantita.ore, FMT_NUM); riga('Manodopera', b.costi.manodopera, FMT_EUR);
  riga('Km percorsi', b.quantita.km, FMT_NUM); riga('Trasporti', b.costi.trasporti, FMT_EUR);
  riga('Trasferte: pasti e cibo', b.costi.trasferte_pasti, FMT_EUR); riga('Trasferte: pernottamenti', b.costi.trasferte_pernottamenti, FMT_EUR);
  riga('Trasferte: altro', b.costi.trasferte_altro, FMT_EUR); riga('Materiali (costo reale)', b.costi.materiali, FMT_EUR);
  riga('Costo totale', b.costi.totale, FMT_EUR, true);
  ws.addRow([]);
  riga('Margine', b.margine, FMT_EUR, true); riga('Margine %', b.margine_pct, '0.0%', true);
  ws.addRow([]);
  riga('Costo materiali previsto', b.materiali.previsto, FMT_EUR); riga('Scostamento materiali', b.materiali.scostamento, FMT_EUR);
  riga('Scontrini da approvare (esclusi)', b.spese_da_approvare.importo, FMT_EUR);
  riga('Note nel diario', b.diario.note); riga('Giorni di ritardo annotati', b.diario.giorni_ritardo);

  foglio('SAL', [{ t: 'Data', k: 'data', d: 1, w: 12 }, { t: 'N. SAL', k: 'numero', w: 8 }, { t: 'Importo €', k: 'importo', f: FMT_EUR }, { t: 'Fattura', k: 'fattura', w: 16 }, { t: 'Note', k: 'note', w: 40 }],
    d.sal.map((x) => ({ ...x, data: dataXl(x.data) })), { totale: { data: 'Totale', importo: b.ricavi.sal_fatturati } });

  foglio('Ore', [{ t: 'Data', k: 'data', d: 1, w: 12 }, { t: 'Operaio', k: 'operaio', w: 24 }, { t: 'Ore', k: 'ore', f: FMT_NUM, w: 8 }, { t: 'Tariffa €/h', k: 'tariffa', f: FMT_EUR },
    { t: 'Costo €', k: 'costo', f: FMT_EUR }, { t: 'Note', k: 'note', w: 30 }, { t: 'Inserito da', k: 'autore', w: 20 }],
  d.ore.map((x) => ({ ...x, data: dataXl(x.data) })), { totale: { data: 'Totale', ore: b.quantita.ore, costo: b.costi.manodopera } });

  foglio('Km', [{ t: 'Data', k: 'data', d: 1, w: 12 }, { t: 'Mezzo', k: 'mezzo', w: 24 }, { t: 'Km', k: 'km', f: FMT_NUM, w: 8 }, { t: 'Costo €/km', k: 'costo_km', f: FMT_EUR },
    { t: 'Costo €', k: 'costo', f: FMT_EUR }, { t: 'Note', k: 'note', w: 30 }, { t: 'Inserito da', k: 'autore', w: 20 }],
  d.km.map((x) => ({ ...x, data: dataXl(x.data) })), { totale: { data: 'Totale', km: b.quantita.km, costo: b.costi.trasporti } });

  foglio('Trasferte', [{ t: 'Data', k: 'data', d: 1, w: 12 }, { t: 'Tipo', k: 'tipo', w: 16 }, { t: 'Importo €', k: 'importo', f: FMT_EUR }, { t: 'Stato', k: 'stato', w: 14 },
    { t: 'Conta nel bilancio', k: 'conta', w: 10 }, { t: 'N. scontrino', k: 'scontrino', w: 14 }, { t: 'Foto', k: 'foto', w: 8 }, { t: 'Note', k: 'note', w: 30 }, { t: 'Inserita da', k: 'autore', w: 20 }],
  d.spese.map((x) => ({ ...x, data: dataXl(x.data), stato: STATO_SPESA[x.stato], conta: ['auto', 'approvata'].includes(x.stato) ? 'Sì' : 'No', foto: x.foto.length })),
  { totale: { data: 'Totale nel bilancio', importo: b.costi.trasferte } });

  foglio('Materiali', [{ t: 'Materiale', k: 'materiale', w: 30 }, { t: 'U.M.', k: 'um', w: 8 }, { t: 'Prezzo €', k: 'prezzo', f: FMT_EUR }, { t: 'Q.tà prevista', k: 'q_prevista', f: FMT_NUM },
    { t: 'Q.tà aggiunta', k: 'q_aggiunta', f: FMT_NUM }, { t: 'Q.tà avanzata', k: 'q_avanzata', f: FMT_NUM }, { t: 'Q.tà usata', k: 'q_usata', f: FMT_NUM },
    { t: 'Costo previsto €', k: 'costo_previsto', f: FMT_EUR, w: 16 }, { t: 'Costo reale €', k: 'costo_reale', f: FMT_EUR, w: 16 }, { t: 'Scostamento €', k: 'scostamento', f: FMT_EUR, w: 16 }],
  d.materiali, { totale: { materiale: 'Totale', costo_previsto: b.materiali.previsto, costo_reale: b.materiali.reale, scostamento: b.materiali.scostamento } });

  foglio('Movimenti materiali', [{ t: 'Data', k: 'data', d: 1, w: 12 }, { t: 'Materiale', k: 'materiale', w: 30 }, { t: 'Tipo', k: 'tipo', w: 12 }, { t: 'Quantità', k: 'quantita', f: FMT_NUM },
    { t: 'U.M.', k: 'um', w: 8 }, { t: 'Foto', k: 'foto', w: 8 }, { t: 'Note', k: 'note', w: 30 }, { t: 'Inserito da', k: 'autore', w: 20 }],
  d.movimenti.map((x) => ({ ...x, data: dataXl(x.data), tipo: x.tipo === 'aggiunta' ? 'Mancante' : 'Avanzo', foto: x.foto.length })));

  const wd = foglio('Diario', [{ t: 'Data', k: 'data', d: 1, w: 12 }, { t: 'Tipo', k: 'tipo', w: 16 }, { t: 'Nota', k: 'testo', w: 60 }, { t: 'Giorni ritardo', k: 'giorni_ritardo', w: 10 },
    { t: 'Azione', k: 'azione', w: 30 }, { t: 'Foto', k: 'foto', w: 8 }, { t: 'Inserita da', k: 'autore', w: 20 }],
  d.diario.map((x) => ({ ...x, data: dataXl(x.data), foto: x.foto.length })));
  wd.getColumn('testo').alignment = { wrapText: true, vertical: 'top' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
